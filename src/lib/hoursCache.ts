import { readJson, writeJson } from "./storage";

export const hoursCacheKey = "mochi:time-to-beat";

/** IGDB time-to-beat (hours) per game id, remembered on this device so filters and totals work offline. */
export function readHoursCache(): Map<string, number> {
  const raw = readJson<unknown>(hoursCacheKey, {});
  const out = new Map<string, number>();
  if (raw && typeof raw === "object") for (const [id, value] of Object.entries(raw)) if (typeof value === "number" && Number.isFinite(value) && value > 0) out.set(id, value);
  return out;
}

export const writeHoursCache = (hours: ReadonlyMap<string, number>) => { writeJson(hoursCacheKey, Object.fromEntries(hours)); };

/** Total hours still to beat for these games (games without data count as zero) and how many had data. */
export function remainingHours(ids: Iterable<string>, hours: ReadonlyMap<string, number>): { total: number; known: number } {
  let total = 0, known = 0;
  for (const id of ids) { const value = hours.get(id); if (value) { total += value; known++; } }
  return { total: Math.round(total), known };
}
