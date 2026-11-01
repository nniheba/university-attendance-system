import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const teacherId = "123e4567-e89b-42d3-a456-426614174300";
const otherTeacherId = "123e4567-e89b-42d3-a456-426614174301";
const studentId = "123e4567-e89b-42d3-a456-426614174302";
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
let db: PGlite;
let classId: string;
let otherClassId: string;
let enrollmentId: string;
let otherEnrollmentId: string;
let sessionId: string;
let outsideSessionId: string;

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
  await db.exec(migration("202609210002_attendance_hardening.sql"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [teacherId, otherTeacherId, studentId]);
  await db.exec(migration("20260921142234_institutional_teacher_auth.sql"));
  await db.exec(migration("20260921152310_teacher_least_privilege.sql"));
  await db.exec(migration("20260921213707_teacher_profiles.sql"));
  await db.exec(migration("20260922145139_institutional_accounts.sql"));
  await db.exec(migration("20260922161109_institutional_email_domains.sql"));
  await db.exec(migration("20260922200450_fast_attendance_flow.sql"));
  await db.query("insert into public.institutional_accounts(user_id,email,role) values($1,'teacher@faculty.example.edu','teacher'),($2,'other@faculty.example.edu','teacher'),($3,'student@students.example.edu','student')", [teacherId, otherTeacherId, studentId]);
  await db.query("insert into public.teacher_profiles(user_id,display_name,avatar_key) values($1,'Teacher','avatar_01'),($2,'Other','avatar_02')", [teacherId, otherTeacherId]);
  await db.query("insert into public.student_profiles(user_id,display_name) values($1,'Student')", [studentId]);
  await db.exec(migration("20260923073137_profile_name_immutability.sql"));
  await db.exec(migration("20260923114500_attendance_integrity.sql"));
  await db.exec(migration("20260923131434_academic_foundation.sql"));
  await db.exec(migration("20260924091500_attendance_overrides.sql"));
  // Reproduce hosted Supabase's broad default service_role table grants before
  // proving that the follow-up migration removes every privilege not required.
  await db.exec("grant all on table public.attendance_override_audit to service_role");
  await db.exec(migration("20260924104051_override_audit_append_only.sql"));
  await db.exec(migration("20260925103000_class_roster_attendance_policy.sql"));

  classId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Programming','Teacher',$1) returning id", [teacherId])).rows[0].id;
  otherClassId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('Databases','Teacher',$1) returning id", [teacherId])).rows[0].id;
  enrollmentId = (await db.query<{ id: string }>("select public.enroll_class_student($1,'student@students.example.edu',$2,$3) as id", [classId, studentId, teacherId])).rows[0].id;
  otherEnrollmentId = (await db.query<{ id: string }>("select public.enroll_class_student($1,'student@students.example.edu',$2,$3) as id", [otherClassId, studentId, teacherId])).rows[0].id;
  const periodStart = (await db.query<{ started_at: Date }>("select started_at from public.class_enrollment_periods where enrollment_id=$1 and ended_at is null", [enrollmentId])).rows[0].started_at;
  sessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,opened_at,status,closed_at) values($1,$2::timestamptz + interval '1 minute','closed',$2::timestamptz + interval '1 hour') returning id", [classId, periodStart])).rows[0].id;
  outsideSessionId = (await db.query<{ id: string }>("insert into public.sessions(class_id,opened_at,status,closed_at) values($1,$2::timestamptz - interval '1 day','closed',$2::timestamptz - interval '23 hours') returning id", [classId, periodStart])).rows[0].id;
}, 30_000);

afterAll(async () => { await db?.close(); });

