begin;

revoke all
on table public.attendance_override_audit
from service_role;

grant select, insert
on table public.attendance_override_audit
to service_role;

commit;
