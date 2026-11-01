begin;

create table public.institutional_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null check (role in ('student', 'teacher')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint institutional_accounts_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?@faculty[.]example[.]edu$'
    and email !~ '[.][.]'
  )
);

create table public.teacher_allowlist (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint teacher_allowlist_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?@faculty[.]example[.]edu$'
    and email !~ '[.][.]'
  )
);

create table public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_profiles_display_name_length
    check (char_length(btrim(display_name)) between 2 and 80),
  constraint student_profiles_display_name_normalized
    check (display_name = btrim(regexp_replace(display_name, '\s+', ' ', 'g')))
);

create function public.set_institutional_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_institutional_updated_at() from public, anon, authenticated;

create trigger institutional_accounts_updated_at
before update on public.institutional_accounts
for each row execute function public.set_institutional_updated_at();

create trigger student_profiles_updated_at
before update on public.student_profiles
for each row execute function public.set_institutional_updated_at();

alter table public.institutional_accounts enable row level security;
alter table public.teacher_allowlist enable row level security;
alter table public.student_profiles enable row level security;

revoke all on table public.institutional_accounts from anon, authenticated;
revoke all on table public.teacher_allowlist from anon, authenticated;
revoke all on table public.student_profiles from anon, authenticated;

grant select on table public.institutional_accounts to authenticated;
grant select, insert, update, delete on table public.institutional_accounts to service_role;
grant select, insert, update, delete on table public.teacher_allowlist to service_role;
grant select, insert, update, delete on table public.student_profiles to service_role;
grant select on table public.student_profiles to authenticated;
grant update (display_name) on table public.student_profiles to authenticated;

create policy "users read their own institutional account"
on public.institutional_accounts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "students read their own profile"
on public.student_profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'student'
  )
);

create policy "students update their own profile"
on public.student_profiles
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'student'
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'student'
  )
);

-- Existing teacher profiles remain in place. Institutional role becomes the
-- authorization source for direct authenticated access to those profiles.
drop policy if exists "teachers read their own profile" on public.teacher_profiles;
drop policy if exists "teachers create their own profile" on public.teacher_profiles;
drop policy if exists "teachers update their own profile" on public.teacher_profiles;

create policy "teachers read their own profile"
on public.teacher_profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'teacher'
  )
);

create policy "teachers create their own profile"
on public.teacher_profiles
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'teacher'
  )
);

create policy "teachers update their own profile"
on public.teacher_profiles
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'teacher'
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.institutional_accounts
    where institutional_accounts.user_id = (select auth.uid())
      and institutional_accounts.role = 'teacher'
  )
);

alter table public.attendance
  add column student_user_id uuid references auth.users(id) on delete set null;

drop index if exists public.attendance_session_student_user_key;
create unique index attendance_session_student_user_key
  on public.attendance (session_id, student_user_id)
  where student_user_id is not null;

alter table public.attendance
  drop constraint attendance_session_normalized_name_key;

-- Replace the v0.2 overload so every new application registration carries an
-- authenticated student identity. Names are read from the trusted profile,
-- never accepted as RPC input.
drop function public.register_attendance_if_open(
  uuid, text, text, double precision, double precision, text, text, text, text, text, text
);

create function public.register_attendance_if_open(
  p_session_id uuid,
  p_student_user_id uuid,
  p_location_accuracy double precision,
  p_distance_from_center_m double precision,
  p_device_hash text,
  p_network_city text,
  p_network_region text,
  p_network_country text,
  p_network_country_code text,
  p_network_location_status text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_session public.sessions%rowtype;
  authoritative_name text;
  authoritative_normalized_name text;
  inserted_id uuid;
  violated_constraint text;
  network_status text;
begin
  select * into current_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found or current_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'SESSION_CLOSED';
  end if;

  select btrim(regexp_replace(student_profiles.display_name, '\s+', ' ', 'g'))
    into authoritative_name
  from public.student_profiles
  join public.institutional_accounts
    on institutional_accounts.user_id = student_profiles.user_id
  where student_profiles.user_id = p_student_user_id
    and institutional_accounts.role = 'student';

  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_IDENTITY_REQUIRED';
  end if;

  authoritative_normalized_name := lower(authoritative_name);

  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '23502', message = 'DEVICE_HASH_REQUIRED';
  end if;

  if p_location_accuracy is null or p_distance_from_center_m is null
    or not (p_location_accuracy between 0 and least(50, current_session.allowed_radius_m / 2.0))
    or not (
      p_distance_from_center_m >= 0
      and p_distance_from_center_m + p_location_accuracy <= current_session.allowed_radius_m
    ) then
    raise exception using errcode = 'P0001', message = 'INVALID_LOCATION';
  end if;

  if exists (
    select 1 from public.attendance
    where session_id = p_session_id and device_hash = p_device_hash
  ) then
    raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
  end if;

  if exists (
    select 1 from public.attendance
    where session_id = p_session_id and student_user_id = p_student_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
  end if;

  network_status := case
    when current_session.location_country_code is null or p_network_country_code is null then 'unknown'
    when current_session.location_country_code = p_network_country_code then 'consistent'
    else 'mismatch'
  end;

  if p_network_location_status is distinct from network_status then
    raise exception using errcode = 'P0001', message = 'INVALID_NETWORK_STATUS';
  end if;

  begin
    insert into public.attendance (
      session_id,
      student_user_id,
      full_name,
      normalized_name,
      qr_verified,
      location_verified,
      location_accuracy,
      distance_from_center_m,
      device_hash,
      network_city,
      network_region,
      network_country,
      network_country_code,
      network_location_status
    ) values (
      p_session_id,
      p_student_user_id,
      authoritative_name,
      authoritative_normalized_name,
      true,
      true,
      p_location_accuracy,
      p_distance_from_center_m,
      p_device_hash,
      p_network_city,
      p_network_region,
      p_network_country,
      p_network_country_code,
      network_status
    ) returning id into inserted_id;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
    if violated_constraint = 'attendance_session_device_hash_key' then
      raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
    elsif violated_constraint = 'attendance_session_student_user_key' then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
    else
      raise;
    end if;
  end;

  return inserted_id;
end;
$$;

revoke all on function public.register_attendance_if_open(
  uuid, uuid, double precision, double precision, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.register_attendance_if_open(
  uuid, uuid, double precision, double precision, text, text, text, text, text, text
) to service_role;

commit;