describe("v0.6 attendance override migration", () => {
  it("sets, changes and clears an override while retaining append-only audit history", async () => {
    const first = (await db.query<{ id: string }>("select public.set_attendance_override($1,$2,$3,'present','Fallo de QR',$4) as id", [classId, sessionId, enrollmentId, teacherId])).rows[0].id;
    const changed = (await db.query<{ id: string }>("select public.set_attendance_override($1,$2,$3,'suspicious','Revisión adicional',$4) as id", [classId, sessionId, enrollmentId, teacherId])).rows[0].id;
    expect(changed).toBe(first);
    await db.query("select public.clear_attendance_override($1,$2,$3,'Restablecer evidencia',$4)", [classId, sessionId, enrollmentId, teacherId]);

    expect((await db.query("select count(*)::int as count from public.attendance_overrides where id=$1", [first])).rows).toEqual([{ count: 0 }]);
    expect((await db.query("select action,previous_status,new_status,reason,override_id from public.attendance_override_audit where session_id=$1 order by created_at,id", [sessionId])).rows).toEqual([
      { action: "set_override", previous_status: null, new_status: "present", reason: "Fallo de QR", override_id: null },
      { action: "change_override", previous_status: "present", new_status: "suspicious", reason: "Revisión adicional", override_id: null },
      { action: "clear_override", previous_status: "suspicious", new_status: null, reason: "Restablecer evidencia", override_id: null },
    ]);
  });

  it("allows historical roster corrections but rejects cross-class and unauthorized corrections", async () => {
    await expect(db.query("select public.set_attendance_override($1,$2,$3,'present','Corrección histórica',$4)", [classId, outsideSessionId, enrollmentId, teacherId])).resolves.toBeDefined();
    expect((await db.query("select status from public.attendance_overrides where session_id=$1 and enrollment_id=$2", [outsideSessionId, enrollmentId])).rows).toEqual([{ status: "present" }]);
    await expect(db.query("select public.set_attendance_override($1,$2,$3,'present','Cruce',$4)", [classId, sessionId, otherEnrollmentId, teacherId])).rejects.toMatchObject({ message: "INVALID_OVERRIDE_RELATION" });
    await expect(db.query("select public.set_attendance_override($1,$2,$3,'present','Sin permiso',$4)", [classId, sessionId, enrollmentId, otherTeacherId])).rejects.toMatchObject({ message: "FORBIDDEN" });
  });

  it("enforces valid reasons and closed computable sessions", async () => {
    const openSession = (await db.query<{ id: string }>("insert into public.sessions(class_id) values($1) returning id", [classId])).rows[0].id;
    await expect(db.query("select public.set_attendance_override($1,$2,$3,'present','   ',$4)", [classId, sessionId, enrollmentId, teacherId])).rejects.toMatchObject({ message: "INVALID_OVERRIDE_REASON" });
    await expect(db.query("select public.set_attendance_override($1,$2,$3,'present','Abierta',$4)", [classId, openSession, enrollmentId, teacherId])).rejects.toMatchObject({ message: "SESSION_NOT_COMPUTABLE" });
  });

  it("keeps both tables server-only, the audit append-only and RPCs service-role-only", async () => {
    expect((await db.query(`
      select
        has_table_privilege('anon','public.attendance_overrides','SELECT') as anon_select,
        has_table_privilege('authenticated','public.attendance_overrides','SELECT') as authenticated_select,
        has_table_privilege('authenticated','public.attendance_overrides','INSERT') as authenticated_insert,
        has_table_privilege('service_role','public.attendance_overrides','UPDATE') as service_update,
        has_table_privilege('service_role','public.attendance_override_audit','SELECT') as audit_select,
        has_table_privilege('service_role','public.attendance_override_audit','INSERT') as audit_insert,
        has_table_privilege('service_role','public.attendance_override_audit','UPDATE') as audit_update,
        has_table_privilege('service_role','public.attendance_override_audit','DELETE') as audit_delete,
        has_table_privilege('service_role','public.attendance_override_audit','TRUNCATE') as audit_truncate,
        has_table_privilege('service_role','public.attendance_override_audit','REFERENCES') as audit_references,
        has_table_privilege('service_role','public.attendance_override_audit','TRIGGER') as audit_trigger
    `)).rows[0]).toEqual({
      anon_select: false,
      authenticated_select: false,
      authenticated_insert: false,
      service_update: true,
      audit_select: true,
      audit_insert: true,
      audit_update: false,
      audit_delete: false,
      audit_truncate: false,
      audit_references: false,
      audit_trigger: false,
    });
    expect((await db.query(`
      select
        has_function_privilege('anon','public.set_attendance_override(uuid,uuid,uuid,text,text,uuid)','EXECUTE') as anon_set,
        has_function_privilege('authenticated','public.clear_attendance_override(uuid,uuid,uuid,text,uuid)','EXECUTE') as authenticated_clear,
        has_function_privilege('service_role','public.set_attendance_override(uuid,uuid,uuid,text,text,uuid)','EXECUTE') as service_set,
        has_function_privilege('service_role','public.clear_attendance_override(uuid,uuid,uuid,text,uuid)','EXECUTE') as service_clear
    `)).rows[0]).toEqual({ anon_set: false, authenticated_clear: false, service_set: true, service_clear: true });

    // Hosted Supabase grants service_role access to existing Data API tables.
    // The minimal PGlite role fixture does not define those platform defaults.
    await db.exec("grant select, update on public.classes, public.sessions to service_role");
    await db.exec("set role service_role");
    try {
      await expect(db.query("select count(*)::int as count from public.attendance_override_audit")).resolves.toBeDefined();
      await expect(db.query(`
        insert into public.attendance_override_audit (
          class_id, session_id, enrollment_id, actor_user_id,
          previous_status, new_status, reason, action
        ) values ($1,$2,$3,$4,null,'present','Direct insert','set_override')
      `, [classId, sessionId, enrollmentId, teacherId])).resolves.toBeDefined();
      await expect(db.query("update public.attendance_override_audit set reason='Changed' where session_id=$1", [sessionId])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("delete from public.attendance_override_audit where session_id=$1", [sessionId])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("truncate public.attendance_override_audit")).rejects.toMatchObject({ code: "42501" });

      await expect(db.query("select public.set_attendance_override($1,$2,$3,'present','Service role',$4)", [classId, sessionId, enrollmentId, teacherId])).resolves.toBeDefined();
      await expect(db.query("select public.clear_attendance_override($1,$2,$3,'Service role clear',$4)", [classId, sessionId, enrollmentId, teacherId])).resolves.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  it.each(["authenticated", "anon"])("denies every direct audit-table operation to %s", async (role) => {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query("select * from public.attendance_override_audit limit 1")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query(`
        insert into public.attendance_override_audit (
          class_id, session_id, enrollment_id, actor_user_id,
          previous_status, new_status, reason, action
        ) values ($1,$2,$3,$4,null,'present','Denied insert','set_override')
      `, [classId, sessionId, enrollmentId, teacherId])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("update public.attendance_override_audit set reason='Denied update'")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("delete from public.attendance_override_audit")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
});
