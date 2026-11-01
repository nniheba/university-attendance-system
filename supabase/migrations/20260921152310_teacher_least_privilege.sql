begin;

revoke all on public.classes from authenticated;
revoke all on public.sessions from authenticated;
revoke all on public.attendance from authenticated;

grant select on public.classes to authenticated;
grant select on public.sessions to authenticated;
grant select on public.attendance to authenticated;

commit;
