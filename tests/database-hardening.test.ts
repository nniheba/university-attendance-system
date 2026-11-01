import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
let classId: string;
let legacySession: string;
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const teacherA = "123e4567-e89b-42d3-a456-426614174001";
const teacherB = "123e4567-e89b-42d3-a456-426614174002";
const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

async function session() {
  const result = await db.query<{ id: string }>("insert into public.sessions(class_id, latitude, longitude, allowed_radius_m, location_country_code) values($1,0,0,100,'ES') returning id", [classId]);
  return result.rows[0].id;
}
async function register(sessionId: string, name: string, hash: string | null, accuracy = 10, distance = 10, country: string | null = null) {
  return db.query("select public.register_attendance_if_open($1::uuid,$2,$3,$4::float8,$5::float8,$6,$7,$8,$9,$10,$11) as id", [sessionId, name, name.toLowerCase(), accuracy, distance, hash, null, null, null, country, country ? country === "ES" ? "consistent" : "mismatch" : "unknown"]);
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
  // PGlite already provides gen_random_uuid; only the unavailable extension is skipped.
  await db.exec(migration("202609210001_attendance_alpha.sql").replace("create extension if not exists pgcrypto;", ""));
  classId = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name) values('Test','Teacher') returning id")).rows[0].id;
  legacySession = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [classId])).rows[0].id;
  await db.query("insert into public.attendance(session_id,full_name,normalized_name,qr_verified,location_verified) values($1,'Legacy Student','legacy student',true,true)", [legacySession]);
  await db.exec(migration("202609210002_attendance_hardening.sql"));
  await db.query("insert into auth.users(id) values($1),($2)", [teacherA, teacherB]);
  await db.exec(migration("20260921142234_institutional_teacher_auth.sql"));
  await db.exec(migration("20260921152310_teacher_least_privilege.sql"));
  await db.exec(migration("20260921213707_teacher_profiles.sql"));
}, 30000);
afterAll(async () => { await db?.close(); });

