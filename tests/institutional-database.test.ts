import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
let classId: string;
let legacySessionId: string;
const teacherId = "123e4567-e89b-42d3-a456-426614174100";
const studentA = "123e4567-e89b-42d3-a456-426614174101";
const studentB = "123e4567-e89b-42d3-a456-426614174102";
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

async function register(sessionId: string, studentId: string, hash: string) {
  return db.query(
    "select public.register_attendance_if_open($1::uuid,$2::uuid,$3::float8,$4::float8,$5,$6,$7,$8,$9,$10) as id",
    [sessionId, studentId, 10, 10, hash, null, null, null, null, "unknown"],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create publication supabase_realtime;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  await db.exec(migration("202609210001_attendance_alpha.sql").replace("create extension if not exists pgcrypto;", ""));
  classId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name) values('Legacy','Teacher') returning id")).rows[0].id;
  legacySessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [classId])).rows[0].id;
  await db.query("insert into public.attendance(session_id,full_name,normalized_name,qr_verified,location_verified) values($1,'Historical Student','historical student',true,true)", [legacySessionId]);
  await db.exec(migration("202609210002_attendance_hardening.sql"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [teacherId, studentA, studentB]);
  await db.exec(migration("20260921142234_institutional_teacher_auth.sql"));
  await db.exec(migration("20260921152310_teacher_least_privilege.sql"));
  await db.exec(migration("20260921213707_teacher_profiles.sql"));
  await db.exec(migration("20260922145139_institutional_accounts.sql"));
  await db.exec(migration("20260922161109_institutional_email_domains.sql"));
  await db.query("insert into public.institutional_accounts(user_id,email,role) values($1,'teacher.one@faculty.example.edu','teacher'),($2,'student.a@students.example.edu','student'),($3,'student.b@students.example.edu','student')", [teacherId, studentA, studentB]);
  await db.query("insert into public.teacher_profiles(user_id,display_name,avatar_key) values($1,'Teacher One','avatar_01')", [teacherId]);
  await db.query("insert into public.student_profiles(user_id,display_name) values($1,'Same Student Name'),($2,'Same Student Name')", [studentA, studentB]);
  await db.exec(migration("20260923073137_profile_name_immutability.sql"));
}, 30_000);

afterAll(async () => { await db?.close(); });

