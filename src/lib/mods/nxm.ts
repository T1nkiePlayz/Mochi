// Pure: Nexus Mods "Mod Manager Download" links. No runtime imports.
//   nxm://<game domain>/mods/<mod id>/files/<file id>?key=<key>&expires=<unix seconds>&user_id=<id>

export type NxmLink = { gameDomain: string; modId: number; fileId: number; key: string; expires: number; userId?: number };
export type NxmParse = { ok: true; link: NxmLink } | { ok: false; reason: string };

const DOMAIN = /^[a-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{8,256}$/;
const positive = (value: string | null | undefined) => (value && /^\d{1,10}$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647 ? Number(value) : null);

export const isNxmUrl = (url: string) => /^nxm:\/\//i.test(url.trim());

/** Validates an nxm:// link strictly; anything unexpected is refused with a reason the user can read. */
export function parseNxmLink(raw: string): NxmParse {
  const text = raw.trim();
  if (!isNxmUrl(text) || text.length > 2048) return { ok: false, reason: "This is not a Nexus Mods download link." };
  let url: URL;
  try { url = new URL(text); } catch { return { ok: false, reason: "The Nexus Mods link is malformed." }; }
  // Only a bare game domain may precede the path: no user info ("@") and no port (":").
  const authority = text.slice("nxm://".length).split(/[/?#]/, 1)[0];
  if (/[@:]/.test(authority)) return { ok: false, reason: "The Nexus Mods link is malformed." };
  const gameDomain = url.hostname.toLowerCase();
  if (!DOMAIN.test(gameDomain)) return { ok: false, reason: "The link names an unknown game." };
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "collections") return { ok: false, reason: "Collections links are not supported yet. Download the collection's mods one by one." };
  if (parts.length !== 4 || parts[0] !== "mods" || parts[2] !== "files") return { ok: false, reason: "This Nexus Mods link is not a file download." };
  const modId = positive(parts[1]);
  const fileId = positive(parts[3]);
  if (!modId || !fileId) return { ok: false, reason: "The link has an invalid mod or file id." };
  const key = url.searchParams.get("key") ?? "";
  const expiresText = url.searchParams.get("expires") ?? "";
  const expires = /^\d{1,11}$/.test(expiresText) && Number(expiresText) > 0 ? Number(expiresText) : null;
  if (!KEY.test(key) || !expires) return { ok: false, reason: "The link has no valid download key. Click \"Mod Manager Download\" on Nexus Mods again." };
  const userId = positive(url.searchParams.get("user_id")) ?? undefined;
  return { ok: true, link: { gameDomain, modId, fileId, key, expires, ...(userId ? { userId } : {}) } };
}

/** Nexus download keys are short-lived; `now` in ms. */
export const nxmExpired = (link: Pick<NxmLink, "expires">, now = Date.now()) => link.expires * 1000 <= now;

/** The page whose "Mod Manager Download" button produces an nxm:// link for one file. */
export const nexusManagerDownloadUrl = (gameDomain: string, modId: number, fileId?: number) =>
  `https://www.nexusmods.com/${encodeURIComponent(gameDomain)}/mods/${modId}?tab=files${fileId ? `&file_id=${fileId}&nmm=1` : ""}`;
