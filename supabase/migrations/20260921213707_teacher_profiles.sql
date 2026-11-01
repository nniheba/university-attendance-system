begin;

create table public.teacher_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_key text not null default 'avatar_01',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_profiles_display_name_length
    check (char_length(btrim(display_name)) between 2 and 80),
  constraint teacher_profiles_avatar_key_allowed
    check (avatar_key in (
      'avatar_01',
      'avatar_02',
      'avatar_03',
      'avatar_04',
      'avatar_05',
      'avatar_06'
    ))
);

alter table public.teacher_profiles enable row level security;

revoke all on table public.teacher_profiles from anon, authenticated;
grant select, insert, update on table public.teacher_profiles to authenticated;
grant select, insert, update on table public.teacher_profiles to service_role;

create policy "teachers read their own profile"
on public.teacher_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "teachers create their own profile"
on public.teacher_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "teachers update their own profile"
on public.teacher_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

commit;
