import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const teacherId = "123e4567-e89b-42d3-a456-426614174100";
const studentA = "123e4567-e89b-42d3-a456-426614174101";
const studentB = "123e4567-e89b-42d3-a456-426614174102";
const deletedDeviceStudentId = "123e4567-e89b-42d3-a456-426614174198";
const deletedModeratorId = "123e4567-e89b-42d3-a456-426614174199";
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
let db: PGlite;
let classId: string;
let legacySessionId: string;

async function createSession() {
  const result = await db.query<{ id: string }>(
    "insert into public.sessions(class_id) values($1) returning id",
    [classId],
  );
  return result.rows[0].id;
}

async function register(sessionId: string, studentId: string, hash: string) {
  return db.query(
    "select public.register_attendance_if_open($1::uuid,$2::uuid,$3::text,$4::float8,$5::float8,$6::text,$7::text,$8::text,$9::text,$10::text) as id",
    [sessionId, studentId, hash, null, null, "not_shared", "Madrid", "Comunidad de Madrid", "España", "ES"],
  );
}

async function registerWithGps(sessionId: string, status: "verified" | "outside" | "inaccurate", hash: string) {
  return db.query(
    "select public.register_attendance_if_open($1::uuid,$2::uuid,$3::text,$4::float8,$5::float8,$6::text,$7::text,$8::text,$9::text,$10::text) as id",
    [sessionId, studentA, hash, 12, 25, status, "Madrid", "Comunidad de Madrid", "España", "ES"],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create publication supabase_realtime;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  await db.exec(migration("202609210001_attendance_alpha.sql").replace("create extension if not exists pgcrypto;", ""));
  const legacyClass = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name) values('Legacy','Teacher') returning id")).rows[0].id;
  legacySessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,43.47,-3.8,100) returning id", [legacyClass])).rows[0].id;
  await db.query("insert into public.attendance(session_id,full_name,normalized_name,qr_verified,location_verified,location_accuracy,distance_from_center_m) values($1,'Historical','historical',true,true,8,12)", [legacySessionId]);
  await db.exec(migration("202609210002_attendance_hardening.sql"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [teacherId, studentA, studentB]);
  await db.exec(migration("20260921142234_institutional_teacher_auth.sql"));
  await db.exec(migration("20260921152310_teacher_least_privilege.sql"));
  await db.exec(migration("20260921213707_teacher_profiles.sql"));
  await db.exec(migration("20260922145139_institutional_accounts.sql"));
  await db.exec(migration("20260922161109_institutional_email_domains.sql"));
  await db.exec(migration("20260922200450_fast_attendance_flow.sql"));
  await db.query("insert into public.institutional_accounts(user_id,email,role) values($1,'teacher@faculty.example.edu','teacher'),($2,'student.a@students.example.edu','student'),($3,'student.b@students.example.edu','student')", [teacherId, studentA, studentB]);
  await db.query("insert into public.student_profiles(user_id,display_name) values($1,'Same Name'),($2,'Same Name')", [studentA, studentB]);
  await db.exec(migration("20260923073137_profile_name_immutability.sql"));
  await db.exec(migration("20260923114500_attendance_integrity.sql"));
  classId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Fast scan','Teacher',$1) returning id", [teacherId])).rows[0].id;
}, 30_000);

afterAll(async () => { await db?.close(); });

