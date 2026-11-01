begin;

create table public.session_audit_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  previous_session_name text,
  new_session_name text not null,
  previous_opened_at timestamptz not null,
  new_opened_at timestamptz not null,
  previous_color_key text not null,
  new_color_key text not null,
  created_at timestamptz not null default now(),
  constraint session_audit_action_allowed check (action = 'update_details'),
  constraint session_audit_new_name_valid check (
    char_length(btrim(new_session_name)) between 1 and 120
  ),
  constraint session_audit_colors_allowed check (
    previous_color_key in ('blue', 'navy', 'cyan', 'green', 'amber', 'red', 'purple', 'slate')
    and new_color_key in ('blue', 'navy', 'cyan', 'green', 'amber', 'red', 'purple', 'slate')
  )
);

create index session_audit_log_session_created_idx
  on public.session_audit_log (session_id, created_at desc);

alter table public.session_audit_log enable row level security;

revoke all on table public.session_audit_log from public, anon, authenticated, service_role;
grant select, insert on table public.session_audit_log to service_role;

create or replace function public.update_session_details(
  p_session_id uuid,
  p_session_name text,
  p_opened_at timestamptz,
  p_color_key text,
  p_actor_user_id uuid
)
returns table (
  session_id uuid,
  class_id uuid,
  session_name text,
  opened_at timestamptz,
  color_key text,
  status text,
  closed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.sessions%rowtype;
  cleaned_name text;
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

  update public.sessions as s
    set session_name = cleaned_name,
        opened_at = p_opened_at,
        color_key = p_color_key
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
    select s.id, s.class_id, s.session_name, s.opened_at, s.color_key, s.status, s.closed_at
      from public.sessions as s
      where s.id = target.id;
end;
$$;

revoke all on function public.update_session_details(uuid, text, timestamptz, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_session_details(uuid, text, timestamptz, text, uuid)
  to service_role;

commit;
