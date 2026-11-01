begin;

create table public.attendance_overrides (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  session_id uuid not null references public.sessions(id) on delete restrict,
  enrollment_id uuid not null references public.class_enrollments(id) on delete restrict,
  status text not null,
  reason text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_overrides_status_allowed check (
    status in ('present', 'absent', 'suspicious')
  ),
  constraint attendance_overrides_reason_length check (
    char_length(btrim(reason)) between 1 and 500
  ),
  constraint attendance_overrides_session_enrollment_key unique (
    session_id, enrollment_id
  )
);

create index attendance_overrides_class_session_idx
  on public.attendance_overrides (class_id, session_id);

create index attendance_overrides_enrollment_idx
  on public.attendance_overrides (enrollment_id);

create trigger attendance_overrides_set_updated_at
before update on public.attendance_overrides
for each row execute function public.set_institutional_updated_at();

alter table public.attendance_overrides enable row level security;

revoke all on table public.attendance_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.attendance_overrides to service_role;

create table public.attendance_override_audit (
  id uuid primary key default gen_random_uuid(),
  override_id uuid references public.attendance_overrides(id) on delete set null,
  class_id uuid not null references public.classes(id) on delete restrict,
  session_id uuid not null references public.sessions(id) on delete restrict,
  enrollment_id uuid not null references public.class_enrollments(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  previous_status text,
  new_status text,
  reason text not null,
  action text not null,
  created_at timestamptz not null default now(),
  constraint attendance_override_audit_previous_status_allowed check (
    previous_status is null or previous_status in ('present', 'absent', 'suspicious')
  ),
  constraint attendance_override_audit_new_status_allowed check (
    new_status is null or new_status in ('present', 'absent', 'suspicious')
  ),
  constraint attendance_override_audit_reason_length check (
    char_length(btrim(reason)) between 1 and 500
  ),
  constraint attendance_override_audit_action_allowed check (
    action in ('set_override', 'change_override', 'clear_override')
  ),
  constraint attendance_override_audit_transition check (
    (action = 'set_override' and previous_status is null and new_status is not null)
    or (action = 'change_override' and previous_status is not null and new_status is not null)
    or (action = 'clear_override' and previous_status is not null and new_status is null)
  )
);

create index attendance_override_audit_cell_created_idx
  on public.attendance_override_audit (session_id, enrollment_id, created_at desc);

create index attendance_override_audit_class_created_idx
  on public.attendance_override_audit (class_id, created_at desc);

create index attendance_override_audit_override_idx
  on public.attendance_override_audit (override_id)
  where override_id is not null;

alter table public.attendance_override_audit enable row level security;

revoke all on table public.attendance_override_audit from public, anon, authenticated;
grant select, insert on table public.attendance_override_audit to service_role;

-- Defense in depth for any server-side direct write: the session and enrollment
-- must belong to the same class, the session must be a closed academic column,
-- and the session must fall inside one historical enrollment period.
create function public.assert_attendance_override_consistency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_session public.sessions%rowtype;
begin
  select * into target_session
  from public.sessions
  where id = new.session_id;

  if not found or target_session.class_id <> new.class_id then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_RELATION';
  end if;

  if not exists (
    select 1
    from public.class_enrollments
    where id = new.enrollment_id
      and class_id = new.class_id
  ) then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_RELATION';
  end if;

  if target_session.status <> 'closed'
    or target_session.counts_toward_attendance is not true then
    raise exception using errcode = '22023', message = 'SESSION_NOT_COMPUTABLE';
  end if;

  if not exists (
    select 1
    from public.class_enrollment_periods
    where enrollment_id = new.enrollment_id
      and target_session.opened_at >= started_at
      and (ended_at is null or target_session.opened_at < ended_at)
  ) then
    raise exception using
      errcode = '22023',
      message = 'SESSION_NOT_ELIGIBLE_FOR_STUDENT';
  end if;

  return new;
end;
$$;

create trigger attendance_overrides_consistency_check
before insert or update on public.attendance_overrides
for each row execute function public.assert_attendance_override_consistency();

revoke all on function public.assert_attendance_override_consistency()
  from public, anon, authenticated;
grant execute on function public.assert_attendance_override_consistency()
  to service_role;

create function public.set_attendance_override(
  p_class_id uuid,
  p_session_id uuid,
  p_enrollment_id uuid,
  p_status text,
  p_reason text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_session public.sessions%rowtype;
  target_enrollment public.class_enrollments%rowtype;
  current_override public.attendance_overrides%rowtype;
  saved_override_id uuid;
  audit_action text;
  normalized_reason text := btrim(p_reason);
begin
  if p_status is null or p_status not in ('present', 'absent', 'suspicious') then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_STATUS';
  end if;

  if p_reason is null or char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_REASON';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id
      and teacher_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  select * into target_session
  from public.sessions
  where id = p_session_id
  for update;

  select * into target_enrollment
  from public.class_enrollments
  where id = p_enrollment_id
  for update;

  if target_session.id is null
    or target_enrollment.id is null
    or target_session.class_id <> p_class_id
    or target_enrollment.class_id <> p_class_id then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_RELATION';
  end if;

  if target_session.status <> 'closed'
    or target_session.counts_toward_attendance is not true then
    raise exception using errcode = '22023', message = 'SESSION_NOT_COMPUTABLE';
  end if;

  if not exists (
    select 1
    from public.class_enrollment_periods
    where enrollment_id = p_enrollment_id
      and target_session.opened_at >= started_at
      and (ended_at is null or target_session.opened_at < ended_at)
  ) then
    raise exception using
      errcode = '22023',
      message = 'SESSION_NOT_ELIGIBLE_FOR_STUDENT';
  end if;

  select * into current_override
  from public.attendance_overrides
  where session_id = p_session_id
    and enrollment_id = p_enrollment_id
  for update;

  if current_override.id is null then
    insert into public.attendance_overrides (
      class_id,
      session_id,
      enrollment_id,
      status,
      reason,
      created_by
    ) values (
      p_class_id,
      p_session_id,
      p_enrollment_id,
      p_status,
      normalized_reason,
      p_actor_user_id
    )
    returning id into saved_override_id;
    audit_action := 'set_override';
  else
    update public.attendance_overrides
    set status = p_status,
        reason = normalized_reason
    where id = current_override.id
    returning id into saved_override_id;
    audit_action := 'change_override';
  end if;

  insert into public.attendance_override_audit (
    override_id,
    class_id,
    session_id,
    enrollment_id,
    actor_user_id,
    previous_status,
    new_status,
    reason,
    action
  ) values (
    saved_override_id,
    p_class_id,
    p_session_id,
    p_enrollment_id,
    p_actor_user_id,
    current_override.status,
    p_status,
    normalized_reason,
    audit_action
  );

  return saved_override_id;
end;
$$;

revoke all on function public.set_attendance_override(uuid, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_attendance_override(uuid, uuid, uuid, text, text, uuid)
  to service_role;

create function public.clear_attendance_override(
  p_class_id uuid,
  p_session_id uuid,
  p_enrollment_id uuid,
  p_reason text,
  p_actor_user_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_override public.attendance_overrides%rowtype;
  normalized_reason text := btrim(p_reason);
begin
  if p_reason is null or char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_REASON';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = p_class_id
      and teacher_id = p_actor_user_id
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.sessions
    where id = p_session_id
      and class_id = p_class_id
  ) or not exists (
    select 1
    from public.class_enrollments
    where id = p_enrollment_id
      and class_id = p_class_id
  ) then
    raise exception using errcode = '22023', message = 'INVALID_OVERRIDE_RELATION';
  end if;

  select * into current_override
  from public.attendance_overrides
  where class_id = p_class_id
    and session_id = p_session_id
    and enrollment_id = p_enrollment_id
  for update;

  if current_override.id is null then
    raise exception using errcode = 'P0001', message = 'OVERRIDE_NOT_FOUND';
  end if;

  insert into public.attendance_override_audit (
    override_id,
    class_id,
    session_id,
    enrollment_id,
    actor_user_id,
    previous_status,
    new_status,
    reason,
    action
  ) values (
    current_override.id,
    p_class_id,
    p_session_id,
    p_enrollment_id,
    p_actor_user_id,
    current_override.status,
    null,
    normalized_reason,
    'clear_override'
  );

  delete from public.attendance_overrides
  where id = current_override.id;

  return current_override.id;
end;
$$;

revoke all on function public.clear_attendance_override(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.clear_attendance_override(uuid, uuid, uuid, text, uuid)
  to service_role;

commit;
