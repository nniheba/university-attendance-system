begin;

alter table public.sessions
  add column location_city text check (char_length(location_city) <= 120),
  add column location_region text check (char_length(location_region) <= 120),
  add column location_country text check (char_length(location_country) <= 120),
  add column location_country_code text check (location_country_code ~ '^[A-Z]{2}$');

-- Nullable device_hash preserves Alpha v0.1 history without inventing identities.
alter table public.attendance
  add column device_hash text check (device_hash ~ '^[a-f0-9]{64}$'),
  add column network_city text check (char_length(network_city) <= 120),
  add column network_region text check (char_length(network_region) <= 120),
  add column network_country text check (char_length(network_country) <= 120),
  add column network_country_code text check (network_country_code ~ '^[A-Z]{2}$'),
  add column network_location_status text not null default 'unknown'
    check (network_location_status in ('consistent', 'mismatch', 'unknown'));

create unique index attendance_session_device_hash_key
  on public.attendance (session_id, device_hash) where device_hash is not null;

create function public.require_attendance_device_hash() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.device_hash is null then
    raise exception using errcode = '23502', message = 'DEVICE_HASH_REQUIRED';
  end if;
  return new;
end;
$$;
revoke all on function public.require_attendance_device_hash() from public, anon, authenticated;
create trigger attendance_device_hash_required before insert on public.attendance
  for each row execute function public.require_attendance_device_hash();

-- Remove the old overload: it must not remain as a device-check bypass.
drop function public.register_attendance_if_open(uuid, text, text, double precision, double precision);

create function public.register_attendance_if_open(
  p_session_id uuid,
  p_full_name text,
  p_normalized_name text,
  p_location_accuracy double precision,
  p_distance_from_center_m double precision,
  p_device_hash text,
  p_network_city text,
  p_network_region text,
  p_network_country text,
  p_network_country_code text,
  p_network_location_status text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  current_session public.sessions%rowtype;
  inserted_id uuid;
  violated_constraint text;
  network_status text;
begin
  select * into current_session from public.sessions where id = p_session_id for update;
  if not found or current_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'SESSION_CLOSED';
  end if;
  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '23502', message = 'DEVICE_HASH_REQUIRED';
  end if;
  -- Defence in depth; coordinates themselves never enter this RPC/database.
  if p_location_accuracy is null or p_distance_from_center_m is null
    or not (p_location_accuracy between 0 and least(50, current_session.allowed_radius_m / 2.0))
    or not (p_distance_from_center_m >= 0 and
      p_distance_from_center_m + p_location_accuracy <= current_session.allowed_radius_m) then
    raise exception using errcode = 'P0001', message = 'INVALID_LOCATION';
  end if;
  if exists (select 1 from public.attendance where session_id = p_session_id and device_hash = p_device_hash) then
    raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
  end if;
  if exists (select 1 from public.attendance where session_id = p_session_id and normalized_name = p_normalized_name) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
  end if;
  network_status := case
    when current_session.location_country_code is null or p_network_country_code is null then 'unknown'
    when current_session.location_country_code = p_network_country_code then 'consistent'
    else 'mismatch' end;
  if p_network_location_status is distinct from network_status then
    raise exception using errcode = 'P0001', message = 'INVALID_NETWORK_STATUS';
  end if;
  begin
    insert into public.attendance (
      session_id, full_name, normalized_name, qr_verified, location_verified,
      location_accuracy, distance_from_center_m, device_hash,
      network_city, network_region, network_country, network_country_code, network_location_status
    ) values (
      p_session_id, p_full_name, p_normalized_name, true, true,
      p_location_accuracy, p_distance_from_center_m, p_device_hash,
      p_network_city, p_network_region, p_network_country, p_network_country_code, network_status
    ) returning id into inserted_id;
  exception when unique_violation then
    get stacked diagnostics violated_constraint = CONSTRAINT_NAME;
    if violated_constraint = 'attendance_session_device_hash_key' then
      raise exception using errcode = 'P0001', message = 'DEVICE_ALREADY_USED';
    elsif violated_constraint = 'attendance_session_normalized_name_key' then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_ATTENDANCE';
    else
      raise;
    end if;
  end;
  return inserted_id;
end;
$$;

revoke all on function public.register_attendance_if_open(
  uuid, text, text, double precision, double precision, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.register_attendance_if_open(
  uuid, text, text, double precision, double precision, text, text, text, text, text, text
) to service_role;

commit;
