begin;

alter table public.classes
  add column color_key text not null default 'blue',
  add constraint classes_color_key_allowed check (
    color_key in ('blue', 'navy', 'cyan', 'green', 'amber', 'red', 'purple', 'slate')
  );

alter table public.sessions
  add column session_name text,
  add column color_key text not null default 'blue',
  add constraint sessions_name_length check (
    session_name is null or char_length(btrim(session_name)) between 1 and 120
  ),
  add constraint sessions_color_key_allowed check (
    color_key in ('blue', 'navy', 'cyan', 'green', 'amber', 'red', 'purple', 'slate')
  );

commit;
