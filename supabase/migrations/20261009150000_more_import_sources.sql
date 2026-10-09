-- New import sources (Epic and Whisky on macOS, Battle.net, GOG, Minecraft instances) may be stored
-- as pikos.source_id. Idempotent: the constraint is replaced with the wider list.
alter table public.pikos drop constraint if exists pikos_source_id_check;
alter table public.pikos add constraint pikos_source_id_check
  check (source_id is null or source_id in ('flatpak', 'heroic', 'steam', 'lutris', 'bottles', 'itch', 'apps', 'epic', 'whisky', 'battlenet', 'gog', 'prism'));
