alter table public.pikos
  add column if not exists source_id text,
  add column if not exists platform_category text,
  add column if not exists igdb_id bigint,
  add column if not exists artwork_url text,
  add column if not exists screenshots text[] not null default '{}',
  add column if not exists trailer_id text,
  add column if not exists first_release_date bigint;
