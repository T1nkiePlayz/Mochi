import { supabase } from "../lib/supabase";
import { ModrinthDiscover } from "../components/ModrinthDiscover";
import { useApp } from "../state/AppContext";

export function DiscoverView() {
  const { lib, playtime, credentials } = useApp();
  return <ModrinthDiscover tofu={lib.selectedTofu} pikos={lib.library} playtime={playtime} nexusConfigured={credentials.status.nexus} supabase={supabase} />;
}
