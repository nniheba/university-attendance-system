begin;

-- v0.5.1 registers attendance from a short-lived signed QR and no longer
-- requires a geofence. Historical session coordinates remain untouched.
alter table public.sessions
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column allowed_radius_m drop not null;

-- Every trusted attendance must still originate from a verified QR. Location
-- verification remains available for historical rows but is optional now.
alter table public.attendance
  drop constraint verified_attendance_only,
  add constraint verified_attendance_only check (qr_verified);

drop function public.register_attendance_if_open(
  uuid, uuid, double precision, double precision, text, text, text, text, text, text
);

create function public.register_attendance_if_open(
  p_session_id uuid,
  p_student_user_id uuid,
  p_device_hash text,
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

  if exists (
    select 1 from public.attendance
    where session_id = p_session_id and student_user_id = p_student_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
  end if;

  if exists (
    select 1 from public.attendance
    where session_id = p_session_id and device_hash = p_device_hash
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
      network_location_status
    ) values (
      p_session_id,
      p_student_user_id,
      authoritative_name,
      authoritative_normalized_name,
      true,
      false,
      null,
      null,
      p_device_hash,
      p_network_city,
      p_network_region,
      p_network_country,
      p_network_country_code,
      network_status
    ) returning id into inserted_id;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
    if violated_constraint = 'attendance_session_student_user_key' then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
    elsif violated_constraint = 'attendance_session_device_hash_key' then
      raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
    else
      raise;
    end if;
  end;

  return inserted_id;
end;
$$;

revoke all on function public.register_attendance_if_open(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.register_attendance_if_open(
  uuid, uuid, text, text, text, text, text
) to service_role;

commit;
