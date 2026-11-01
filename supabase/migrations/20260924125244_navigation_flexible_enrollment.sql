begin;

alter table public.classes
  add column enrollment_mode text not null default 'closed',
  add constraint classes_enrollment_mode_allowed
    check (enrollment_mode in ('closed', 'self_enroll'));

alter table public.sessions
  add column allow_self_enrollment boolean not null default false;

-- This service-only workflow is the sole student self-enrollment entry point.
-- It derives the initial period start from the locked attendance session, so a
-- browser can never choose an arbitrary academic eligibility timestamp.
create function public.self_enroll_student_for_session(
  p_session_id uuid,
  p_student_user_id uuid,
  p_student_email text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_session public.sessions%rowtype;
  current_enrollment public.class_enrollments%rowtype;
  inserted_id uuid;
begin
  if p_session_id is null or p_student_user_id is null or p_student_email is null
    or p_student_email <> lower(btrim(p_student_email))
    or p_student_email !~ '^[a-z0-9]([a-z0-9._+\-]*[a-z0-9])?@students[.]example[.]edu$'
    or p_student_email ~ '[.][.]' then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  select * into current_session
  from public.sessions
  where id = p_session_id
  for update;

  if not found or current_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'SESSION_CLOSED';
  end if;

  if not current_session.allow_self_enrollment then
    raise exception using errcode = 'P0001', message = 'SELF_ENROLLMENT_DISABLED';
  end if;

  if not exists (
    select 1
    from public.classes
    where id = current_session.class_id
      and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'CLASS_ARCHIVED';
  end if;

  if not exists (
    select 1
    from public.institutional_accounts
    where user_id = p_student_user_id
      and email = p_student_email
      and role = 'student'
  ) then
    raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
  end if;

  -- Resolve a linked enrollment first so an account cannot claim a different
  -- email row in the same class.
  select * into current_enrollment
  from public.class_enrollments
  where class_id = current_session.class_id
    and student_user_id = p_student_user_id
  for update;

  if found then
    if current_enrollment.student_email <> p_student_email then
      raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
    end if;
    if current_enrollment.status = 'inactive' then
      raise exception using errcode = 'P0001', message = 'ENROLLMENT_INACTIVE';
    end if;
    return false;
  end if;

  select * into current_enrollment
  from public.class_enrollments
  where class_id = current_session.class_id
    and student_email = p_student_email
  for update;

  if found then
    if current_enrollment.status = 'inactive' then
      raise exception using errcode = 'P0001', message = 'ENROLLMENT_INACTIVE';
    end if;
    if current_enrollment.student_user_id is not null
      and current_enrollment.student_user_id <> p_student_user_id then
      raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
    end if;
    if current_enrollment.student_user_id is null then
      update public.class_enrollments
      set student_user_id = p_student_user_id
      where id = current_enrollment.id;
    end if;
    return false;
  end if;

  begin
    insert into public.class_enrollments (
      class_id,
      student_email,
      student_user_id,
      enrolled_at,
      created_by
    ) values (
      current_session.class_id,
      p_student_email,
      p_student_user_id,
      current_session.opened_at,
      null
    )
    returning id into inserted_id;
  exception when unique_violation then
    -- Defensive convergence for concurrent callers. The session lock normally
    -- serializes this path, while both unique enrollment keys remain the final
    -- database-level protection.
    select * into current_enrollment
    from public.class_enrollments
    where class_id = current_session.class_id
      and (
        student_email = p_student_email
        or student_user_id = p_student_user_id
      )
    order by (student_email = p_student_email and student_user_id = p_student_user_id) desc
    limit 1
    for update;

    if not found
      or current_enrollment.student_email <> p_student_email
      or current_enrollment.student_user_id is distinct from p_student_user_id then
      raise exception using errcode = '22023', message = 'INVALID_STUDENT_IDENTITY';
    end if;
    if current_enrollment.status = 'inactive' then
      raise exception using errcode = 'P0001', message = 'ENROLLMENT_INACTIVE';
    end if;
    return false;
  end;

  return inserted_id is not null;
end;
$$;

revoke all on function public.self_enroll_student_for_session(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.self_enroll_student_for_session(uuid, uuid, text)
  to service_role;

commit;
