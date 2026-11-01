import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const teacherId = "123e4567-e89b-42d3-a456-426614174500";
const otherTeacherId = "123e4567-e89b-42d3-a456-426614174501";
const classId = "123e4567-e89b-42d3-a456-426614174510";
const sessionId = "123e4567-e89b-42d3-a456-426614174520";
const previousMigration = readFileSync(new URL(
  "../supabase/migrations/20260924181713_session_metadata_audit.sql",
  import.meta.url,
), "utf8");
const migration = readFileSync(new URL(
  "../supabase/migrations/20260929103000_projection_bubbles.sql",
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
    grant select, insert, update on public.sessions to service_role;
    insert into auth.users(id) values ('${teacherId}'), ('${otherTeacherId}');
    insert into public.classes(id,teacher_id) values ('${classId}','${teacherId}');
    insert into public.sessions(id,class_id,session_name,opened_at,status,color_key)
      values ('${sessionId}','${classId}','Original',now() - interval '10 minutes','open','blue');
  `);
  await db.exec(previousMigration);
  await db.exec(migration);
}, 30_000);

afterAll(async () => { await db?.close(); });

describe("projection bubbles session migration", () => {
  it("backfills existing sessions and defaults new sessions to enabled", async () => {
    expect((await db.query(
      "select enable_projection_bubbles from public.sessions where id=$1",
      [sessionId],
    )).rows).toEqual([{ enable_projection_bubbles: true }]);

    expect((await db.query(`
      insert into public.sessions(class_id,session_name) values($1,'Nueva')
      returning enable_projection_bubbles
    `, [classId])).rows).toEqual([{ enable_projection_bubbles: true }]);
  });

  it("atomically toggles true and false while preserving ownership checks", async () => {
    await db.exec("set role service_role");
    try {
      const disabled = await db.query(`
        select * from public.update_session_details_with_projection(
          $1,'Sin burbujas',now() - interval '9 minutes','cyan',false,$2
        )
      `, [sessionId, teacherId]);
      expect(disabled.rows[0]).toMatchObject({
        session_id: sessionId,
        enable_projection_bubbles: false,
      });

      const enabled = await db.query(`
        select * from public.update_session_details_with_projection(
          $1,'Con burbujas',now() - interval '8 minutes','green',true,$2
        )
      `, [sessionId, teacherId]);
      expect(enabled.rows[0]).toMatchObject({
        session_id: sessionId,
        enable_projection_bubbles: true,
      });

      await expect(db.query(`
        select public.update_session_details_with_projection(
          $1,'Ajena',now() - interval '7 minutes','blue',false,$2
        )
      `, [sessionId, otherTeacherId])).rejects.toMatchObject({ message: "FORBIDDEN" });
    } finally {
      await db.exec("reset role");
    }
  });

  it("preserves the setting for omitted legacy edits and keeps the old RPC callable", async () => {
    await db.exec("set role service_role");
    try {
      const preserved = await db.query(`
        select * from public.update_session_details_with_projection(
          $1,'Edición compatible',now() - interval '7 minutes','purple',null,$2
        )
      `, [sessionId, teacherId]);
      expect(preserved.rows[0]).toMatchObject({ enable_projection_bubbles: true });

      await expect(db.query(`
        select * from public.update_session_details(
          $1,'Cliente anterior',now() - interval '6 minutes','slate',$2
        )
      `, [sessionId, teacherId])).resolves.toBeDefined();
      expect((await db.query(
        "select enable_projection_bubbles from public.sessions where id=$1",
        [sessionId],
      )).rows).toEqual([{ enable_projection_bubbles: true }]);
    } finally {
      await db.exec("reset role");
    }
  });

  it("exposes only the extended RPC to service role", async () => {
    expect((await db.query(`
      select
        has_function_privilege(
          'anon',
          'public.update_session_details_with_projection(uuid,text,timestamptz,text,boolean,uuid)',
          'EXECUTE'
        ) as anon_execute,
        has_function_privilege(
          'authenticated',
          'public.update_session_details_with_projection(uuid,text,timestamptz,text,boolean,uuid)',
          'EXECUTE'
        ) as authenticated_execute,
        has_function_privilege(
          'service_role',
          'public.update_session_details_with_projection(uuid,text,timestamptz,text,boolean,uuid)',
          'EXECUTE'
        ) as service_execute
    `)).rows[0]).toEqual({
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
    });
  });
});
