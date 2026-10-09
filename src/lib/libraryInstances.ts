import type { Piko, Tofu } from "../models";
import { normalizeText } from "./search";
import { MINECRAFT_PIKO_ID } from "./minecraftPiko";

const LOADER_LABELS: Record<string, string> = { vanilla: "Vanilla", fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };

/** The launcher instances (Tofus with their own launch target) of the Minecraft Piko; every other Piko has none. */
export const instanceTofus = (piko: Piko): Tofu[] => (piko.id === MINECRAFT_PIKO_ID ? piko.tofus.filter((tofu) => Boolean(tofu.launchTarget)) : []);

/** "1.20.1 · Fabric", or just the version when the loader is unknown. */
export const instanceLabel = (tofu: Pick<Tofu, "version" | "loader">) => [tofu.version, tofu.loader ? LOADER_LABELS[tofu.loader] ?? tofu.loader : ""].filter(Boolean).join(" · ");

/** Whether a query matches an instance by name, version or loader (substring on normalized text). */
export function instanceMatches(tofu: Tofu, query: string): boolean {
  const needle = normalizeText(query);
  return !needle || [tofu.name, tofu.version, tofu.loader ?? ""].some((field) => normalizeText(field).includes(needle));
}

/**
 * The instance sub-entries to show under a Piko: all of them without a search or when the Piko itself matches the search,
 * otherwise only the instances that match it.
 */
export function visibleInstances(piko: Piko, query: string, pikoMatches: boolean): Tofu[] {
  const all = instanceTofus(piko);
  const text = query.trim();
  return !text || pikoMatches ? all : all.filter((tofu) => instanceMatches(tofu, text));
}
