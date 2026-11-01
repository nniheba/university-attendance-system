begin;

alter table public.sessions
  add column enable_projection_bubbles boolean not null default true;

-- Keep the previous RPC available for older application builds. The v0.6.5
-- endpoint uses this extended function so metadata and the projection setting
-- are persisted under the same row lock and transaction.
create function public.update_session_details_with_projection(
  p_session_id uuid,
  p_session_name text,
  p_opened_at timestamptz,
  p_color_key text,
  p_enable_projection_bubbles boolean,
  p_actor_user_id uuid
)
returns table (
  session_id uuid,
  class_id uuid,
  session_name text,
  opened_at timestamptz,
  color_key text,
  status text,
  closed_at timestamptz,
  enable_projection_bubbles boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.sessions%rowtype;
  cleaned_name text;
  next_projection_bubbles boolean;
begin
  cleaned_name := btrim(p_session_name);
  if p_actor_user_id is null then
    raise exception 'FORBIDDEN';
  end if;
  if cleaned_name is null or char_length(cleaned_name) not between 1 and 120 then
    raise exception 'INVALID_SESSION_NAME';
  end if;
  if p_color_key is null or p_color_key not in ('blue', 'navy', 'cyan', 'green', 'amber', 'red', 'purple', 'slate') then
    raise exception 'INVALID_SESSION_COLOR';
  end if;
  if p_opened_at is null or p_opened_at::text in ('infinity', '-infinity') then
    raise exception 'INVALID_SESSION_TIMESTAMP';
  end if;

  select s.*
    into target
    from public.sessions as s
    where s.id = p_session_id
    for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if not exists (
    select 1
      from public.classes as c
      where c.id = target.class_id
        and c.teacher_id = p_actor_user_id
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if (
    target.status = 'closed'
    and (target.closed_at is null or p_opened_at >= target.closed_at)
  ) or (
    target.status = 'open'
    and p_opened_at > now()
  ) then
    raise exception 'INVALID_SESSION_TIME_RANGE';
  end if;

  next_projection_bubbles := coalesce(
    p_enable_projection_bubbles,
    target.enable_projection_bubbles
  );

  update public.sessions as s
    set session_name = cleaned_name,
        opened_at = p_opened_at,
        color_key = p_color_key,
        enable_projection_bubbles = next_projection_bubbles
    where s.id = target.id;

  insert into public.session_audit_log (
    session_id,
    actor_user_id,
    action,
    previous_session_name,
    new_session_name,
    previous_opened_at,
    new_opened_at,
    previous_color_key,
    new_color_key
  ) values (
    target.id,
    p_actor_user_id,
    'update_details',
    target.session_name,
    cleaned_name,
    target.opened_at,
    p_opened_at,
    target.color_key,
    p_color_key
  );

  return query
    select
      s.id,
      s.class_id,
      s.session_name,
      s.opened_at,
      s.color_key,
      s.status,
      s.closed_at,
      s.enable_projection_bubbles
    from public.sessions as s
    where s.id = target.id;
end;
$$;

revoke all on function public.update_session_details_with_projection(
  uuid, text, timestamptz, text, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.update_session_details_with_projection(
  uuid, text, timestamptz, text, boolean, uuid
) to service_role;

commit;
