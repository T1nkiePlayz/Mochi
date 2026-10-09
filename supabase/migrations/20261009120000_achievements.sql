-- Cloud copy of each user's Mochi achievements (one row per user).
-- The launcher merges local and cloud data (union of unlocks, earliest timestamp wins).
create table if not exists public.achievements (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.achievements enable row level security;

revoke all on table public.achievements from anon;
grant select, insert, update, delete on table public.achievements to authenticated;

drop policy if exists "achievements_select_own" on public.achievements;
drop policy if exists "achievements_insert_own" on public.achievements;
drop policy if exists "achievements_update_own" on public.achievements;
drop policy if exists "achievements_delete_own" on public.achievements;

create policy "achievements_select_own" on public.achievements
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "achievements_insert_own" on public.achievements
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "achievements_update_own" on public.achievements
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "achievements_delete_own" on public.achievements
  for delete to authenticated
  using ((select auth.uid()) = user_id);
