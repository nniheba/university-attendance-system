begin;

create table public.student_trusted_devices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_hash text not null unique check (device_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger student_trusted_devices_set_updated_at
before update on public.student_trusted_devices
for each row execute function public.set_institutional_updated_at();

alter table public.student_trusted_devices enable row level security;

revoke all on public.student_trusted_devices from public, anon, authenticated;
grant all on public.student_trusted_devices to service_role;

alter table public.attendance
  add column source text not null default 'qr'
    check (source in ('qr', 'manual')),
  add column student_email_snapshot text
    check (
      student_email_snapshot is null
      or student_email_snapshot ~ '^[a-z0-9][a-z0-9._+\-]*@students\.example\.edu$'
    ),
  add column review_status text not null default 'normal'
    check (review_status in ('normal', 'suspicious')),
  add column teacher_note text check (char_length(teacher_note) <= 500),
  add column manual_reason text check (char_length(manual_reason) between 1 and 500),
  add column created_by uuid references auth.users(id) on delete set null,
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users(id) on delete set null,
  add column void_reason text check (char_length(void_reason) between 1 and 500),
  add column gps_status text not null default 'not_shared'
    check (gps_status in ('not_shared', 'shared', 'verified', 'outside', 'inaccurate', 'unavailable'));

alter table public.attendance
  drop constraint verified_attendance_only,
  add constraint attendance_source_verification check (
    (source = 'qr' and qr_verified)
    or (source = 'manual' and not qr_verified)
  ),
  add constraint attendance_manual_fields check (
    source <> 'manual'
    or (
      manual_reason is not null
      and student_email_snapshot is not null
      and device_hash is null
    )
  ),
  add constraint attendance_void_fields check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and void_reason is not null)
  );

drop trigger attendance_device_hash_required on public.attendance;
drop function public.require_attendance_device_hash();

create function public.require_qr_attendance_device_hash() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'qr' and new.device_hash is null then
    raise exception using errcode = '23502', message = 'DEVICE_HASH_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function public.require_qr_attendance_device_hash()
  from public, anon, authenticated;

create trigger attendance_qr_device_hash_required
before insert or update of source, device_hash on public.attendance
for each row execute function public.require_qr_attendance_device_hash();

drop index public.attendance_session_student_user_key;
drop index public.attendance_session_device_hash_key;

create unique index attendance_session_student_user_key
  on public.attendance (session_id, student_user_id)
  where student_user_id is not null and voided_at is null;

create unique index attendance_session_device_hash_key
  on public.attendance (session_id, device_hash)
  where device_hash is not null and voided_at is null;

create unique index attendance_session_student_email_key
  on public.attendance (session_id, student_email_snapshot)
  where student_email_snapshot is not null and voided_at is null;

create index attendance_session_active_registered_idx
  on public.attendance (session_id, registered_at, id)
  where voided_at is null;

create table public.attendance_audit_log (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid references public.attendance(id) on delete restrict,
  session_id uuid references public.sessions(id) on delete restrict,
  subject_user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (
    action in ('manual_add', 'mark_suspicious', 'clear_suspicious', 'note_update', 'void', 'device_reset')
  ),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  constraint attendance_audit_target check (
    (action = 'device_reset' and attendance_id is null and session_id is null)
    or (action <> 'device_reset' and attendance_id is not null and session_id is not null)
  )
);

create index attendance_audit_attendance_created_idx
  on public.attendance_audit_log (attendance_id, created_at);

create index attendance_audit_session_created_idx
  on public.attendance_audit_log (session_id, created_at);

alter table public.attendance_audit_log enable row level security;

revoke all on public.attendance_audit_log from public, anon, authenticated;
grant all on public.attendance_audit_log to service_role;

drop function public.register_attendance_if_open(
  uuid, uuid, text, text, text, text, text
);

create function public.register_attendance_if_open(
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

create function public.add_manual_attendance(
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
  inserted_id uuid;
begin
  perform 1 from public.sessions
  where id = p_session_id and status = 'open'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SESSION_CLOSED';
  end if;

  if p_student_email !~ '^[a-z0-9][a-z0-9._+\-]*@students\.example\.edu$'
    or p_manual_reason is null
    or char_length(p_manual_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_MANUAL_ATTENDANCE';
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

create function public.moderate_attendance(
  p_session_id uuid,
  p_attendance_id uuid,
  p_action text,
  p_value text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_attendance public.attendance%rowtype;
  audit_reason text;
begin
  select * into current_attendance
  from public.attendance
  where id = p_attendance_id and session_id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_NOT_FOUND';
  end if;

  if p_value is not null and char_length(p_value) > 500 then
    raise exception using errcode = '22023', message = 'VALUE_TOO_LONG';
  end if;

  if p_action = 'mark_suspicious' then
    if current_attendance.voided_at is not null then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_VOIDED';
    end if;
    update public.attendance
      set review_status = 'suspicious',
          teacher_note = coalesce(p_value, teacher_note)
      where id = p_attendance_id;
    audit_reason := p_value;
  elsif p_action = 'clear_suspicious' then
    if current_attendance.voided_at is not null then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_VOIDED';
    end if;
    update public.attendance
      set review_status = 'normal'
      where id = p_attendance_id;
  elsif p_action = 'note_update' then
    if current_attendance.voided_at is not null then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_VOIDED';
    end if;
    update public.attendance
      set teacher_note = nullif(p_value, '')
      where id = p_attendance_id;
    audit_reason := case when p_value is null or p_value = '' then 'Nota eliminada' else 'Nota actualizada' end;
  elsif p_action = 'void' then
    if current_attendance.voided_at is not null then
      raise exception using errcode = 'P0001', message = 'ATTENDANCE_VOIDED';
    end if;
    if p_value is null or char_length(btrim(p_value)) = 0 then
      raise exception using errcode = '22023', message = 'VOID_REASON_REQUIRED';
    end if;
    update public.attendance
      set voided_at = now(),
          voided_by = p_actor_user_id,
          void_reason = btrim(p_value)
      where id = p_attendance_id;
    audit_reason := btrim(p_value);
  else
    raise exception using errcode = '22023', message = 'INVALID_MODERATION_ACTION';
  end if;

  insert into public.attendance_audit_log (
    attendance_id, session_id, actor_user_id, action, reason
  ) values (
    p_attendance_id, p_session_id, p_actor_user_id,
    case when p_action = 'note_update' then 'note_update' else p_action end,
    audit_reason
  );

  return p_attendance_id;
end;
$$;

revoke all on function public.moderate_attendance(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;

grant execute on function public.moderate_attendance(uuid, uuid, text, text, uuid)
  to service_role;

create function public.reset_student_trusted_device(
  p_subject_user_id uuid,
  p_actor_user_id uuid
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed boolean;
begin
  if p_subject_user_id is null then
    raise exception using errcode = '22004', message = 'SUBJECT_USER_ID_REQUIRED';
  end if;

  delete from public.student_trusted_devices
  where user_id = p_subject_user_id;
  removed := found;

  insert into public.attendance_audit_log (
    subject_user_id, actor_user_id, action, reason
  ) values (
    p_subject_user_id, p_actor_user_id, 'device_reset',
    'Restablecimiento autorizado por docente'
  );

  return removed;
end;
$$;

revoke all on function public.reset_student_trusted_device(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.reset_student_trusted_device(uuid, uuid)
  to service_role;

commit;
