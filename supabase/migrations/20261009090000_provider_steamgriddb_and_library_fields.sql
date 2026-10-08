-- SteamGridDB credentials and per-game library fields (favourite, tags, artwork
-- source, kind). Every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Allow the 'steamgriddb' provider. The original check was declared inline
--    (auto-named), so find it by definition instead of by name.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'mochi_private.user_credentials'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
  loop
    execute format('alter table mochi_private.user_credentials drop constraint %I', c.conname);
  end loop;

  alter table mochi_private.user_credentials
    add constraint user_credentials_provider_check check (provider in ('igdb', 'nexus', 'steamgriddb'));
end $$;

-- ---------------------------------------------------------------------------
-- 2. New Piko columns
-- ---------------------------------------------------------------------------
alter table public.pikos
  add column if not exists favorite boolean not null default false,
  add column if not exists tags text[] not null default '{}',
  add column if not exists artwork_source text,
  add column if not exists kind text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pikos_kind_check' and conrelid = 'public.pikos'::regclass) then
    alter table public.pikos add constraint pikos_kind_check check (kind is null or kind in ('game', 'launcher'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pikos_artwork_source_check' and conrelid = 'public.pikos'::regclass) then
    alter table public.pikos add constraint pikos_artwork_source_check
      check (artwork_source is null or artwork_source in ('igdb', 'steamgriddb', 'steam', 'custom'));
  end if;

  -- Widen the size limits (tags <= 60 entries) by replacing the constraint.
  alter table public.pikos drop constraint if exists pikos_size_limits;
  alter table public.pikos add constraint pikos_size_limits check (
    char_length(name) between 1 and 300
    and char_length(description) <= 20000
    and coalesce(char_length(artwork), 0) <= 8192
    and coalesce(char_length(executable_path), 0) <= 4096
    and coalesce(cardinality(screenshots), 0) <= 30
    and coalesce(cardinality(categories), 0) <= 60
    and coalesce(cardinality(tags), 0) <= 60);
end $$;

-- ---------------------------------------------------------------------------
-- 3. sync_my_library with the new columns. Same security properties as
--    20261008130000_harden_and_reconcile.sql: invoker rights, empty search_path,
--    authenticated callers only, and the cloud-sync opt-in check.
-- ---------------------------------------------------------------------------
create or replace function public.sync_my_library(library jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  pikos_count bigint;
  tofus_count bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(library) is distinct from 'array' then raise exception 'Library must be a JSON array'; end if;
  if jsonb_array_length(library) > 5000 then raise exception 'Library is too large to sync'; end if;
  if not exists (
    select 1 from public.profiles where id = uid and cloud_sync_enabled and metadata_sync_allowed
  ) then
    raise exception 'Cloud sync is not enabled for this account' using errcode = '42501';
  end if;

  with incoming as (
    select distinct on (x.local_id) x.*
    from jsonb_to_recordset(library) as x(
      local_id text, name text, description text, accent text, artwork text, artwork_url text,
      executable_path text, source text, source_id text, platform_category text, igdb_id bigint,
      categories text[], screenshots text[], trailer_id text, first_release_date bigint,
      favorite boolean, tags text[], artwork_source text, kind text, tofus jsonb)
    where x.local_id is not null and x.name is not null
  ),
  removed as (
    delete from public.pikos
    where user_id = uid and local_id not in (select local_id from incoming)
    returning 1
  ),
  upserted as (
    insert into public.pikos (
      user_id, local_id, name, description, accent, artwork, artwork_url, executable_path, source,
      source_id, platform_category, igdb_id, categories, screenshots, trailer_id, first_release_date,
      favorite, tags, artwork_source, kind)
    select uid, local_id, name, coalesce(description, ''), coalesce(accent, '#80b7a4'), artwork, artwork_url,
      executable_path, case when source = 'custom' then 'custom' else 'built-in' end,
      source_id, platform_category, igdb_id, coalesce(categories, '{}'), coalesce(screenshots, '{}'),
      trailer_id, first_release_date,
      coalesce(favorite, false), coalesce(tags, '{}'),
      case when artwork_source in ('igdb', 'steamgriddb', 'steam', 'custom') then artwork_source else null end,
      case when kind in ('game', 'launcher') then kind else null end
    from incoming
    on conflict (user_id, local_id) do update set
      name = excluded.name, description = excluded.description, accent = excluded.accent,
      artwork = excluded.artwork, artwork_url = excluded.artwork_url,
      executable_path = excluded.executable_path, source = excluded.source,
      source_id = excluded.source_id, platform_category = excluded.platform_category,
      igdb_id = excluded.igdb_id, categories = excluded.categories, screenshots = excluded.screenshots,
      trailer_id = excluded.trailer_id, first_release_date = excluded.first_release_date,
      favorite = excluded.favorite, tags = excluded.tags,
      artwork_source = excluded.artwork_source, kind = excluded.kind,
      updated_at = now()
    returning id, local_id
  ),
  tofu_in as (
    select distinct on (u.id, t.local_id)
      u.id as piko_id, t.local_id, t.name, coalesce(t.version, 'Local') as version,
      coalesce(t.runtime, 'Native') as runtime, greatest(coalesce(t.mods_count, 0), 0) as mods_count,
      case when t.status = 'Needs attention' then 'Needs attention' else 'Ready' end as status
    from incoming i
    join upserted u on u.local_id = i.local_id
    cross join lateral jsonb_to_recordset(coalesce(i.tofus, '[]'::jsonb))
      as t(local_id text, name text, version text, runtime text, mods_count integer, status text)
    where t.local_id is not null and t.name is not null
  ),
  tofus_removed as (
    delete from public.tofus tf
    using upserted u
    where tf.piko_id = u.id
      and not exists (select 1 from tofu_in ti where ti.piko_id = tf.piko_id and ti.local_id = tf.local_id)
    returning 1
  ),
  tofus_upserted as (
    insert into public.tofus (piko_id, local_id, name, version, runtime, mods_count, status)
    select piko_id, local_id, name, version, runtime, mods_count, status from tofu_in
    on conflict (piko_id, local_id) do update set
      name = excluded.name, version = excluded.version, runtime = excluded.runtime,
      mods_count = excluded.mods_count, status = excluded.status, updated_at = now()
    returning 1
  )
  select (select count(*) from upserted), (select count(*) from tofus_upserted)
  into pikos_count, tofus_count;

  return jsonb_build_object('pikos', pikos_count, 'tofus', tofus_count);
end;
$$;

revoke execute on function public.sync_my_library(jsonb) from public, anon;
grant execute on function public.sync_my_library(jsonb) to authenticated;
