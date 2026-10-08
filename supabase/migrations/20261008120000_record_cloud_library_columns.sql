-- The app already reads and writes these columns, but no migration created them,
-- so a project built only from this repository would fail to sync. Every statement
-- is idempotent, so it is safe to run against a database that already has them.
alter table public.pikos
  add column if not exists executable_path text,
  add column if not exists source text not null default 'built-in',
  add column if not exists categories text[] not null default '{}';

alter table public.profiles
  add column if not exists metadata_sync_allowed boolean not null default false;
