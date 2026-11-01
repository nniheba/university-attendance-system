begin;

alter table public.institutional_accounts
  drop constraint institutional_accounts_email_normalized;

alter table public.institutional_accounts
  add constraint institutional_accounts_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?@(faculty[.]example[.]edu|students[.]example[.]edu)$'
    and email !~ '[.][.]'
  );

alter table public.teacher_allowlist
  drop constraint teacher_allowlist_email_normalized;

alter table public.teacher_allowlist
  add constraint teacher_allowlist_email_normalized check (
    email = lower(btrim(email))
    and email ~ '^[a-z0-9]([a-z0-9._+-]*[a-z0-9])?@faculty[.]example[.]edu$'
    and email !~ '[.][.]'
  );

commit;