describe("hardening migration in embedded PostgreSQL", () => {
  it("grants authenticated teachers only the profile operations protected by own-row RLS", async () => {
    const authenticatedGrants = await db.query(`
      select privilege_type
      from information_schema.role_table_grants
      where grantee = 'authenticated'
        and table_schema = 'public'
        and table_name = 'teacher_profiles'
      order by privilege_type
    `);
    expect(authenticatedGrants.rows).toEqual([
      { privilege_type: "INSERT" },
      { privilege_type: "SELECT" },
      { privilege_type: "UPDATE" },
    ]);
    const anonymousGrants = await db.query(`
      select privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and table_name = 'teacher_profiles'
    `);
    expect(anonymousGrants.rows).toEqual([]);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [teacherA]);
    await db.exec("set role authenticated");
    try {
      await db.query("insert into public.teacher_profiles(user_id,display_name,avatar_key) values($1,'Teacher A','avatar_01')", [teacherA]);
      expect((await db.query("select display_name,avatar_key from public.teacher_profiles")).rows).toEqual([
        { display_name: "Teacher A", avatar_key: "avatar_01" },
      ]);
      await expect(db.query("insert into public.teacher_profiles(user_id,display_name) values($1,'Forged Teacher')", [teacherB])).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [teacherB]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select user_id from public.teacher_profiles")).rows).toEqual([]);
      expect((await db.query("update public.teacher_profiles set display_name='Forged' where user_id=$1 returning user_id", [teacherA])).rows).toEqual([]);
      await db.query("insert into public.teacher_profiles(user_id,display_name,avatar_key) values($1,'Teacher B','avatar_02')", [teacherB]);
      expect((await db.query("update public.teacher_profiles set display_name='Teacher B Updated',avatar_key='avatar_03' where user_id=$1 returning display_name,avatar_key", [teacherB])).rows).toEqual([
        { display_name: "Teacher B Updated", avatar_key: "avatar_03" },
      ]);
    } finally {
      await db.exec("reset role");
    }

    await db.exec("set role anon");
    try {
      await expect(db.query("select user_id from public.teacher_profiles")).rejects.toBeDefined();
    } finally {
      await db.exec("reset role");
    }
  });

  it("enforces profile name length and the local avatar allowlist", async () => {
    const userShort = "123e4567-e89b-42d3-a456-426614174011";
    const userLong = "123e4567-e89b-42d3-a456-426614174012";
    const userAvatar = "123e4567-e89b-42d3-a456-426614174013";
    await db.query("insert into auth.users(id) values($1),($2),($3)", [userShort, userLong, userAvatar]);
    await expect(db.query("insert into public.teacher_profiles(user_id,display_name) values($1,'A')", [userShort])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("insert into public.teacher_profiles(user_id,display_name) values($1,$2)", [userLong, "A".repeat(81)])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("insert into public.teacher_profiles(user_id,display_name,avatar_key) values($1,'Valid Name','remote_url')", [userAvatar])).rejects.toMatchObject({ code: "23514" });
  });

  it("limits direct client table grants without changing teacher RLS or the owner trigger", async () => {
    const authenticatedGrants = await db.query(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'authenticated'
        and table_schema = 'public'
        and table_name in ('classes', 'sessions', 'attendance')
      order by table_name, privilege_type
    `);
    expect(authenticatedGrants.rows).toEqual([
      { table_name: "attendance", privilege_type: "SELECT" },
      { table_name: "classes", privilege_type: "SELECT" },
      { table_name: "sessions", privilege_type: "SELECT" },
    ]);

    const anonymousGrants = await db.query(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where grantee = 'anon'
        and table_schema = 'public'
        and table_name in ('classes', 'sessions', 'attendance')
    `);
    expect(anonymousGrants.rows).toEqual([]);

    const policies = await db.query(`
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename in ('classes', 'sessions', 'attendance')
      order by policyname
    `);
    expect(policies.rows).toEqual([
      { policyname: "teachers read attendance for their sessions" },
      { policyname: "teachers read sessions for their classes" },
      { policyname: "teachers read their own classes" },
    ]);

    const trigger = await db.query(`
      select tgenabled
      from pg_trigger
      where tgrelid = 'public.classes'::regclass
        and tgname = 'classes_teacher_required'
        and not tgisinternal
    `);
    expect(trigger.rows).toEqual([{ tgenabled: "O" }]);
  });

  it("preserves historical rows with null device and unknown network", async () => {
    const result = await db.query("select full_name,device_hash,network_location_status from public.attendance where session_id=$1", [legacySession]);
    expect(result.rows).toEqual([{ full_name: "Legacy Student", device_hash: null, network_location_status: "unknown" }]);
  });
  it("preserves legacy ownerless classes but requires an owner for every new class", async () => {
    const legacy = await db.query("select teacher_id from public.classes where id=$1", [classId]);
    expect(legacy.rows).toEqual([{ teacher_id: null }]);
    await expect(db.query("insert into public.classes(name,teacher_name) values('No owner','Teacher')")).rejects.toMatchObject({ message: "TEACHER_ID_REQUIRED" });
    await expect(db.query("insert into public.classes(name,teacher_name,teacher_id) values('Owned','Teacher',$1)", [teacherA])).resolves.toBeDefined();
  });

  it("denies anonymous reads and isolates teacher reads with RLS", async () => {
    const ownClass = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('A','Teacher A',$1) returning id", [teacherA])).rows[0].id;
    const otherClass = (await db.query<{ id: string }>("insert into public.classes(name,teacher_name,teacher_id) values('B','Teacher B',$1) returning id", [teacherB])).rows[0].id;
    const ownSession = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [ownClass])).rows[0].id;
    const otherSession = (await db.query<{ id: string }>("insert into public.sessions(class_id,latitude,longitude,allowed_radius_m) values($1,0,0,100) returning id", [otherClass])).rows[0].id;
    await register(ownSession, "Owned Student", hashA);
    await register(otherSession, "Other Student", hashB);

    await db.exec("set role anon");
    await expect(db.query("select id from public.attendance")).rejects.toBeDefined();
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [teacherA]);
    await db.exec("set role authenticated");
    try {
      expect((await db.query("select name from public.classes where name in ('A','B') order by name")).rows).toEqual([{ name: "A" }]);
      expect((await db.query("select id from public.sessions where id in ($1,$2)", [ownSession, otherSession])).rows).toEqual([{ id: ownSession }]);
      expect((await db.query("select full_name from public.attendance where session_id in ($1,$2)", [ownSession, otherSession])).rows).toEqual([{ full_name: "Owned Student" }]);
    } finally {
      await db.exec("reset role");
    }
  });
  it("rejects same device with same or different name in one session", async () => {
    const id = await session();
    await register(id, "Nicolás Herrera", hashA);
    await expect(register(id, "Nicolás Herrera", hashA)).rejects.toMatchObject({ message: "DEVICE_ALREADY_USED" });
    await expect(register(id, "Juan Pérez", hashA)).rejects.toMatchObject({ message: "DEVICE_ALREADY_USED" });
  });
  it("accepts the same device in a different session and distinct devices/names", async () => {
    const first = await session();
    const second = await session();
    await register(first, "Nicolás Herrera", hashA);
    await expect(register(second, "Juan Pérez", hashA)).resolves.toBeDefined();
    await expect(register(first, "Juan Pérez", hashB)).resolves.toBeDefined();
  });
  it("retains the independent name duplicate error", async () => {
    const id = await session();
    await register(id, "Juan Pérez", hashA);
    await expect(register(id, "JUAN PÉREZ", hashB)).rejects.toMatchObject({ message: "DUPLICATE_ATTENDANCE" });
  });
  it("enforces the partial unique index even outside the RPC", async () => {
    const id = await session();
    await register(id, "Juan Pérez", hashA);
    await expect(db.query("insert into public.attendance(session_id,full_name,normalized_name,qr_verified,location_verified,device_hash) values($1,'Other Student','other student',true,true,$2)", [id, hashA])).rejects.toMatchObject({ code: "23505", constraint: "attendance_session_device_hash_key" });
  });
  it("requires a device for new RPC and direct inserts", async () => {
    const id = await session();
    await expect(register(id, "Juan Pérez", null)).rejects.toMatchObject({ message: "DEVICE_HASH_REQUIRED" });
    await expect(db.query("insert into public.attendance(session_id,full_name,normalized_name,qr_verified,location_verified) values($1,'Other Student','other student',true,true)", [id])).rejects.toMatchObject({ message: "DEVICE_HASH_REQUIRED" });
  });
  it("allows only one winner for competing registrations", async () => {
    const id = await session();
    const results = await Promise.allSettled([register(id, "First Student", hashA), register(id, "Second Student", hashA)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await db.query("select id from public.attendance where session_id=$1", [id])).rows).toHaveLength(1);
  });
  it("rejects registrations after closing", async () => {
    const id = await session();
    await db.query("update public.sessions set status='closed', closed_at=now() where id=$1", [id]);
    await expect(register(id, "Juan Pérez", hashA)).rejects.toMatchObject({ message: "SESSION_CLOSED" });
  });
  it.each([[30, 80], [10, 95], [51, 0], [-1, 0], [10, -1], [NaN, 0], [10, Infinity]])("enforces strict accuracy %s / distance %s in SQL", async (accuracy, distance) => {
    await expect(register(await session(), "Juan Pérez", hashA, accuracy, distance)).rejects.toMatchObject({ message: "INVALID_LOCATION" });
  });
  it("accepts a network-country mismatch when GPS is valid", async () => {
    const id = await session();
    await register(id, "Juan Pérez", hashA, 30, 60, "CA");
    const row = (await db.query("select device_hash, network_location_status from public.attendance where session_id=$1", [id])).rows[0];
    expect(row).toEqual({ device_hash: hashA, network_location_status: "mismatch" });
  });
  it("has no raw student GPS, IP or cookie columns", async () => {
    const columns = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema='public' and table_name='attendance'")).rows.map((row) => row.column_name);
    for (const forbidden of ["latitude", "longitude", "ip_address", "device_id", "device_cookie", "user_agent"]) expect(columns).not.toContain(forbidden);
  });
  it("removes the old overload and denies public RPC access", async () => {
    const functions = await db.query<{ oid: number; pronargs: number }>("select oid,pronargs from pg_proc where proname='register_attendance_if_open'");
    expect(functions.rows).toHaveLength(1);
    expect(functions.rows[0].pronargs).toBe(11);
    const permissions = await db.query("select has_function_privilege('anon',$1::oid,'EXECUTE') as anon, has_function_privilege('authenticated',$1::oid,'EXECUTE') as authenticated, has_function_privilege('service_role',$1::oid,'EXECUTE') as server", [functions.rows[0].oid]);
    expect(permissions.rows[0]).toEqual({ anon: false, authenticated: false, server: true });
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname='attendance'");
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });
});
