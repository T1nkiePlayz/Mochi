import { invoke } from "@tauri-apps/api/core";

export type ProtonTier = "native" | "platinum" | "gold" | "silver" | "bronze" | "borked";
export type ProtonDbSummary = { tier: ProtonTier; trendingTier: ProtonTier | null; total: number; confidence: string | null };
export type ProtonDbResult = { status: "ok" | "not-found" | "offline" | "error"; summary: ProtonDbSummary | null; message: string | null };

const labels: Record<ProtonTier, string> = { native: "Native", platinum: "Platinum", gold: "Gold", silver: "Silver", bronze: "Bronze", borked: "Borked" };
export const protonTierLabel = (tier: ProtonTier) => labels[tier];
export const protonDbUrl = (appid: number) => `https://www.protondb.com/app/${appid}`;

/** Honest, generic next steps for a tier: ProtonDB's public summary has no per-game launch flags, so none are invented. */
export function protonAdvice(tier: ProtonTier): string {
  switch (tier) {
    case "native": return "Runs natively on Linux. No Proton needed.";
    case "platinum": return "Works out of the box with Proton.";
    case "gold": return "Works well with minor tweaks. Recent reports list any flags that help.";
    case "silver": return "Playable with issues. Try the newest Proton or Proton-GE, and read recent reports for fixes.";
    case "bronze": return "Runs poorly. Try Proton Experimental or Proton-GE and check reports for required launch options.";
    case "borked": return "Reported as not working. Check recent reports before spending time on it.";
  }
}

const session = new Map<number, Promise<ProtonDbResult>>();
/** One lookup per game per session; failures are not remembered so a retry can succeed. */
export function getProtonDbSummary(appid: number): Promise<ProtonDbResult> {
  const cached = session.get(appid);
  if (cached) return cached;
  const request = invoke<ProtonDbResult>("get_protondb_summary", { appid })
    .catch((error): ProtonDbResult => ({ status: "error", summary: null, message: error instanceof Error ? error.message : String(error) }))
    .then((result) => { if (result.status === "offline" || result.status === "error") session.delete(appid); return result; });
  session.set(appid, request);
  return request;
}
