begin;

create extension if not exists pgcrypto;

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  teacher_name text not null check (char_length(btrim(teacher_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  allowed_radius_m integer not null check (allowed_radius_m between 10 and 5000),
  created_at timestamptz not null default now(),
  constraint sessions_closed_state_consistent check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete restrict,
  full_name text not null check (char_length(full_name) between 3 and 120),
  normalized_name text not null check (char_length(normalized_name) between 3 and 120),
  registered_at timestamptz not null default now(),
  qr_verified boolean not null,
  location_verified boolean not null,
  location_accuracy double precision check (location_accuracy >= 0),
  distance_from_center_m double precision check (distance_from_center_m >= 0),
  created_at timestamptz not null default now(),
  constraint attendance_session_normalized_name_key unique (session_id, normalized_name),
  constraint verified_attendance_only check (qr_verified and location_verified)
);

create index attendance_session_registered_at_idx
  on public.attendance (session_id, registered_at);
create index sessions_class_created_at_idx
  on public.sessions (class_id, created_at desc);

-- Serialize registration against session closing. The API validates token,
-- geolocation and name first; this function enforces the final open-state check
-- and insert as one database transaction.
create function public.register_attendance_if_open(
  p_session_id uuid,
  p_full_name text,
  p_normalized_name text,
  p_location_accuracy double precision,
  p_distance_from_center_m double precision
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status text;
  inserted_id uuid;
begin
  select status
    into current_status
    from public.sessions
    where id = p_session_id
    for update;

  if not found or current_status <> 'open' then
    raise exception using errcode = 'P0001', message = 'SESSION_CLOSED';
  end if;

  insert into public.attendance (
    session_id,
    full_name,
    normalized_name,
    qr_verified,
    location_verified,
    location_accuracy,
    distance_from_center_m
  ) values (
    p_session_id,
    p_full_name,
    p_normalized_name,
    true,
    true,
    p_location_accuracy,
    p_distance_from_center_m
  ) returning id into inserted_id;

  return inserted_id;
end;
$$;

revoke all on function public.register_attendance_if_open(
  uuid, text, text, double precision, double precision
) from public, anon, authenticated;
grant execute on function public.register_attendance_if_open(
  uuid, text, text, double precision, double precision
) to service_role;

alter table public.classes enable row level security;
alter table public.sessions enable row level security;
alter table public.attendance enable row level security;

-- This Alpha has no teacher authentication. Public read access is limited to
-- attendance data needed by Realtime. Classes and sessions have no public
-- policies. All writes use the server-only service role.
create policy "public can read attendance for realtime"
  on public.attendance for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.attendance;

commit;