describe("v0.5.1 fast attendance migration", () => {
  it("allows sessions without location while preserving historical coordinates", async () => {
    const sessionId = await createSession();
    expect((await db.query("select latitude,longitude,allowed_radius_m from public.sessions where id=$1", [sessionId])).rows).toEqual([
      { latitude: null, longitude: null, allowed_radius_m: null },
    ]);
    expect((await db.query("select latitude,longitude,allowed_radius_m from public.sessions where id=$1", [legacySessionId])).rows).toEqual([
      { latitude: 43.47, longitude: -3.8, allowed_radius_m: 100 },
    ]);
  });

  it("registers without GPS and stores location fields as explicitly unverified", async () => {
    const sessionId = await createSession();
    await register(sessionId, studentA, "a".repeat(64));
    expect((await db.query("select attendance.session_id,sessions.class_id,qr_verified,location_verified,location_accuracy,distance_from_center_m,network_city from public.attendance join public.sessions on sessions.id=attendance.session_id where attendance.session_id=$1", [sessionId])).rows).toEqual([
      { session_id: sessionId, class_id: classId, qr_verified: true, location_verified: false, location_accuracy: null, distance_from_center_m: null, network_city: "Madrid" },
    ]);
  });

  it("keeps historical GPS records unchanged", async () => {
    expect((await db.query("select location_verified,location_accuracy,distance_from_center_m from public.attendance where session_id=$1", [legacySessionId])).rows).toEqual([
      { location_verified: true, location_accuracy: 8, distance_from_center_m: 12 },
    ]);
  });

  it("preserves student and device uniqueness with student duplication reported first", async () => {
    const sessionId = await createSession();
    const hash = "b".repeat(64);
    await register(sessionId, studentA, hash);
    await expect(register(sessionId, studentA, "c".repeat(64))).rejects.toMatchObject({ message: "DUPLICATE_ATTENDANCE" });
    await expect(register(sessionId, studentB, hash)).rejects.toMatchObject({ message: "DEVICE_ALREADY_USED" });
  });

  it("allows one student in another session and homonyms on different devices", async () => {
    const first = await createSession();
    const second = await createSession();
    await register(first, studentA, "d".repeat(64));
    await expect(register(first, studentB, "e".repeat(64))).resolves.toBeDefined();
    await expect(register(second, studentA, "f".repeat(64))).resolves.toBeDefined();
  });

  it("rejects an unverified QR source while allowing a validated manual source", async () => {
    const sessionId = await createSession();
    await expect(db.query(
      "insert into public.attendance(session_id,student_user_id,full_name,normalized_name,qr_verified,location_verified,device_hash) values($1,$2,'Invalid','invalid',false,false,$3)",
      [sessionId, studentA, "1".repeat(64)],
    )).rejects.toMatchObject({ code: "23514", constraint: "attendance_source_verification" });
  });

  it("exposes only the ten-argument QR RPC to service_role", async () => {
    const functions = await db.query<{ oid: number; pronargs: number }>("select oid,pronargs from pg_proc where proname='register_attendance_if_open'");
    expect(functions.rows).toHaveLength(1);
    expect(functions.rows[0].pronargs).toBe(10);
    const permissions = await db.query("select has_function_privilege('anon',$1::oid,'EXECUTE') as anon, has_function_privilege('authenticated',$1::oid,'EXECUTE') as authenticated, has_function_privilege('service_role',$1::oid,'EXECUTE') as server", [functions.rows[0].oid]);
    expect(permissions.rows[0]).toEqual({ anon: false, authenticated: false, server: true });
  });

  it("requires a complete session location reference for conclusive GPS statuses", async () => {
    const missingLatitude = (await db.query<{ id: string }>(
      "insert into public.sessions(class_id,longitude,allowed_radius_m) values($1,-3.8,100) returning id",
      [classId],
    )).rows[0].id;
    const missingLongitude = (await db.query<{ id: string }>(
      "insert into public.sessions(class_id,latitude,allowed_radius_m) values($1,43.47,100) returning id",
      [classId],
    )).rows[0].id;
    const missingRadius = (await db.query<{ id: string }>(
      "insert into public.sessions(class_id,latitude,longitude) values($1,43.47,-3.8) returning id",
      [classId],
    )).rows[0].id;

    await expect(registerWithGps(missingLatitude, "verified", "2".repeat(64))).rejects.toMatchObject({ message: "INVALID_GPS_STATUS" });
    await expect(registerWithGps(missingLongitude, "outside", "3".repeat(64))).rejects.toMatchObject({ message: "INVALID_GPS_STATUS" });
    await expect(registerWithGps(missingRadius, "inaccurate", "4".repeat(64))).rejects.toMatchObject({ message: "INVALID_GPS_STATUS" });

    const completeReference = (await db.query<{ id: string }>(
      "insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,43.47,-3.8,100) returning id",
      [classId],
    )).rows[0].id;
    await expect(registerWithGps(completeReference, "verified", "5".repeat(64))).resolves.toBeDefined();
  });

  it("keeps trusted-device hashes private while service_role retains full management", async () => {
    const hash = "9".repeat(64);
    const privileges = (await db.query(`
      select
        has_table_privilege('authenticated', 'public.student_trusted_devices', 'SELECT') as authenticated_select,
        has_table_privilege('authenticated', 'public.student_trusted_devices', 'INSERT') as authenticated_insert,
        has_table_privilege('authenticated', 'public.student_trusted_devices', 'UPDATE') as authenticated_update,
        has_table_privilege('authenticated', 'public.student_trusted_devices', 'DELETE') as authenticated_delete,
        has_table_privilege('service_role', 'public.student_trusted_devices', 'SELECT') as service_select,
        has_table_privilege('service_role', 'public.student_trusted_devices', 'INSERT') as service_insert,
        has_table_privilege('service_role', 'public.student_trusted_devices', 'UPDATE') as service_update,
        has_table_privilege('service_role', 'public.student_trusted_devices', 'DELETE') as service_delete
    `)).rows[0];
    expect(privileges).toEqual({
      authenticated_select: false,
      authenticated_insert: false,
      authenticated_update: false,
      authenticated_delete: false,
      service_select: true,
      service_insert: true,
      service_update: true,
      service_delete: true,
    });

    await db.query("insert into public.student_trusted_devices(user_id,device_hash) values($1,$2)", [studentA, hash]);
    await expect(db.query("insert into public.student_trusted_devices(user_id,device_hash) values($1,$2)", [studentB, hash])).rejects.toMatchObject({ code: "23505" });

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [studentA]);
    await db.exec("set role authenticated");
    try {
      await expect(db.query("select user_id from public.student_trusted_devices")).rejects.toBeDefined();
      await expect(db.query("insert into public.student_trusted_devices(user_id,device_hash) values($1,$2)", [studentB, "8".repeat(64)])).rejects.toBeDefined();
      await expect(db.query("update public.student_trusted_devices set verified_at=now() where user_id=$1", [studentA])).rejects.toBeDefined();
      await expect(db.query("delete from public.student_trusted_devices where user_id=$1", [studentA])).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }

    await db.exec("set role service_role");
    try {
      expect((await db.query("select user_id from public.student_trusted_devices where user_id=$1", [studentA])).rows).toEqual([{ user_id: studentA }]);
      await expect(db.query("update public.student_trusted_devices set verified_at=now() where user_id=$1", [studentA])).resolves.toBeDefined();
      await expect(db.query("insert into public.student_trusted_devices(user_id,device_hash) values($1,$2)", [studentB, "8".repeat(64)])).resolves.toBeDefined();
      await expect(db.query("delete from public.student_trusted_devices where user_id=$1", [studentB])).resolves.toBeDefined();
    } finally {
      await db.exec("reset role");
    }

    expect((await db.query(
      "select public.reset_student_trusted_device($1,$2) as removed",
      [studentA, teacherId],
    )).rows).toEqual([{ removed: true }]);
    expect((await db.query(
      "select action,subject_user_id from public.attendance_audit_log where action='device_reset'",
    )).rows).toEqual([{ action: "device_reset", subject_user_id: studentA }]);
  });

  it("preserves device-reset audit history after user deletion and rejects a null subject", async () => {
    await db.query("insert into auth.users(id) values($1)", [deletedDeviceStudentId]);
    await db.query(
      "insert into public.student_trusted_devices(user_id,device_hash) values($1,$2)",
      [deletedDeviceStudentId, "7".repeat(64)],
    );

    expect((await db.query(
      "select public.reset_student_trusted_device($1,$2) as removed",
      [deletedDeviceStudentId, teacherId],
    )).rows).toEqual([{ removed: true }]);
    expect((await db.query(
      "select subject_user_id from public.attendance_audit_log where action='device_reset' and subject_user_id=$1",
      [deletedDeviceStudentId],
    )).rows).toEqual([{ subject_user_id: deletedDeviceStudentId }]);

    await expect(db.query("delete from auth.users where id=$1", [deletedDeviceStudentId])).resolves.toBeDefined();
    expect((await db.query(
      "select action,subject_user_id,attendance_id,session_id from public.attendance_audit_log where action='device_reset' and subject_user_id is null",
    )).rows).toContainEqual({ action: "device_reset", subject_user_id: null, attendance_id: null, session_id: null });

    await expect(db.query(
      "select public.reset_student_trusted_device(null,$1)",
      [teacherId],
    )).rejects.toMatchObject({ message: "SUBJECT_USER_ID_REQUIRED" });
  });

  it("soft-voids manual attendance, audits it and permits re-registration", async () => {
    const sessionId = await createSession();
    const first = await db.query<{ id: string }>(
      "select public.add_manual_attendance($1,$2,$3,$4,$5,$6,$7) as id",
      [sessionId, studentA, "student.a@students.example.edu", "Same Name", "same name", "Incidencia técnica", teacherId],
    );
    const firstId = first.rows[0].id;
    await db.query(
      "select public.moderate_attendance($1,$2,'mark_suspicious','Revisar',$3)",
      [sessionId, firstId, teacherId],
    );
    await db.query(
      "select public.moderate_attendance($1,$2,'void','Registro incorrecto',$3)",
      [sessionId, firstId, teacherId],
    );
    await expect(db.query(
      "select public.add_manual_attendance($1,$2,$3,$4,$5,$6,$7)",
      [sessionId, studentA, "student.a@students.example.edu", "Same Name", "same name", "Alta corregida", teacherId],
    )).resolves.toBeDefined();
    expect((await db.query("select action from public.attendance_audit_log where session_id=$1 order by action", [sessionId])).rows).toEqual([
      { action: "manual_add" },
      { action: "manual_add" },
      { action: "mark_suspicious" },
      { action: "void" },
    ]);
  });

  it("preserves a voided attendance when its moderator account is deleted", async () => {
    const sessionId = await createSession();
    await db.query("insert into auth.users(id) values($1)", [deletedModeratorId]);
    const attendance = await db.query<{ id: string }>(
      "select public.add_manual_attendance($1,$2,$3,$4,$5,$6,$7) as id",
      [sessionId, studentA, "student.a@students.example.edu", "Same Name", "same name", "Incidencia técnica", teacherId],
    );

    await db.query(
      "select public.moderate_attendance($1,$2,'void','Actor eliminado posteriormente',$3)",
      [sessionId, attendance.rows[0].id, deletedModeratorId],
    );
    await expect(db.query("delete from auth.users where id=$1", [deletedModeratorId])).resolves.toBeDefined();

    const row = (await db.query(
      "select voided_at is not null as voided,void_reason,voided_by from public.attendance where id=$1",
      [attendance.rows[0].id],
    )).rows[0];
    expect(row).toEqual({ voided: true, void_reason: "Actor eliminado posteriormente", voided_by: null });
  });
});
