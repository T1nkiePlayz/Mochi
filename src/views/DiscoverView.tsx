import { supabase } from "../lib/supabase";
import { ModrinthDiscover } from "../components/discover/ModrinthDiscover";
import { useApp } from "../state/AppContext";

export function DiscoverView() {
  const { lib, playtime } = useApp();
  return <ModrinthDiscover tofu={lib.selectedTofu} pikos={lib.library} playtime={playtime} supabase={supabase} />;
}
