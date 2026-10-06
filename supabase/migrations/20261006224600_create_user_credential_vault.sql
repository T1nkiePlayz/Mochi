create schema if not exists mochi_private;

create table if not exists mochi_private.user_credentials (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('igdb', 'nexus')),
  secret_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table mochi_private.user_credentials enable row level security;

revoke all on schema mochi_private from anon, authenticated;
revoke all on mochi_private.user_credentials from anon, authenticated;
grant usage on schema mochi_private to service_role;
grant select, insert, update, delete on mochi_private.user_credentials to service_role;