begin;

-- Attendance percentages use the current class roster against every closed,
-- computable class session. Enrollment periods remain an auditable lifecycle
-- record, but no longer turn ordinary historical cells into N/A.
create or replace function public.assert_attendance_override_consistency()
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

  return new;
end;
$$;

revoke all on function public.assert_attendance_override_consistency()
  from public, anon, authenticated;
grant execute on function public.assert_attendance_override_consistency()
  to service_role;

create or replace function public.set_attendance_override(
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

commit;
