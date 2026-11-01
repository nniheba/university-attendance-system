import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const teacherId = "123e4567-e89b-42d3-a456-426614174200";
const otherTeacherId = "123e4567-e89b-42d3-a456-426614174201";
const studentA = "123e4567-e89b-42d3-a456-426614174202";
const studentB = "123e4567-e89b-42d3-a456-426614174203";
const studentC = "123e4567-e89b-42d3-a456-426614174204";
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
let db: PGlite;
let historicalClassId: string;
let historicalSessionId: string;
let classId: string;
let secondClassId: string;
let migrationPreflightMessage = "";
let migrationPreflightRolledBack = false;

async function register(sessionId: string, studentId: string, hash: string) {
  return db.query(
    "select public.register_attendance_if_open($1::uuid,$2::uuid,$3::text,$4::float8,$5::float8,$6::text,$7::text,$8::text,$9::text,$10::text)",
    [sessionId, studentId, hash, null, null, "not_shared", null, null, null, null],
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
  historicalClassId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name) values('Historical','Teacher') returning id")).rows[0].id;
  historicalSessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,43.47,-3.8,100) returning id", [historicalClassId])).rows[0].id;
  await db.exec(migration("202609210002_attendance_hardening.sql"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [teacherId, otherTeacherId, studentA, studentB]);
  await db.exec(migration("20260921142234_institutional_teacher_auth.sql"));
  await db.exec(migration("20260921152310_teacher_least_privilege.sql"));
  await db.exec(migration("20260921213707_teacher_profiles.sql"));
  await db.exec(migration("20260922145139_institutional_accounts.sql"));
  await db.exec(migration("20260922161109_institutional_email_domains.sql"));
  await db.exec(migration("20260922200450_fast_attendance_flow.sql"));
  await db.query("insert into public.institutional_accounts(user_id,email,role) values($1,'teacher@faculty.example.edu','teacher'),($2,'other@faculty.example.edu','teacher'),($3,'student.a@students.example.edu','student'),($4,'student.b@students.example.edu','student')", [teacherId, otherTeacherId, studentA, studentB]);
  await db.query("insert into public.student_profiles(user_id,display_name) values($1,'Student A'),($2,'Student B')", [studentA, studentB]);
  await db.exec(migration("20260923073137_profile_name_immutability.sql"));
  await db.exec(migration("20260923114500_attendance_integrity.sql"));
  try {
    await db.exec(migration("20260923131434_academic_foundation.sql"));
  } catch (error) {
    migrationPreflightMessage = error instanceof Error ? error.message : String(error);
    await db.exec("rollback;");
  }
  migrationPreflightRolledBack = (await db.query<{ count: number }>(`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'classes'
      and column_name = 'status'
  `)).rows[0].count === 0;
  await db.query("update public.sessions set status='closed',closed_at=now() where id=$1", [historicalSessionId]);
  await db.exec(migration("20260923131434_academic_foundation.sql"));
  await db.exec(migration("20260924091500_attendance_overrides.sql"));
  await db.exec(migration("20260924104051_override_audit_append_only.sql"));
  await db.exec(migration("20260924125244_navigation_flexible_enrollment.sql"));
  await db.exec(migration("20260924172944_session_identity_colors.sql"));
  await db.exec(migration("20260924181713_session_metadata_audit.sql"));
  await db.exec(migration("20260925103000_class_roster_attendance_policy.sql"));
  await db.exec(migration("20260929103000_projection_bubbles.sql"));
  await db.exec(migration("20260929114500_matrix_soft_deletion_v0_6_5.sql"));
  classId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id,group_name,academic_year) values('Programación','Teacher',$1,'Grupo A','2026–2027') returning id", [teacherId])).rows[0].id;
  secondClassId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Bases de datos','Teacher',$1) returning id", [teacherId])).rows[0].id;
}, 30_000);

afterAll(async () => { await db?.close(); });

