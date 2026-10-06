create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  cloud_sync_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pikos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  name text not null,
  description text not null default '',
  accent text not null default '#80b7a4',
  artwork text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

create table public.tofus (
  id uuid primary key default gen_random_uuid(),
  piko_id uuid not null references public.pikos(id) on delete cascade,
  local_id text not null,
  name text not null,
  version text not null,
  runtime text not null,
  mods_count integer not null default 0 check (mods_count >= 0),
  status text not null default 'Ready' check (status in ('Ready', 'Needs attention')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (piko_id, local_id)
);

create index pikos_user_id_idx on public.pikos(user_id);
create index tofus_piko_id_idx on public.tofus(piko_id);

alter table public.profiles enable row level security;
alter table public.pikos enable row level security;
alter table public.tofus enable row level security;

create policy "Users can view their own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Users can create their own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users can view their own Pikos" on public.pikos for select to authenticated using (auth.uid() = user_id);
create policy "Users can create their own Pikos" on public.pikos for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own Pikos" on public.pikos for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own Pikos" on public.pikos for delete to authenticated using (auth.uid() = user_id);

create policy "Users can view their own Tofus" on public.tofus for select to authenticated using (
  exists (select 1 from public.pikos where pikos.id = tofus.piko_id and pikos.user_id = auth.uid())
);
create policy "Users can create their own Tofus" on public.tofus for insert to authenticated with check (
  exists (select 1 from public.pikos where pikos.id = tofus.piko_id and pikos.user_id = auth.uid())
);
create policy "Users can update their own Tofus" on public.tofus for update to authenticated using (
  exists (select 1 from public.pikos where pikos.id = tofus.piko_id and pikos.user_id = auth.uid())
) with check (
  exists (select 1 from public.pikos where pikos.id = tofus.piko_id and pikos.user_id = auth.uid())
);
create policy "Users can delete their own Tofus" on public.tofus for delete to authenticated using (
  exists (select 1 from public.pikos where pikos.id = tofus.piko_id and pikos.user_id = auth.uid())
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
