-- Fix cloud sync failing with 42501 when a single RPC inserts both Pikos and Tofus.
--
-- PostgreSQL data-modifying CTEs share a statement snapshot. The Tofu INSERT
-- policy checks that its parent Piko is visible through public.pikos, but a
-- Piko inserted by another CTE in the same statement is not visible to that
-- policy's subquery. Keep invoker rights and the ownership RLS policies intact;
-- run each stage as a separate SQL command within this function's transaction.

-- Keep the server's source-id constraint aligned with source ids currently
-- emitted by src/lib/cloud.ts. In particular, legendary/nile otherwise make a
-- whole-library RPC fail when a library contains one of those launchers.
do $
declare
  source_id_attnum smallint;
  constraint_row record;
begin
  select attnum into source_id_attnum
  from pg_attribute
  where attrelid = 'public.pikos'::regclass
    and attname = 'source_id'
    and not attisdropped;

  if source_id_attnum is null then
    raise exception 'public.pikos.source_id column is required for cloud sync';
  end if;

  -- Replace only allowlist checks that constrain source_id alone. Older
  -- installs may have kept an auto-generated name, so matching by name alone
  -- is insufficient. Other checks (size, kind, artwork, etc.) are untouched.
  for constraint_row in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.pikos'::regclass
      and c.contype = 'c'
      and c.conkey = array[source_id_attnum]::smallint[]
      and pg_get_constraintdef(c.oid) ~* 'source_id'
      and pg_get_constraintdef(c.oid) ~* '= any'
      and pg_get_constraintdef(c.oid) ~* '''(flatpak|heroic|steam|lutris|bottles|itch|apps|epic|whisky|battlenet|gog|prism|legendary|nile)'''
  loop
    execute format('alter table public.pikos drop constraint %I', constraint_row.conname);
  end loop;

  alter table public.pikos add constraint pikos_source_id_check
    check (source_id is null or source_id in (
      'flatpak', 'heroic', 'steam', 'lutris', 'bottles', 'itch', 'apps',
      'epic', 'whisky', 'battlenet', 'gog', 'prism', 'legendary', 'nile'
    ));
end
$;

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
  if uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(library) is distinct from 'array' then
    raise exception 'Library must be a JSON array';
  end if;
  if jsonb_array_length(library) > 5000 then
    raise exception 'Library is too large to sync';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = uid and cloud_sync_enabled and metadata_sync_allowed
  ) then
    raise exception 'Cloud sync is not enabled for this account' using errcode = '42501';
  end if;

  -- Remove Pikos no longer present. Child Tofus are removed by the FK cascade.
  delete from public.pikos p
  where p.user_id = uid
    and not exists (
      select 1
      from jsonb_to_recordset(library) as incoming(local_id text, name text)
      where incoming.local_id is not null
        and incoming.name is not null
        and incoming.local_id = p.local_id
    );

  -- Upsert parent rows in their own statement so the next statement's RLS
  -- checks can see newly inserted Pikos.
  insert into public.pikos (
    user_id, local_id, name, description, accent, artwork, artwork_url, executable_path, source,
    source_id, platform_category, igdb_id, categories, screenshots, trailer_id, first_release_date,
    favorite, tags, artwork_source, kind
  )
  select
    uid, incoming.local_id, incoming.name, coalesce(incoming.description, ''),
    coalesce(incoming.accent, '#80b7a4'), incoming.artwork, incoming.artwork_url,
    incoming.executable_path, case when incoming.source = 'custom' then 'custom' else 'built-in' end,
    incoming.source_id, incoming.platform_category, incoming.igdb_id,
    coalesce(incoming.categories, '{}'), coalesce(incoming.screenshots, '{}'),
    incoming.trailer_id, incoming.first_release_date,
    coalesce(incoming.favorite, false), coalesce(incoming.tags, '{}'),
    case when incoming.artwork_source in ('igdb', 'steamgriddb', 'steam', 'custom')
      then incoming.artwork_source else null end,
    case when incoming.kind in ('game', 'launcher') then incoming.kind else null end
  from (
    select distinct on (x.local_id) x.*
    from jsonb_to_recordset(library) as x(
      local_id text, name text, description text, accent text, artwork text, artwork_url text,
      executable_path text, source text, source_id text, platform_category text, igdb_id bigint,
      categories text[], screenshots text[], trailer_id text, first_release_date bigint,
      favorite boolean, tags text[], artwork_source text, kind text, tofus jsonb
    )
    where x.local_id is not null and x.name is not null
    order by x.local_id, x.name
  ) incoming
  on conflict (user_id, local_id) do update set
    name = excluded.name,
    description = excluded.description,
    accent = excluded.accent,
    artwork = excluded.artwork,
    artwork_url = excluded.artwork_url,
    executable_path = excluded.executable_path,
    source = excluded.source,
    source_id = excluded.source_id,
    platform_category = excluded.platform_category,
    igdb_id = excluded.igdb_id,
    categories = excluded.categories,
    screenshots = excluded.screenshots,
    trailer_id = excluded.trailer_id,
    first_release_date = excluded.first_release_date,
    favorite = excluded.favorite,
    tags = excluded.tags,
    artwork_source = excluded.artwork_source,
    kind = excluded.kind,
    updated_at = now();

  get diagnostics pikos_count = row_count;

  -- Delete stale children only after the parent set is reconciled.
  delete from public.tofus tf
  using public.pikos p
  where tf.piko_id = p.id
    and p.user_id = uid
    and not exists (
      select 1
      from jsonb_to_recordset(library) as incoming(local_id text, name text, tofus jsonb)
      cross join lateral jsonb_to_recordset(coalesce(incoming.tofus, '[]'::jsonb))
        as tofu(local_id text, name text)
      where incoming.local_id = p.local_id
        and incoming.name is not null
        and tofu.local_id = tf.local_id
        and tofu.name is not null
    );

  -- This is a separate statement from the Piko upsert: the existing
  -- "Users can create their own Tofus" policy can now see each parent row.
  insert into public.tofus (piko_id, local_id, name, version, runtime, mods_count, status)
  select
    p.id, incoming_tofu.local_id, incoming_tofu.name,
    coalesce(incoming_tofu.version, 'Local'),
    coalesce(incoming_tofu.runtime, 'Native'),
    greatest(coalesce(incoming_tofu.mods_count, 0), 0),
    case when incoming_tofu.status = 'Needs attention' then 'Needs attention' else 'Ready' end
  from jsonb_to_recordset(library) as incoming(local_id text, name text, tofus jsonb)
  join public.pikos p on p.user_id = uid and p.local_id = incoming.local_id
  cross join lateral jsonb_to_recordset(coalesce(incoming.tofus, '[]'::jsonb))
    as incoming_tofu(local_id text, name text, version text, runtime text, mods_count integer, status text)
  where incoming.name is not null
    and incoming_tofu.local_id is not null
    and incoming_tofu.name is not null
  on conflict (piko_id, local_id) do update set
    name = excluded.name,
    version = excluded.version,
    runtime = excluded.runtime,
    mods_count = excluded.mods_count,
    status = excluded.status,
    updated_at = now();

  get diagnostics tofus_count = row_count;

  return jsonb_build_object('pikos', pikos_count, 'tofus', tofus_count);
end;
$$;

revoke execute on function public.sync_my_library(jsonb) from public, anon;
grant execute on function public.sync_my_library(jsonb) to authenticated;