describe("v0.6 academic foundation migration", () => {
  it("fails without partial changes while a legacy session remains open", () => {
    expect(migrationPreflightMessage).toContain("V0_6_REQUIRES_ALL_EXISTING_SESSIONS_CLOSED");
    expect(migrationPreflightRolledBack).toBe(true);
  });

  it("archives historical classes without breaking their sessions", async () => {
    expect((await db.query("select status,archived_at is not null as archived from public.classes where id=$1", [historicalClassId])).rows).toEqual([{ status: "archived", archived: true }]);
    expect((await db.query("select class_id,counts_toward_attendance from public.sessions where id=$1", [historicalSessionId])).rows).toEqual([{ class_id: historicalClassId, counts_toward_attendance: true }]);
  });

  it("creates active persistent classes and keeps archive state consistent", async () => {
    expect((await db.query("select status,archived_at,group_name,academic_year from public.classes where id=$1", [classId])).rows).toEqual([{ status: "active", archived_at: null, group_name: "Grupo A", academic_year: "2026–2027" }]);
    await db.query("update public.classes set status='archived',archived_at=now() where id=$1", [secondClassId]);
    await db.query("update public.classes set status='active',archived_at=null where id=$1", [secondClassId]);
    await expect(db.query("update public.classes set status='archived',archived_at=null where id=$1", [secondClassId])).rejects.toMatchObject({ constraint: "classes_archive_state" });
  });

  it("enforces enrollment email, uniqueness and multi-class membership", async () => {
    await db.query("insert into public.class_enrollments(class_id,student_email,student_user_id,created_by) values($1,'student.a@students.example.edu',$2,$3)", [classId, studentA, teacherId]);
    expect((await db.query(`
      select e.status,
        count(p.*)::int as period_count,
        count(*) filter (where ended_at is null)::int as open_count
      from public.class_enrollments e
      join public.class_enrollment_periods p on p.enrollment_id=e.id
      where e.class_id=$1 and e.student_email='student.a@students.example.edu'
      group by e.status
    `, [classId])).rows).toEqual([{ status: "active", period_count: 1, open_count: 1 }]);
    await expect(db.query("insert into public.class_enrollments(class_id,student_email) values($1,'student.a@students.example.edu')", [classId])).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("insert into public.class_enrollments(class_id,student_email) values($1,'teacher@faculty.example.edu')", [classId])).rejects.toMatchObject({ constraint: "class_enrollments_email_normalized" });
    await expect(db.query("insert into public.class_enrollments(class_id,student_email,student_user_id) values($1,'student.a@students.example.edu',$2)", [secondClassId, studentA])).resolves.toBeDefined();
  });

  it("preserves every inactive gap while reusing the stable enrollment row", async () => {
    const created = await db.query<{ id: string }>("select public.enroll_class_student($1,'future.student@students.example.edu',null,$2) as id", [classId, teacherId]);
    const id = created.rows[0].id;
    await db.query("select public.set_class_enrollment_status($1,'deactivate',$2,null)", [id, teacherId]);
    const firstPeriod = (await db.query<{ id: string; started_at: Date; ended_at: Date }>(`
      select e.status,
        p.id,
        p.started_at,
        p.ended_at,
        e.unenrolled_at = p.ended_at as matching_end,
        p.ended_at is not null as period_closed
      from public.class_enrollments e
      join public.class_enrollment_periods p on p.enrollment_id=e.id
      where e.id=$1
    `, [id])).rows[0];
    expect(firstPeriod).toMatchObject({ status: "inactive", matching_end: true, period_closed: true });

    await db.query("select public.enroll_class_student($1,'future.student@students.example.edu',null,$2)", [classId, teacherId]);
    await db.query("select public.set_class_enrollment_status($1,'deactivate',$2,null)", [id, teacherId]);
    await db.query("select public.set_class_enrollment_status($1,'reactivate',$2,null)", [id, teacherId]);
    expect((await db.query("select id,status,student_user_id from public.class_enrollments where class_id=$1 and student_email='future.student@students.example.edu'", [classId])).rows).toEqual([{ id, status: "active", student_user_id: null }]);
    expect((await db.query(`
      select count(*)::int as period_count,
        count(*) filter (where ended_at is null)::int as open_count,
        count(*) filter (where ended_at is not null)::int as closed_count
      from public.class_enrollment_periods
      where enrollment_id=$1
    `, [id])).rows).toEqual([{ period_count: 3, open_count: 1, closed_count: 2 }]);
    expect((await db.query("select id,started_at,ended_at from public.class_enrollment_periods where id=$1", [firstPeriod.id])).rows).toEqual([{
      id: firstPeriod.id,
      started_at: firstPeriod.started_at,
      ended_at: firstPeriod.ended_at,
    }]);
  });

  it("rejects an active enrollment without its open period", async () => {
    const enrollment = await db.query<{ id: string }>("select id from public.class_enrollments where class_id=$1 and student_email='future.student@students.example.edu'", [classId]);
    await expect(db.query("delete from public.class_enrollment_periods where enrollment_id=$1 and ended_at is null", [enrollment.rows[0].id])).rejects.toMatchObject({ message: "ENROLLMENT_PERIOD_REQUIRED" });
    expect((await db.query("select count(*)::int as count from public.class_enrollment_periods where enrollment_id=$1 and ended_at is null", [enrollment.rows[0].id])).rows).toEqual([{ count: 1 }]);
  });

  it("links a pre-created email enrollment to the later real account", async () => {
    await db.query("insert into public.class_enrollments(class_id,student_email) values($1,'student.b@students.example.edu')", [classId]);
    await db.query("update public.class_enrollments set student_user_id=$1 where student_email='student.b@students.example.edu' and student_user_id is null", [studentB]);
    expect((await db.query("select student_user_id from public.class_enrollments where class_id=$1 and student_email='student.b@students.example.edu'", [classId])).rows).toEqual([{ student_user_id: studentB }]);
  });

  it("allows QR attendance only for an active enrollment", async () => {
    const sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id) values($1) returning id", [classId])).rows[0].id;
    await expect(register(sessionId, studentA, "a".repeat(64))).resolves.toBeDefined();
    const enrollment = await db.query<{ id: string }>("select id from public.class_enrollments where class_id=$1 and student_user_id=$2", [classId, studentB]);
    await db.query("select public.set_class_enrollment_status($1,'deactivate',$2,null)", [enrollment.rows[0].id, teacherId]);
    await expect(register(sessionId, studentB, "b".repeat(64))).rejects.toMatchObject({ message: "STUDENT_NOT_ENROLLED" });
  });

  it("allows manual attendance only for an active enrollment", async () => {
    const enrollment = await db.query<{ id: string }>("select id from public.class_enrollments where class_id=$1 and student_user_id=$2", [classId, studentB]);
    await db.query("select public.set_class_enrollment_status($1,'reactivate',$2,null)", [enrollment.rows[0].id, teacherId]);
    const sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id) values($1) returning id", [classId])).rows[0].id;
    await expect(db.query("select public.add_manual_attendance($1,$2,$3,'Student B','student b','Motivo',$4)", [sessionId, studentB, "student.b@students.example.edu", teacherId])).resolves.toBeDefined();
    await expect(db.query("select public.add_manual_attendance($1,null,$2,'Not Enrolled','not enrolled','Motivo',$3)", [sessionId, "missing@students.example.edu", teacherId])).rejects.toMatchObject({ message: "STUDENT_NOT_ENROLLED" });
  });

  it("keeps enrollments server-only with RLS enabled", async () => {
    const privileges = (await db.query(`
      select
        has_table_privilege('anon','public.class_enrollments','SELECT') as anon_select,
        has_table_privilege('authenticated','public.class_enrollments','SELECT') as authenticated_select,
        has_table_privilege('authenticated','public.class_enrollments','INSERT') as authenticated_insert,
        has_table_privilege('service_role','public.class_enrollments','SELECT') as service_select,
        has_table_privilege('service_role','public.class_enrollments','UPDATE') as service_update
    `)).rows[0];
    expect(privileges).toEqual({ anon_select: false, authenticated_select: false, authenticated_insert: false, service_select: true, service_update: true });
    expect((await db.query("select relrowsecurity from pg_class where oid='public.class_enrollments'::regclass")).rows).toEqual([{ relrowsecurity: true }]);

    const periodPrivileges = (await db.query(`
      select
        has_table_privilege('anon','public.class_enrollment_periods','SELECT') as anon_select,
        has_table_privilege('authenticated','public.class_enrollment_periods','SELECT') as authenticated_select,
        has_table_privilege('authenticated','public.class_enrollment_periods','INSERT') as authenticated_insert,
        has_table_privilege('service_role','public.class_enrollment_periods','SELECT') as service_select,
        has_table_privilege('service_role','public.class_enrollment_periods','UPDATE') as service_update
    `)).rows[0];
    expect(periodPrivileges).toEqual({ anon_select: false, authenticated_select: false, authenticated_insert: false, service_select: true, service_update: true });
    expect((await db.query("select relrowsecurity from pg_class where oid='public.class_enrollment_periods'::regclass")).rows).toEqual([{ relrowsecurity: true }]);

    const rpcPrivileges = (await db.query(`
      select
        has_function_privilege('anon','public.enroll_class_student(uuid,text,uuid,uuid)','EXECUTE') as anon_enroll,
        has_function_privilege('authenticated','public.set_class_enrollment_status(uuid,text,uuid,uuid)','EXECUTE') as authenticated_transition,
        has_function_privilege('service_role','public.enroll_class_student(uuid,text,uuid,uuid)','EXECUTE') as service_enroll,
        has_function_privilege('service_role','public.set_class_enrollment_status(uuid,text,uuid,uuid)','EXECUTE') as service_transition
    `)).rows[0];
    expect(rpcPrivileges).toEqual({ anon_enroll: false, authenticated_transition: false, service_enroll: true, service_transition: true });
  });

  it("stores closed class and session enrollment policies by default", async () => {
    expect((await db.query("select enrollment_mode from public.classes where id=$1", [classId])).rows).toEqual([{ enrollment_mode: "closed" }]);
    const policySession = await db.query<{ allow_self_enrollment: boolean }>("insert into public.sessions(class_id) values($1) returning allow_self_enrollment", [classId]);
    expect(policySession.rows).toEqual([{ allow_self_enrollment: false }]);
    await expect(db.query("update public.classes set enrollment_mode='public' where id=$1", [classId])).rejects.toMatchObject({ constraint: "classes_enrollment_mode_allowed" });
  });

  it("self-enrolls only through an open permitted session and starts eligibility at session opening", async () => {
    await db.query("insert into auth.users(id) values($1)", [studentC]);
    await db.query("insert into public.institutional_accounts(user_id,email,role) values($1,'student.c@students.example.edu','student')", [studentC]);
    await db.query("insert into public.student_profiles(user_id,display_name) values($1,'Student C')", [studentC]);
    const openedAt = "2026-09-24T09:00:00.000Z";
    const sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,opened_at,allow_self_enrollment) values($1,$2,true) returning id", [secondClassId, openedAt])).rows[0].id;

    expect((await db.query<{ enrolled: boolean }>("select public.self_enroll_student_for_session($1,$2,$3) as enrolled", [sessionId, studentC, "student.c@students.example.edu"])).rows).toEqual([{ enrolled: true }]);
    expect((await db.query<{ enrolled: boolean }>("select public.self_enroll_student_for_session($1,$2,$3) as enrolled", [sessionId, studentC, "student.c@students.example.edu"])).rows).toEqual([{ enrolled: false }]);
    expect((await db.query(`
      select e.status, e.student_user_id, e.enrolled_at, p.started_at, p.ended_at
      from public.class_enrollments e
      join public.class_enrollment_periods p on p.enrollment_id=e.id
      where e.class_id=$1 and e.student_user_id=$2
    `, [secondClassId, studentC])).rows).toEqual([{
      status: "active",
      student_user_id: studentC,
      enrolled_at: new Date(openedAt),
      started_at: new Date(openedAt),
      ended_at: null,
    }]);
    await expect(register(sessionId, studentC, "c".repeat(64))).resolves.toBeDefined();
  });

  it("does not self-enroll for closed policy, inactive enrollment, closed session or mismatched identity", async () => {
    const closedPolicySession = (await db.query<{ id: string }>("insert into public.sessions(class_id,allow_self_enrollment) values($1,false) returning id", [secondClassId])).rows[0].id;
    await expect(db.query("select public.self_enroll_student_for_session($1,$2,$3)", [closedPolicySession, studentB, "student.b@students.example.edu"])).rejects.toMatchObject({ message: "SELF_ENROLLMENT_DISABLED" });

    const enrollmentId = (await db.query<{ id: string }>("select id from public.class_enrollments where class_id=$1 and student_user_id=$2", [secondClassId, studentA])).rows[0].id;
    await db.query("select public.set_class_enrollment_status($1,'deactivate',$2,$3)", [enrollmentId, teacherId, studentA]);
    const openSession = (await db.query<{ id: string }>("insert into public.sessions(class_id,allow_self_enrollment) values($1,true) returning id", [secondClassId])).rows[0].id;
    await expect(db.query("select public.self_enroll_student_for_session($1,$2,$3)", [openSession, studentA, "student.a@students.example.edu"])).rejects.toMatchObject({ message: "ENROLLMENT_INACTIVE" });
    await expect(db.query("select public.self_enroll_student_for_session($1,$2,$3)", [openSession, studentB, "student.a@students.example.edu"])).rejects.toMatchObject({ message: "INVALID_STUDENT_IDENTITY" });
    await db.query("update public.sessions set status='closed',closed_at=now() where id=$1", [openSession]);
    await expect(db.query("select public.self_enroll_student_for_session($1,$2,$3)", [openSession, studentB, "student.b@students.example.edu"])).rejects.toMatchObject({ message: "SESSION_CLOSED" });
  });

  it("keeps the self-enrollment RPC service-role only", async () => {
    expect((await db.query(`
      select
        has_function_privilege('anon','public.self_enroll_student_for_session(uuid,uuid,text)','EXECUTE') as anon_execute,
        has_function_privilege('authenticated','public.self_enroll_student_for_session(uuid,uuid,text)','EXECUTE') as authenticated_execute,
        has_function_privilege('service_role','public.self_enroll_student_for_session(uuid,uuid,text)','EXECUTE') as service_execute
    `)).rows).toEqual([{ anon_execute: false, authenticated_execute: false, service_execute: true }]);
  });

  it("soft-removes only closed computable sessions and preserves every evidence row", async () => {
    const softClassId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Sistemas','Teacher',$1) returning id", [teacherId])).rows[0].id;
    const enrollmentId = (await db.query<{ id: string }>("select public.enroll_class_student($1,'student.a@students.example.edu',$2,$3) as id", [softClassId, studentA, teacherId])).rows[0].id;
    const sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,session_name,opened_at) values($1,'Evaluación','2026-09-29T09:00:00Z') returning id", [softClassId])).rows[0].id;
    await register(sessionId, studentA, "d".repeat(64));
    await db.query("update public.sessions set status='closed',closed_at='2026-09-29T10:00:00Z' where id=$1", [sessionId]);
    await db.query("select public.update_session_details_with_projection($1,'Evaluación final',(select opened_at from public.sessions where id=$1),'green',true,$2)", [sessionId, teacherId]);
    await db.query("select public.set_attendance_override($1,$2,$3,'present','Justificante',$4)", [softClassId, sessionId, enrollmentId, teacherId]);
    await db.query("select public.remove_attendance_session($1,'Duplicada en la matriz',$2)", [sessionId, teacherId]);
    expect((await db.query("select status,counts_toward_attendance,deleted_at is not null as deleted,delete_reason from public.sessions where id=$1", [sessionId])).rows).toEqual([{
      status: "closed",
      counts_toward_attendance: true,
      deleted: true,
      delete_reason: "Duplicada en la matriz",
    }]);
    expect((await db.query("select count(*)::int as attendance from public.attendance where session_id=$1", [sessionId])).rows).toEqual([{ attendance: 1 }]);
    expect((await db.query("select count(*)::int as overrides from public.attendance_overrides where session_id=$1", [sessionId])).rows).toEqual([{ overrides: 1 }]);
    expect((await db.query("select count(*)::int as audit from public.attendance_override_audit where session_id=$1", [sessionId])).rows).toEqual([{ audit: 1 }]);
    expect((await db.query("select count(*)::int as audit from public.session_audit_log where session_id=$1", [sessionId])).rows).toEqual([{ audit: 1 }]);
    await expect(db.query("update public.sessions set session_name='Cambio tardío' where id=$1", [sessionId])).rejects.toMatchObject({ message: "SESSION_REMOVED" });
    await db.query("update public.sessions set deleted_by=null where id=$1", [sessionId]);
    await expect(db.query("select public.remove_attendance_session($1,'Otra vez',$2)", [sessionId, teacherId])).rejects.toMatchObject({ message: "SESSION_ALREADY_REMOVED" });

    const openSession = (await db.query<{ id: string }>("insert into public.sessions(class_id) values($1) returning id", [classId])).rows[0].id;
    await expect(db.query("select public.remove_attendance_session($1,'Todavía abierta',$2)", [openSession, teacherId])).rejects.toMatchObject({ message: "SESSION_STILL_OPEN" });
    await db.query("update public.sessions set status='closed',closed_at=now(),counts_toward_attendance=false where id=$1", [openSession]);
    await expect(db.query("select public.remove_attendance_session($1,'No computable',$2)", [openSession, teacherId])).rejects.toMatchObject({ message: "SESSION_NOT_COMPUTABLE" });
  });

  it("keeps session soft-removal service-only and its audit fields server-only", async () => {
    expect((await db.query(`
      select
        has_function_privilege('anon','public.remove_attendance_session(uuid,text,uuid)','EXECUTE') as anon_session,
        has_function_privilege('authenticated','public.remove_attendance_session(uuid,text,uuid)','EXECUTE') as authenticated_session,
        has_function_privilege('service_role','public.remove_attendance_session(uuid,text,uuid)','EXECUTE') as service_session
    `)).rows).toEqual([{
      anon_session: false,
      authenticated_session: false,
      service_session: true,
    }]);
    expect((await db.query(`
      select
        has_column_privilege('authenticated','public.sessions','id','SELECT') as authenticated_id,
        has_column_privilege('authenticated','public.sessions','deleted_at','SELECT') as authenticated_deleted_at,
        has_column_privilege('authenticated','public.sessions','deleted_by','SELECT') as authenticated_deleted_by,
        has_column_privilege('authenticated','public.sessions','delete_reason','SELECT') as authenticated_delete_reason,
        has_column_privilege('service_role','public.sessions','deleted_at','SELECT') as service_deleted_at
    `)).rows).toEqual([{
      authenticated_id: true,
      authenticated_deleted_at: false,
      authenticated_deleted_by: false,
      authenticated_delete_reason: false,
      service_deleted_at: true,
    }]);
  });
});
