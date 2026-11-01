begin;

-- Archiving the v0.5.1 one-class-per-session rows is only safe when no legacy
-- attendance session can still accept registrations. The exception aborts the
-- whole migration before any schema or data change is made.
do $$
begin
  if exists (
    select 1
    from public.sessions
    where status = 'open'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'V0_6_REQUIRES_ALL_EXISTING_SESSIONS_CLOSED';
  end if;
end;
$$;

-- v0.5.1 created one class row per attendance session. Preserve every row and
-- relationship, but keep those historical rows out of the new active catalog.
alter table public.classes
  add column group_name text,
  add column academic_year text,
  add column status text not null default 'active',
  add column updated_at timestamptz not null default now(),
  add column archived_at timestamptz,
  add constraint classes_group_name_length check (
    group_name is null or char_length(btrim(group_name)) between 1 and 80
  ),
  add constraint classes_academic_year_length check (
    academic_year is null or char_length(btrim(academic_year)) between 1 and 40
  ),
  add constraint classes_status_allowed check (status in ('active', 'archived')),
  add constraint classes_archive_state check (
    (status = 'active' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  );

update public.classes
set status = 'archived',
    archived_at = now(),
    updated_at = now();

create trigger classes_set_updated_at
before update on public.classes
for each row execute function public.set_institutional_updated_at();

create index classes_teacher_status_updated_idx
  on public.classes (teacher_id, status, updated_at desc);

alter table public.sessions
  add column counts_toward_attendance boolean not null default true;

create table public.class_enrollments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  student_email text not null,
  student_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  unenrolled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_enrollments_email_normalized check (
    student_email = lower(btrim(student_email))
    and student_email ~ '^[a-z0-9]([a-z0-9._+\-]*[a-z0-9])?@students[.]example[.]edu$'
    and student_email !~ '[.][.]'
  ),
  constraint class_enrollments_status_allowed check (status in ('active', 'inactive')),
  constraint class_enrollments_status_window check (
    (status = 'active' and unenrolled_at is null)
    or (status = 'inactive' and unenrolled_at is not null)
  ),
  constraint class_enrollments_class_email_key unique (class_id, student_email)
);

create unique index class_enrollments_class_user_key
  on public.class_enrollments (class_id, student_user_id)
  where student_user_id is not null;

create index class_enrollments_class_status_email_idx
  on public.class_enrollments (class_id, status, student_email);

create index class_enrollments_user_status_idx
  on public.class_enrollments (student_user_id, status)
  where student_user_id is not null;

create index class_enrollments_email_status_idx
  on public.class_enrollments (student_email, status);

create trigger class_enrollments_set_updated_at
before update on public.class_enrollments
for each row execute function public.set_institutional_updated_at();

alter table public.class_enrollments enable row level security;

revoke all on table public.class_enrollments from public, anon, authenticated;
grant select, insert, update, delete on table public.class_enrollments to service_role;

create table public.class_enrollment_periods (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.class_enrollments(id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint class_enrollment_periods_time_order check (
    ended_at is null or ended_at > started_at
  )
);

create unique index class_enrollment_periods_one_open_key
  on public.class_enrollment_periods (enrollment_id)
  where ended_at is null;

create index class_enrollment_periods_enrollment_started_idx
  on public.class_enrollment_periods (enrollment_id, started_at);

alter table public.class_enrollment_periods enable row level security;

revoke all on table public.class_enrollment_periods from public, anon, authenticated;
grant select, insert, update, delete on table public.class_enrollment_periods to service_role;

-- Every new enrollment starts with one open period in the same transaction.
-- The lifecycle RPC below is the only application path for later transitions.
create function public.open_initial_class_enrollment_period()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.class_enrollment_periods (enrollment_id, started_at)
  values (new.id, new.enrolled_at);
  return new;
end;
$$;

create trigger class_enrollments_open_initial_period
after insert on public.class_enrollments
for each row execute function public.open_initial_class_enrollment_period();

revoke all on function public.open_initial_class_enrollment_period() from public, anon, authenticated;

-- Deferred invariant checks allow the lifecycle RPC to update both tables in
-- either order while rejecting any committed state that separates an active
-- enrollment from its one open period.
create function public.assert_class_enrollment_period_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  enrollment_status text;
  open_period_count integer;
  target_enrollment_id uuid;
begin
  if tg_table_name = 'class_enrollments' then
    target_enrollment_id := new.id;
    enrollment_status := new.status;
  else
    target_enrollment_id := case
      when tg_op = 'DELETE' then old.enrollment_id
      else new.enrollment_id
    end;
    select status into enrollment_status
    from public.class_enrollments
    where id = target_enrollment_id;

    if not found then
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end if;
  end if;

  select count(*)::integer into open_period_count
  from public.class_enrollment_periods
  where enrollment_id = target_enrollment_id
    and ended_at is null;

  if enrollment_status = 'active' and open_period_count <> 1 then
    raise exception using errcode = '23514', message = 'ENROLLMENT_PERIOD_REQUIRED';
  end if;

  if enrollment_status = 'inactive' and open_period_count <> 0 then
    raise exception using errcode = '23514', message = 'ENROLLMENT_PERIOD_STATE_INVALID';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger class_enrollments_period_state_check
after insert or update on public.class_enrollments
deferrable initially deferred
for each row execute function public.assert_class_enrollment_period_state();

create constraint trigger class_enrollment_periods_state_check
after insert or update or delete on public.class_enrollment_periods
deferrable initially deferred
for each row execute function public.assert_class_enrollment_period_state();

revoke all on function public.assert_class_enrollment_period_state() from public, anon, authenticated;

-- Both the explicit Reactivate action and POST re-enrollment use this exact
-- transition function, so an inactive gap can never be erased accidentally.
create function public.set_class_enrollment_status(
  p_enrollment_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_student_user_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_enrollment public.class_enrollments%rowtype;
  open_period_id uuid;
  open_period_started_at timestamptz;
  changed_at timestamptz := clock_timestamp();
begin
  if p_action not in ('deactivate', 'reactivate') then
    raise exception using errcode = '22023', message = 'INVALID_ENROLLMENT_ACTION';
  end if;

  select * into current_enrollment
  from public.class_enrollments
  where id = p_enrollment_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ENROLLMENT_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = current_enrollment.class_id
      and teacher_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if p_student_user_id is not null and not exists (
    select 1
    from public.institutional_accounts
    where user_id = p_student_user_id
      and email = current_enrollment.student_email
      and role = 'student'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  if current_enrollment.student_user_id is not null
    and p_student_user_id is not null
    and current_enrollment.student_user_id <> p_student_user_id then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  select id, started_at into open_period_id, open_period_started_at
  from public.class_enrollment_periods
  where enrollment_id = current_enrollment.id
    and ended_at is null
  for update;

  if current_enrollment.status = 'active' and open_period_id is null then
    raise exception using errcode = 'P0001', message = 'ENROLLMENT_PERIOD_REQUIRED';
  end if;

  if current_enrollment.status = 'inactive' and open_period_id is not null then
    raise exception using errcode = 'P0001', message = 'ENROLLMENT_PERIOD_STATE_INVALID';
  end if;

  if p_action = 'deactivate' then
    if current_enrollment.status = 'active' then
      changed_at := greatest(changed_at, open_period_started_at + interval '1 microsecond');

      update public.class_enrollment_periods
      set ended_at = changed_at
      where id = open_period_id;

      update public.class_enrollments
      set status = 'inactive',
          unenrolled_at = changed_at,
          student_user_id = coalesce(student_user_id, p_student_user_id)
      where id = current_enrollment.id;
    end if;
  elsif current_enrollment.status = 'inactive' then
    update public.class_enrollments
    set status = 'active',
        unenrolled_at = null,
        student_user_id = coalesce(student_user_id, p_student_user_id)
    where id = current_enrollment.id;

    insert into public.class_enrollment_periods (enrollment_id, started_at)
    values (current_enrollment.id, changed_at);
  else
    update public.class_enrollments
    set student_user_id = coalesce(student_user_id, p_student_user_id)
    where id = current_enrollment.id;
  end if;

  return current_enrollment.id;
end;
$$;

revoke all on function public.set_class_enrollment_status(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_class_enrollment_status(uuid, text, uuid, uuid)
  to service_role;

-- Enrollment creation and re-adding an existing address are one trusted
-- operation. ON CONFLICT also makes concurrent re-add attempts converge on the
-- stable enrollment row before using the shared lifecycle transition.
create function public.enroll_class_student(
  p_class_id uuid,
  p_student_email text,
  p_student_user_id uuid,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_enrollment public.class_enrollments%rowtype;
  inserted_id uuid;
begin
  if not exists (
    select 1
    from public.classes
    where id = p_class_id
      and teacher_id = p_actor_user_id
      and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if p_student_email is null
    or p_student_email <> lower(btrim(p_student_email))
    or p_student_email !~ '^[a-z0-9]([a-z0-9._+\-]*[a-z0-9])?@students[.]example[.]edu$'
    or p_student_email ~ '[.][.]' then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_EMAIL';
  end if;

  if p_student_user_id is not null and not exists (
    select 1
    from public.institutional_accounts
    where user_id = p_student_user_id
      and email = p_student_email
      and role = 'student'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  insert into public.class_enrollments (
    class_id, student_email, student_user_id, created_by
  ) values (
    p_class_id, p_student_email, p_student_user_id, p_actor_user_id
  )
  on conflict (class_id, student_email) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return inserted_id;
  end if;

  select * into current_enrollment
  from public.class_enrollments
  where class_id = p_class_id
    and student_email = p_student_email
  for update;

  return public.set_class_enrollment_status(
    current_enrollment.id,
    'reactivate',
    p_actor_user_id,
    p_student_user_id
  );
end;
$$;

revoke all on function public.enroll_class_student(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.enroll_class_student(uuid, text, uuid, uuid)
  to service_role;

create or replace function public.register_attendance_if_open(
  p_session_id uuid,
  p_student_user_id uuid,
  p_device_hash text,
  p_location_accuracy double precision,
  p_distance_from_center_m double precision,
  p_gps_status text,
  p_network_city text,
  p_network_region text,
  p_network_country text,
  p_network_country_code text
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_session public.sessions%rowtype;
  authoritative_name text;
  authoritative_email text;
  authoritative_normalized_name text;
  current_enrollment public.class_enrollments%rowtype;
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

  select
    btrim(regexp_replace(student_profiles.display_name, '\s+', ' ', 'g')),
    institutional_accounts.email
  into authoritative_name, authoritative_email
  from public.student_profiles
  join public.institutional_accounts
    on institutional_accounts.user_id = student_profiles.user_id
  where student_profiles.user_id = p_student_user_id
    and institutional_accounts.role = 'student';

  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_IDENTITY_REQUIRED';
  end if;

  select * into current_enrollment
  from public.class_enrollments
  where class_id = current_session.class_id
    and status = 'active'
    and (
      student_user_id = p_student_user_id
      or (student_user_id is null and student_email = authoritative_email)
    )
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_ENROLLED';
  end if;

  if current_enrollment.student_user_id is null then
    update public.class_enrollments
    set student_user_id = p_student_user_id
    where id = current_enrollment.id;
  end if;

  authoritative_normalized_name := lower(authoritative_name);

  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '23502', message = 'DEVICE_HASH_REQUIRED';
  end if;

  if p_gps_status not in ('not_shared', 'shared', 'verified', 'outside', 'inaccurate', 'unavailable') then
    raise exception using errcode = '22023', message = 'INVALID_GPS_STATUS';
  end if;

  if p_gps_status in ('verified', 'outside', 'inaccurate') and (
    current_session.latitude is null
    or current_session.longitude is null
    or current_session.allowed_radius_m is null
  ) then
    raise exception using errcode = '22023', message = 'INVALID_GPS_STATUS';
  end if;

  if exists (
    select 1 from public.attendance
    where session_id = p_session_id
      and student_user_id = p_student_user_id
      and voided_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
  end if;

  if exists (
    select 1 from public.attendance
    where session_id = p_session_id
      and device_hash = p_device_hash
      and voided_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
  end if;

  network_status := case
    when current_session.location_country_code is null or p_network_country_code is null then 'unknown'
    when current_session.location_country_code = p_network_country_code then 'consistent'
    else 'mismatch'
  end;

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
      network_location_status,
      source,
      student_email_snapshot,
      gps_status
    ) values (
      p_session_id,
      p_student_user_id,
      authoritative_name,
      authoritative_normalized_name,
      true,
      p_gps_status = 'verified',
      p_location_accuracy,
      p_distance_from_center_m,
      p_device_hash,
      p_network_city,
      p_network_region,
      p_network_country,
      p_network_country_code,
      network_status,
      'qr',
      authoritative_email,
      p_gps_status
    ) returning id into inserted_id;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
    if violated_constraint = 'attendance_session_device_hash_key' then
      raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
    elsif violated_constraint in (
      'attendance_session_student_user_key',
      'attendance_session_student_email_key'
    ) then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
    else
      raise;
    end if;
  end;

  return inserted_id;
end;
$$;

revoke all on function public.register_attendance_if_open(
  uuid, uuid, text, double precision, double precision, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.register_attendance_if_open(
  uuid, uuid, text, double precision, double precision, text, text, text, text, text
) to service_role;

create or replace function public.add_manual_attendance(
  p_session_id uuid,
  p_student_user_id uuid,
  p_student_email text,
  p_full_name text,
  p_normalized_name text,
  p_manual_reason text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_session public.sessions%rowtype;
  current_enrollment public.class_enrollments%rowtype;
  inserted_id uuid;
begin
  select * into current_session
  from public.sessions
  where id = p_session_id and status = 'open'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'SESSION_CLOSED';
  end if;

  if not exists (
    select 1 from public.classes
    where id = current_session.class_id and teacher_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if p_student_email !~ '^[a-z0-9][a-z0-9._+\-]*@students\.example\.edu$'
    or p_student_email <> lower(btrim(p_student_email))
    or p_manual_reason is null
    or char_length(p_manual_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_MANUAL_ATTENDANCE';
  end if;

  if p_student_user_id is not null and not exists (
    select 1 from public.institutional_accounts
    where user_id = p_student_user_id
      and email = p_student_email
      and role = 'student'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  select * into current_enrollment
  from public.class_enrollments
  where class_id = current_session.class_id
    and student_email = p_student_email
    and status = 'active'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'STUDENT_NOT_ENROLLED';
  end if;

  if p_student_user_id is not null and current_enrollment.student_user_id is null then
    update public.class_enrollments
    set student_user_id = p_student_user_id
    where id = current_enrollment.id;
  elsif p_student_user_id is not null
    and current_enrollment.student_user_id <> p_student_user_id then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  insert into public.attendance (
    session_id,
    student_user_id,
    full_name,
    normalized_name,
    qr_verified,
    location_verified,
    source,
    student_email_snapshot,
    manual_reason,
    created_by,
    gps_status
  ) values (
    p_session_id,
    p_student_user_id,
    p_full_name,
    p_normalized_name,
    false,
    false,
    'manual',
    p_student_email,
    p_manual_reason,
    p_actor_user_id,
    'not_shared'
  ) returning id into inserted_id;

  insert into public.attendance_audit_log (
    attendance_id, session_id, actor_user_id, action, reason
  ) values (
    inserted_id, p_session_id, p_actor_user_id, 'manual_add', p_manual_reason
  );

  return inserted_id;
exception when unique_violation then
  raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
end;
$$;

revoke all on function public.add_manual_attendance(
  uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.add_manual_attendance(
  uuid, uuid, text, text, text, text, uuid
) to service_role;

commit;
