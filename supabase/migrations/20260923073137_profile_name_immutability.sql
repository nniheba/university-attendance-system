begin;

-- Student names are derived during the trusted institutional bootstrap. The
-- browser can still read its own profile through the existing SELECT policy,
-- but it can no longer update display_name directly.
revoke update (display_name) on table public.student_profiles from authenticated;

drop policy if exists "students update their own profile"
on public.student_profiles;

-- Teacher profiles are also created by the trusted bootstrap. Keep the avatar
-- editable while preventing authenticated clients from inserting a chosen
-- display_name or updating any column other than avatar_key.
revoke insert, update on table public.teacher_profiles from authenticated;
grant update (avatar_key) on table public.teacher_profiles to authenticated;

drop policy if exists "teachers create their own profile"
on public.teacher_profiles;

commit;
