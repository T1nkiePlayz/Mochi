-- Reconciles the repository with the live project and fixes security/performance
-- findings. Every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Columns the app reads/writes that earlier migrations never created
-- ---------------------------------------------------------------------------
alter table public.pikos
  add column if not exists executable_path text,
  add column if not exists source text not null default 'built-in',
  add column if not exists categories text[] not null default '{}',
  add column if not exists source_id text,
  add column if not exists platform_category text,
  add column if not exists igdb_id bigint,
  add column if not exists artwork_url text,
  add column if not exists screenshots text[] not null default '{}',
  add column if not exists trailer_id text,
  add column if not exists first_release_date bigint;

alter table public.profiles
  add column if not exists metadata_sync_allowed boolean not null default false,
  add column if not exists email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pikos_source_check') then
    alter table public.pikos add constraint pikos_source_check check (source in ('built-in', 'custom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pikos_source_id_check') then
    alter table public.pikos add constraint pikos_source_id_check
      check (source_id is null or source_id in ('flatpak', 'heroic', 'steam', 'lutris', 'bottles', 'itch', 'apps'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pikos_size_limits') then
    alter table public.pikos add constraint pikos_size_limits check (
      char_length(name) between 1 and 300
      and char_length(description) <= 20000
      and coalesce(char_length(artwork), 0) <= 8192
      and coalesce(char_length(executable_path), 0) <= 4096
      and coalesce(cardinality(screenshots), 0) <= 30
      and coalesce(cardinality(categories), 0) <= 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tofus_size_limits') then
    alter table public.tofus add constraint tofus_size_limits check (
      char_length(name) between 1 and 200 and char_length(version) <= 100 and char_length(runtime) <= 100);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table privileges: the app upserts Pikos/Tofus, and nothing needs TRUNCATE
--    (which bypasses RLS) or anonymous access.
-- ---------------------------------------------------------------------------
revoke all on public.pikos, public.tofus, public.profiles from anon;
revoke truncate, references, trigger on public.pikos, public.tofus, public.profiles from authenticated;
grant select, insert, update, delete on public.pikos, public.tofus to authenticated;
grant select, insert, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Profiles: users must not be able to grant themselves cloud access
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_admin boolean := coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin';
begin
  if current_user in ('anon', 'authenticated') and not is_admin then
    if tg_op = 'INSERT' then
      new.metadata_sync_allowed := false;
      new.cloud_sync_enabled := false;
    else
      new.id := old.id;
      new.created_at := old.created_at;
      new.email := old.email;
      new.metadata_sync_allowed := old.metadata_sync_allowed;
    end if;
  end if;
  if new.cloud_sync_enabled and not new.metadata_sync_allowed then
    new.cloud_sync_enabled := false;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_profile_columns on public.profiles;
create trigger protect_profile_columns
  before insert or update on public.profiles
  for each row execute function public.protect_profile_columns();

drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Users and admins can view profiles" on public.profiles;
create policy "Users and admins can view profiles" on public.profiles for select to authenticated
  using ((select auth.uid()) = id or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Admins can update metadata access" on public.profiles;
drop policy if exists "Users and admins can update profiles" on public.profiles;
create policy "Users and admins can update profiles" on public.profiles for update to authenticated
  using ((select auth.uid()) = id or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.uid()) = id or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- 4. Admin RPCs: `role <> 'admin'` is NULL (not true) when the claim is absent,
--    so the old check never raised for non-admins. Use IS DISTINCT FROM and
--    remove anonymous/public execution.
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_profiles()
returns setof public.profiles
language sql
security definer
set search_path = ''
as $$
  select p.*
  from public.profiles p
  where coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin'
  order by p.created_at desc;
$$;

create or replace function public.admin_set_cloud_sync(target_user_id uuid, enabled boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.profiles;
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.profiles set cloud_sync_enabled = enabled
  where id = target_user_id
  returning * into result;
  if result.id is null then raise exception 'Profile not found'; end if;
  return result;
end;
$$;

create or replace function public.admin_set_metadata_access(target_user_id uuid, allowed boolean)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare result public.profiles;
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') is distinct from 'admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  update public.profiles set metadata_sync_allowed = allowed
  where id = target_user_id
  returning * into result;
  if result.id is null then raise exception 'Profile not found'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Profile bootstrap/sync functions
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_profile_email();

update public.profiles p set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

create or replace function public.update_my_profile(profile_data jsonb)
returns public.profiles
language plpgsql
set search_path = ''
as $$
declare
  result public.profiles;
  next_name text := nullif(trim(profile_data ->> 'display_name'), '');
  next_avatar text := nullif(trim(profile_data ->> 'avatar_url'), '');
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if next_name is not null and char_length(next_name) > 100 then raise exception 'Display name is too long'; end if;
  if next_avatar is not null and (char_length(next_avatar) > 2048 or next_avatar !~ '^https://') then
    raise exception 'Avatar must be an https URL';
  end if;

  update public.profiles
  set display_name = case when profile_data ? 'display_name' then next_name else display_name end,
      avatar_url = case when profile_data ? 'avatar_url' then next_avatar else avatar_url end,
      cloud_sync_enabled = coalesce((profile_data ->> 'cloud_sync_enabled')::boolean, cloud_sync_enabled)
  where id = (select auth.uid())
  returning * into result;

  if result.id is null then raise exception 'Profile not found'; end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cloud library RPCs
-- ---------------------------------------------------------------------------
create or replace function public.clear_my_cloud_data()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  deleted_tofus bigint;
  deleted_pikos bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.tofus where piko_id in (select id from public.pikos where user_id = uid);
  get diagnostics deleted_tofus = row_count;
  delete from public.pikos where user_id = uid;
  get diagnostics deleted_pikos = row_count;
  return jsonb_build_object('deleted_tofus', deleted_tofus, 'deleted_pikos', deleted_pikos);
end;
$$;

-- One transactional round trip instead of many REST calls, and no giant
-- `not in (...)` query strings that overflow the URL limit for big libraries.
create or replace function public.sync_my_library(library jsonb)
returns jsonb
language plpgsql
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
      categories text[], screenshots text[], trailer_id text, first_release_date bigint, tofus jsonb)
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
      source_id, platform_category, igdb_id, categories, screenshots, trailer_id, first_release_date)
    select uid, local_id, name, coalesce(description, ''), coalesce(accent, '#80b7a4'), artwork, artwork_url,
      executable_path, case when source = 'custom' then 'custom' else 'built-in' end,
      source_id, platform_category, igdb_id, coalesce(categories, '{}'), coalesce(screenshots, '{}'),
      trailer_id, first_release_date
    from incoming
    on conflict (user_id, local_id) do update set
      name = excluded.name, description = excluded.description, accent = excluded.accent,
      artwork = excluded.artwork, artwork_url = excluded.artwork_url,
      executable_path = excluded.executable_path, source = excluded.source,
      source_id = excluded.source_id, platform_category = excluded.platform_category,
      igdb_id = excluded.igdb_id, categories = excluded.categories, screenshots = excluded.screenshots,
      trailer_id = excluded.trailer_id, first_release_date = excluded.first_release_date,
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

-- ---------------------------------------------------------------------------
-- 7. Function execution privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.admin_list_profiles(), public.admin_set_cloud_sync(uuid, boolean),
  public.admin_set_metadata_access(uuid, boolean), public.update_my_profile(jsonb),
  public.clear_my_cloud_data(), public.sync_my_library(jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. updated_at maintenance and indexes
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_pikos_updated_at on public.pikos;
create trigger touch_pikos_updated_at before update on public.pikos
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_tofus_updated_at on public.tofus;
create trigger touch_tofus_updated_at before update on public.tofus
  for each row execute function public.touch_updated_at();

-- The unique (user_id, local_id) / (piko_id, local_id) indexes already serve
-- lookups by their leading column, so the single-column indexes are redundant.
drop index if exists public.pikos_user_id_idx;
drop index if exists public.tofus_piko_id_idx;
create index if not exists pikos_user_created_idx on public.pikos (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 9. Provider credentials: explicit deny policy, and never orphan vault secrets
-- ---------------------------------------------------------------------------
drop policy if exists "No direct access" on mochi_private.user_credentials;
create policy "No direct access" on mochi_private.user_credentials
  for all to anon, authenticated using (false) with check (false);

create or replace function mochi_private.delete_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;

revoke all on function mochi_private.delete_vault_secret() from public, anon, authenticated;

drop trigger if exists delete_vault_secret on mochi_private.user_credentials;
create trigger delete_vault_secret after delete on mochi_private.user_credentials
  for each row execute function mochi_private.delete_vault_secret();
