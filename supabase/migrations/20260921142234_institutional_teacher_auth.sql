begin;

-- Existing Alpha rows remain readable by the server but are intentionally
-- ownerless until an administrator assigns them. Every new class must have an
-- authenticated owner supplied by the backend.
alter table public.classes
  add column teacher_id uuid references auth.users(id) on delete set null;

create index classes_teacher_created_at_idx
  on public.classes (teacher_id, created_at desc);

create function public.require_class_teacher_id() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.teacher_id is null then
    raise exception using errcode = '23502', message = 'TEACHER_ID_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function public.require_class_teacher_id() from public, anon, authenticated;

create trigger classes_teacher_required
before insert on public.classes
for each row execute function public.require_class_teacher_id();

drop policy if exists "public can read attendance for realtime" on public.attendance;

revoke all on public.classes from anon;
revoke all on public.sessions from anon;
revoke all on public.attendance from anon;

grant select on public.classes to authenticated;
grant select on public.sessions to authenticated;
grant select on public.attendance to authenticated;

create policy "teachers read their own classes"
  on public.classes for select to authenticated
  using ((select auth.uid()) = teacher_id);

create policy "teachers read sessions for their classes"
  on public.sessions for select to authenticated
  using (
    exists (
      select 1
      from public.classes
      where classes.id = sessions.class_id
        and classes.teacher_id = (select auth.uid())
    )
  );

create policy "teachers read attendance for their sessions"
  on public.attendance for select to authenticated
  using (
    exists (
      select 1
      from public.sessions
      join public.classes on classes.id = sessions.class_id
      where sessions.id = attendance.session_id
        and classes.teacher_id = (select auth.uid())
    )
  );

commit;
