import { supabase } from "../lib/supabase";
import { ModrinthDiscover } from "../components/discover/ModrinthDiscover";
import { useApp } from "../state/AppContext";

export function DiscoverView() {
  const { lib, playtime, credentials } = useApp();
  return <ModrinthDiscover tofu={lib.selectedTofu} pikos={lib.library} playtime={playtime} supabase={supabase} nexusConfigured={credentials.status.nexus} />;
}
