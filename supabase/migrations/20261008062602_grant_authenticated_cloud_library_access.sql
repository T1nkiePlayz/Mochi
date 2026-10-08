-- RLS policies limit these operations to rows owned by the authenticated user.
-- The cloud-clear RPC needs SELECT for its owner filters and DELETE to remove
-- that user's Pikos and Tofus; it does not need broader write access.
grant select, delete on table public.pikos, public.tofus to authenticated;
