import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const teacherId = "123e4567-e89b-42d3-a456-426614174400";
const otherTeacherId = "123e4567-e89b-42d3-a456-426614174401";
const classId = "123e4567-e89b-42d3-a456-426614174410";
const closedSessionId = "123e4567-e89b-42d3-a456-426614174420";
const openSessionId = "123e4567-e89b-42d3-a456-426614174421";
const migration = readFileSync(new URL(
  "../supabase/migrations/20260924181713_session_metadata_audit.sql",
  import.meta.url,
), "utf8");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.classes (
      id uuid primary key default gen_random_uuid(),
      teacher_id uuid references auth.users(id)
    );
    create table public.sessions (
      id uuid primary key default gen_random_uuid(),
      class_id uuid not null references public.classes(id),
      session_name text,
      opened_at timestamptz not null default now(),
      closed_at timestamptz,
      status text not null default 'open',
      color_key text not null default 'blue'
    );
    create table public.attendance_overrides (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references public.sessions(id),
      enrollment_id uuid not null
    );
    grant select on public.classes to service_role;
    grant select, update on public.sessions to service_role;
    insert into auth.users(id) values
      ('${teacherId}'),
      ('${otherTeacherId}');
    insert into public.classes(id,teacher_id) values ('${classId}','${teacherId}');
    insert into public.sessions(id,class_id,session_name,opened_at,closed_at,status,color_key) values
      ('${closedSessionId}','${classId}','Original','2026-09-24T17:00:00Z','2026-09-24T18:00:00Z','closed','blue'),
      ('${openSessionId}','${classId}','Abierta',now() - interval '10 minutes',null,'open','cyan');
    insert into public.attendance_overrides(session_id,enrollment_id)
      values ('${closedSessionId}','123e4567-e89b-42d3-a456-426614174430');
  `);
  await db.exec(migration);
}, 30_000);

afterAll(async () => { await db?.close(); });

describe("audited session metadata migration", () => {
  it("atomically updates owned metadata and writes its previous and new values", async () => {
    await db.exec("set role service_role");
    try {
      const result = await db.query(`
        select * from public.update_session_details($1,'  Horario corregido  ','2026-09-24T16:30:00Z','green',$2)
      `, [closedSessionId, teacherId]);
      expect(result.rows[0]).toMatchObject({
        session_id: closedSessionId,
        session_name: "Horario corregido",
        color_key: "green",
      });
    } finally {
      await db.exec("reset role");
    }

    expect((await db.query(`
      select action,previous_session_name,new_session_name,previous_color_key,new_color_key
      from public.session_audit_log where session_id=$1
    `, [closedSessionId])).rows).toEqual([{
      action: "update_details",
      previous_session_name: "Original",
      new_session_name: "Horario corregido",
      previous_color_key: "blue",
      new_color_key: "green",
    }]);
    expect((await db.query("select count(*)::int as count from public.attendance_overrides where session_id=$1", [closedSessionId])).rows).toEqual([{ count: 1 }]);
  });

  it("rejects a different teacher, invalid values and invalid closed/open time ranges", async () => {
    await db.exec("set role service_role");
    try {
      await expect(db.query("select public.update_session_details($1,'Name','2026-09-24T16:00:00Z','blue',$2)", [closedSessionId, otherTeacherId])).rejects.toMatchObject({ message: "FORBIDDEN" });
      await expect(db.query("select public.update_session_details($1,'   ','2026-09-24T16:00:00Z','blue',$2)", [closedSessionId, teacherId])).rejects.toMatchObject({ message: "INVALID_SESSION_NAME" });
      await expect(db.query("select public.update_session_details($1,'Name','2026-09-24T16:00:00Z','orange',$2)", [closedSessionId, teacherId])).rejects.toMatchObject({ message: "INVALID_SESSION_COLOR" });
      await expect(db.query("select public.update_session_details($1,'Name','2026-09-24T18:00:00Z','blue',$2)", [closedSessionId, teacherId])).rejects.toMatchObject({ message: "INVALID_SESSION_TIME_RANGE" });
      await expect(db.query("select public.update_session_details($1,'Name',now() + interval '1 hour','blue',$2)", [openSessionId, teacherId])).rejects.toMatchObject({ message: "INVALID_SESSION_TIME_RANGE" });
    } finally {
      await db.exec("reset role");
    }
  });

  it("makes the audit append-only for service role and inaccessible to browser roles", async () => {
    expect((await db.query(`
      select
        has_table_privilege('service_role','public.session_audit_log','SELECT') as service_select,
        has_table_privilege('service_role','public.session_audit_log','INSERT') as service_insert,
        has_table_privilege('service_role','public.session_audit_log','UPDATE') as service_update,
        has_table_privilege('service_role','public.session_audit_log','DELETE') as service_delete,
        has_table_privilege('service_role','public.session_audit_log','TRUNCATE') as service_truncate,
        has_table_privilege('anon','public.session_audit_log','SELECT') as anon_select,
        has_table_privilege('authenticated','public.session_audit_log','SELECT') as authenticated_select,
        has_function_privilege('anon','public.update_session_details(uuid,text,timestamptz,text,uuid)','EXECUTE') as anon_execute,
        has_function_privilege('authenticated','public.update_session_details(uuid,text,timestamptz,text,uuid)','EXECUTE') as authenticated_execute,
        has_function_privilege('service_role','public.update_session_details(uuid,text,timestamptz,text,uuid)','EXECUTE') as service_execute
    `)).rows[0]).toEqual({
      service_select: true,
      service_insert: true,
      service_update: false,
      service_delete: false,
      service_truncate: false,
      anon_select: false,
      authenticated_select: false,
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
    });

    await db.exec("set role service_role");
    try {
      await expect(db.query("select count(*) from public.session_audit_log")).resolves.toBeDefined();
      await expect(db.query(`
        insert into public.session_audit_log (
          session_id, action, previous_session_name, new_session_name,
          previous_opened_at, new_opened_at, previous_color_key, new_color_key
        ) values ($1,'update_details','Horario corregido','Inserción service role',now(),now(),'green','blue')
      `, [closedSessionId])).resolves.toBeDefined();
      await expect(db.query("update public.session_audit_log set action='update_details'")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("delete from public.session_audit_log")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("truncate public.session_audit_log")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });

  it.each(["anon", "authenticated"])("denies direct audit operations to %s", async (role) => {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query("select * from public.session_audit_log")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("insert into public.session_audit_log(session_id,action,new_session_name,previous_opened_at,new_opened_at,previous_color_key,new_color_key) values($1,'update_details','Name',now(),now(),'blue','blue')", [closedSessionId])).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("update public.session_audit_log set action='update_details'")).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("delete from public.session_audit_log")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await db.exec("reset role");
    }
  });
});
