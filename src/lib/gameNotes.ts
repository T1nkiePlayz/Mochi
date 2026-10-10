import type { GameLink } from "../models";

export const NOTES_MAX = 5000;
export const LINKS_MAX = 20;

/** Only web links are kept: anything else (file:, javascript:, ...) must never reach the system opener. */
export function cleanLink(value: unknown): GameLink | null {
  if (typeof value !== "object" || value === null) return null;
  const { label, url } = value as Record<string, unknown>;
  if (typeof url !== "string") return null;
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const text = typeof label === "string" ? label.trim().slice(0, 80) : "";
  return { label: text || parsed.hostname, url: parsed.toString() };
}

export const cleanLinks = (value: unknown): GameLink[] =>
  (Array.isArray(value) ? value : []).map(cleanLink).filter((link): link is GameLink => link !== null).slice(0, LINKS_MAX);

/** Normalises the notes fields of a stored game; empty values are dropped so backups stay small. */
export function withCleanNotes<T extends { notes?: unknown; links?: unknown }>(game: T): T {
  const notes = typeof game.notes === "string" ? game.notes.slice(0, NOTES_MAX) : "";
  const links = cleanLinks(game.links);
  const { notes: _n, links: _l, ...rest } = game;
  return { ...rest, ...(notes.trim() ? { notes } : {}), ...(links.length ? { links } : {}) } as T;
}