describe("v0.5 institutional database migration", () => {
  it("keeps allowlist private and institutional roles immutable to authenticated users", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [studentA]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select email,role from public.institutional_accounts")).rows).toEqual([
        { email: "student.a@students.example.edu", role: "student" },
      ]);
      await expect(db.query("update public.institutional_accounts set role='teacher' where user_id=$1", [studentA])).rejects.toBeDefined();
      await expect(db.query("select email from public.teacher_allowlist")).rejects.toBeDefined();
      await expect(db.query("insert into public.teacher_allowlist(email) values('student.a@students.example.edu')")).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  it("accepts both exact account domains but keeps the teacher allowlist teacher-only", async () => {
    expect((await db.query("select email from public.institutional_accounts order by email")).rows).toEqual([
      { email: "student.a@students.example.edu" },
      { email: "student.b@students.example.edu" },
      { email: "teacher.one@faculty.example.edu" },
    ]);
    await expect(db.query("update public.institutional_accounts set email='person@fake.students.example.edu' where user_id=$1", [studentA])).rejects.toBeDefined();
    await expect(db.query("insert into public.teacher_allowlist(email) values('student@students.example.edu')")).rejects.toBeDefined();
    await expect(db.query("insert into public.teacher_allowlist(email) values('teacher.two@faculty.example.edu')")).resolves.toBeDefined();
  });

  it("does not expose institutional tables to anonymous clients", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select user_id from public.institutional_accounts")).rejects.toBeDefined();
      await expect(db.query("select email from public.teacher_allowlist")).rejects.toBeDefined();
      await expect(db.query("select user_id from public.student_profiles")).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  it("lets a student read but never update their institutional display name", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [studentA]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select user_id,display_name from public.student_profiles")).rows).toEqual([
        { user_id: studentA, display_name: "Same Student Name" },
      ]);
      await expect(db.query("update public.student_profiles set display_name='Student A' where user_id=$1 returning display_name", [studentA])).rejects.toBeDefined();
      await expect(db.query("update public.student_profiles set display_name='Forged' where user_id=$1 returning user_id", [studentB])).rejects.toBeDefined();
      await expect(db.query("update public.student_profiles set user_id=$1 where user_id=$2", [studentB, studentA])).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  it("keeps teacher profiles available only to institutional teachers", async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [teacherId]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select display_name from public.teacher_profiles")).rows).toEqual([{ display_name: "Teacher One" }]);
      expect((await db.query("update public.teacher_profiles set avatar_key='avatar_02' where user_id=$1 returning avatar_key", [teacherId])).rows).toEqual([{ avatar_key: "avatar_02" }]);
      await expect(db.query("update public.teacher_profiles set display_name='Forged Teacher' where user_id=$1", [teacherId])).rejects.toBeDefined();
      await expect(db.query("insert into public.teacher_profiles(user_id,display_name) values($1,'Another Teacher')", [studentA])).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [studentA]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select display_name from public.teacher_profiles")).rows).toEqual([]);
      await expect(db.query("insert into public.teacher_profiles(user_id,display_name) values($1,'Forged Teacher')", [studentA])).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  it("preserves existing profile names when immutability is enabled", async () => {
    expect((await db.query("select display_name from public.student_profiles order by user_id")).rows).toEqual([
      { display_name: "Same Student Name" },
      { display_name: "Same Student Name" },
    ]);
    expect((await db.query("select display_name from public.teacher_profiles where user_id=$1", [teacherId])).rows).toEqual([
      { display_name: "Teacher One" },
    ]);
  });

  it("preserves historical anonymous identity while requiring student identity in the RPC", async () => {
    expect((await db.query("select full_name,student_user_id from public.attendance where session_id=$1", [legacySessionId])).rows).toEqual([
      { full_name: "Historical Student", student_user_id: null },
    ]);
    await expect(register(legacySessionId, "123e4567-e89b-42d3-a456-426614174999", "f".repeat(64))).rejects.toMatchObject({ message: "STUDENT_IDENTITY_REQUIRED" });
  });

  it("uses student identity for duplicates and allows different students with the same name", async () => {
    const ownedClass = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('v0.5','Teacher',$1) returning id", [teacherId])).rows[0].id;
    const sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [ownedClass])).rows[0].id;
    await register(sessionId, studentA, "a".repeat(64));
    await expect(register(sessionId, studentA, "b".repeat(64))).rejects.toMatchObject({ message: "DUPLICATE_ATTENDANCE" });
    await expect(register(sessionId, studentB, "c".repeat(64))).resolves.toBeDefined();
    expect((await db.query("select full_name from public.attendance where session_id=$1 order by student_user_id", [sessionId])).rows).toHaveLength(2);
  });

  it("allows the same student in a different session", async () => {
    const ownedClass = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Second session','Teacher',$1) returning id", [teacherId])).rows[0].id;
    const firstSession = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [ownedClass])).rows[0].id;
    const secondSession = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [ownedClass])).rows[0].id;
    await register(firstSession, studentA, "1".repeat(64));
    await expect(register(secondSession, studentA, "2".repeat(64))).resolves.toBeDefined();
  });

  it("keeps device protection ahead of account duplication", async () => {
    const ownedClass = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Device','Teacher',$1) returning id", [teacherId])).rows[0].id;
    const sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [ownedClass])).rows[0].id;
    const hash = "d".repeat(64);
    await register(sessionId, studentA, hash);
    await expect(register(sessionId, studentB, hash)).rejects.toMatchObject({ message: "DEVICE_ALREADY_USED" });
  });

  it("exposes only the new service-role RPC overload", async () => {
    const functions = await db.query<{ oid: number; pronargs: number }>("select oid,pronargs from pg_proc where proname='register_attendance_if_open'");
    expect(functions.rows).toHaveLength(1);
    expect(functions.rows[0].pronargs).toBe(10);
    const permissions = await db.query("select has_function_privilege('anon',$1::oid,'EXECUTE') as anon, has_function_privilege('authenticated',$1::oid,'EXECUTE') as authenticated, has_function_privilege('service_role',$1::oid,'EXECUTE') as server", [functions.rows[0].oid]);
    expect(permissions.rows[0]).toEqual({ anon: false, authenticated: false, server: true });
  });
});
