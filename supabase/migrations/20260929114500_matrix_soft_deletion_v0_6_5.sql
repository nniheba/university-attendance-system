begin;

alter table public.sessions
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add column delete_reason text,
  add constraint sessions_soft_delete_fields check (
    (
      deleted_at is null
      and deleted_by is null
      and delete_reason is null
    )
    or (
      deleted_at is not null
      and status = 'closed'
      and delete_reason is not null
      and delete_reason = btrim(delete_reason)
      and char_length(delete_reason) between 1 and 500
    )
  );

-- Teachers keep the direct read access required by the existing RLS model,
-- but the deletion audit fields remain available only to trusted server code.
revoke select on table public.sessions from authenticated;
grant select (
  id,
  class_id,
  opened_at,
  closed_at,
  status,
  latitude,
  longitude,
  allowed_radius_m,
  created_at,
  location_city,
  location_region,
  location_country,
  location_country_code,
  counts_toward_attendance,
  allow_self_enrollment,
  session_name,
  color_key,
  enable_projection_bubbles
) on public.sessions to authenticated;

grant select (deleted_at, deleted_by, delete_reason),
  update (deleted_at, deleted_by, delete_reason)
on public.sessions to service_role;

create index sessions_visible_class_opened_idx
  on public.sessions (class_id, opened_at)
  where deleted_at is null;

create function public.protect_removed_attendance_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    -- Preserve ON DELETE SET NULL for a deleted actor while making every
    -- academic field of a removed session immutable.
    if old.deleted_by is not null
      and new.deleted_by is null
      and (to_jsonb(new) - 'deleted_by') = (to_jsonb(old) - 'deleted_by') then
      return new;
    end if;
    raise exception using errcode = 'P0001', message = 'SESSION_REMOVED';
  end if;
  return new;
end;
$$;

create trigger sessions_protect_removed_row
before update on public.sessions
for each row execute function public.protect_removed_attendance_session();

revoke all on function public.protect_removed_attendance_session()
  from public, anon, authenticated;

create function public.remove_attendance_session(
  p_session_id uuid,
  p_reason text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.sessions%rowtype;
  normalized_reason text := btrim(p_reason);
begin
  if p_reason is null or char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_DELETE_REASON';
  end if;

  select * into target
  from public.sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = target.class_id
      and teacher_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if target.deleted_at is not null then
    raise exception using errcode = 'P0001', message = 'SESSION_ALREADY_REMOVED';
  end if;

  if target.status <> 'closed' then
    raise exception using errcode = 'P0001', message = 'SESSION_STILL_OPEN';
  end if;

  if target.counts_toward_attendance is not true then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPUTABLE';
  end if;

  update public.sessions
  set deleted_at = clock_timestamp(),
      deleted_by = p_actor_user_id,
      delete_reason = normalized_reason
  where id = target.id;

  return target.id;
end;
$$;

revoke all on function public.remove_attendance_session(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_attendance_session(uuid, text, uuid)
  to service_role;

commit;
