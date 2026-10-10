// `.mochipack`: a small shareable list of a Tofu's mods (ids and hashes only, never file contents). See docs/mochipack.md.
// Pure module (no Tauri): serialisation, strict validation of untrusted input, and the `mochipack:<code>` short form.

export const MOCHIPACK_FORMAT = "mochipack";
export const MOCHIPACK_VERSION = 1;
export const MOCHIPACK_MAX_ITEMS = 2000;
/** Largest pack file or decoded code Mochi reads. */
export const MOCHIPACK_MAX_BYTES = 2 * 1024 * 1024;
/** A short code is only offered when the compressed pack is smaller than this. */
export const SHORT_CODE_MAX_BYTES = 4096;
export const CODE_PREFIX = "mochipack:";

export type PackProvider = "modrinth" | "curseforge" | "nexus";
export type PackFolder = "mods" | "resourcepacks" | "shaderpacks";
export const PACK_PROVIDERS: readonly PackProvider[] = ["modrinth", "curseforge", "nexus"];
export const PACK_FOLDERS: readonly PackFolder[] = ["mods", "resourcepacks", "shaderpacks"];

export type PackGame = { name: string; pikoId?: string; minecraft?: boolean; cfGameId?: number; nexusDomain?: string };
export type PackMod = { provider: PackProvider; projectId: string; fileId: string; fileName: string; sha1?: string; folder: PackFolder; enabled: boolean };
export type PackUnknown = { fileName: string; sha1: string };
export type MochiPack = {
  format: typeof MOCHIPACK_FORMAT; version: typeof MOCHIPACK_VERSION; /** The Tofu's name (a suggestion for the new Tofu). */ name?: string; game: PackGame; loader?: string; gameVersion?: string;
  mods: PackMod[]; unknown: PackUnknown[]; settings?: Record<string, string | number | boolean>;
};

/** Raised for anything wrong with a pack file or code; the message is meant for the user. */
export class MochipackError extends Error { constructor(message: string) { super(message); this.name = "MochipackError"; } }

const bad = (message: string): never => { throw new MochipackError(message); };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const CONTROL = /[\u0000-\u001f\u007f]/;

function str(value: unknown, where: string, max: number, min = 1): string {
  if (typeof value !== "string") return bad(`${where} must be text.`);
  if (value.length < min || value.length > max) return bad(`${where} has an invalid length.`);
  if (CONTROL.test(value)) return bad(`${where} contains control characters.`);
  return value;
}
function optStr(value: unknown, where: string, max: number): string | undefined { return value === undefined || value === null || value === "" ? undefined : str(value, where, max); }
function pattern(value: unknown, where: string, regex: RegExp, max: number): string {
  const text = str(value, where, max);
  return regex.test(text) ? text : bad(`${where} is not valid.`);
}

const MODRINTH_ID = /^[A-Za-z0-9]{1,16}$/;
const NUMERIC_ID = /^[1-9][0-9]{0,11}$/;
const SHA1 = /^[0-9a-fA-F]{40}$/;
const NEXUS_DOMAIN = /^[a-z0-9_-]{1,64}$/;
const LOADER = /^[a-z0-9_-]{1,24}$/;
const VERSION = /^[A-Za-z0-9._+ -]{1,40}$/;

/** File names are informational only, but must never look like a path. */
export function isSafeFileName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && !CONTROL.test(name) && !/[\\/]/.test(name) && name !== "." && name !== ".." && !name.includes("\0");
}
function fileName(value: unknown, where: string): string {
  const name = str(value, where, 255);
  return isSafeFileName(name) ? name : bad(`${where} must be a plain file name.`);
}

function validateMod(raw: unknown, index: number): PackMod {
  const where = `mods[${index}]`;
  if (!isObject(raw)) return bad(`${where} must be an object.`);
  const provider = raw.provider;
  if (typeof provider !== "string" || !(PACK_PROVIDERS as readonly string[]).includes(provider)) return bad(`${where}.provider must be modrinth, curseforge or nexus.`);
  const id = provider === "modrinth" ? MODRINTH_ID : NUMERIC_ID;
  const folder = raw.folder === undefined ? "mods" : raw.folder;
  if (typeof folder !== "string" || !(PACK_FOLDERS as readonly string[]).includes(folder)) return bad(`${where}.folder must be mods, resourcepacks or shaderpacks.`);
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") return bad(`${where}.enabled must be true or false.`);
  return {
    provider: provider as PackProvider, projectId: pattern(raw.projectId, `${where}.projectId`, id, 16), fileId: pattern(raw.fileId, `${where}.fileId`, id, 16),
    fileName: fileName(raw.fileName, `${where}.fileName`), ...(raw.sha1 === undefined || raw.sha1 === null ? {} : { sha1: pattern(raw.sha1, `${where}.sha1`, SHA1, 40).toLowerCase() }),
    folder: folder as PackFolder, enabled: raw.enabled !== false,
  };
}

/** Checks untrusted data and returns a clean copy holding only the known fields. Throws `MochipackError`. */
export function validatePack(value: unknown): MochiPack {
  if (!isObject(value)) return bad("This is not a Mochi modpack.");
  if (value.format !== MOCHIPACK_FORMAT) return bad("This is not a Mochi modpack (format is not \"mochipack\").");
  if (value.version !== MOCHIPACK_VERSION) return bad(typeof value.version === "number" && value.version > MOCHIPACK_VERSION ? "This pack was made by a newer Mochi. Update Mochi to import it." : "Unsupported modpack version.");
  const rawGame = value.game;
  if (!isObject(rawGame)) return bad("The pack has no game.");
  const game: PackGame = { name: str(rawGame.name, "game.name", 120) };
  const pikoId = optStr(rawGame.pikoId, "game.pikoId", 80);
  if (pikoId) game.pikoId = pikoId;
  if (rawGame.minecraft !== undefined && typeof rawGame.minecraft !== "boolean") return bad("game.minecraft must be true or false.");
  if (rawGame.minecraft !== undefined) game.minecraft = rawGame.minecraft;
  if (rawGame.cfGameId !== undefined && rawGame.cfGameId !== null) {
    if (typeof rawGame.cfGameId !== "number" || !Number.isSafeInteger(rawGame.cfGameId) || rawGame.cfGameId < 1) return bad("game.cfGameId is not valid.");
    game.cfGameId = rawGame.cfGameId;
  }
  if (rawGame.nexusDomain !== undefined && rawGame.nexusDomain !== null && rawGame.nexusDomain !== "") game.nexusDomain = pattern(rawGame.nexusDomain, "game.nexusDomain", NEXUS_DOMAIN, 64);

  if (!Array.isArray(value.mods)) return bad("The pack has no mod list.");
  const rawUnknown = value.unknown === undefined ? [] : value.unknown;
  if (!Array.isArray(rawUnknown)) return bad("unknown must be a list.");
  if (value.mods.length > MOCHIPACK_MAX_ITEMS) return bad(`The pack lists more than ${MOCHIPACK_MAX_ITEMS} mods.`);
  if (rawUnknown.length > MOCHIPACK_MAX_ITEMS) return bad(`The pack lists more than ${MOCHIPACK_MAX_ITEMS} unidentified files.`);

  const pack: MochiPack = { format: MOCHIPACK_FORMAT, version: MOCHIPACK_VERSION, game, mods: value.mods.map(validateMod), unknown: rawUnknown.map((raw, index) => {
    if (!isObject(raw)) return bad(`unknown[${index}] must be an object.`);
    return { fileName: fileName(raw.fileName, `unknown[${index}].fileName`), sha1: pattern(raw.sha1, `unknown[${index}].sha1`, SHA1, 40).toLowerCase() };
  }) };
  const name = optStr(value.name, "name", 60);
  if (name) pack.name = name;
  const loader = value.loader === undefined || value.loader === null || value.loader === "" ? undefined : pattern(value.loader, "loader", LOADER, 24);
  if (loader) pack.loader = loader;
  const gameVersion = value.gameVersion === undefined || value.gameVersion === null || value.gameVersion === "" ? undefined : pattern(value.gameVersion, "gameVersion", VERSION, 40);
  if (gameVersion) pack.gameVersion = gameVersion;
  if (value.settings !== undefined && value.settings !== null) {
    if (!isObject(value.settings)) return bad("settings must be an object.");
    const entries = Object.entries(value.settings);
    if (entries.length > 32) return bad("settings has too many entries.");
    const settings: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
    for (const [key, entry] of entries) {
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key) || key === "__proto__") return bad("settings has an invalid key.");
      if (typeof entry === "string") settings[key] = str(entry, `settings.${key}`, 200, 0);
      else if (typeof entry === "number" && Number.isFinite(entry)) settings[key] = entry;
      else if (typeof entry === "boolean") settings[key] = entry;
      else return bad(`settings.${key} must be text, a number or true/false.`);
    }
    if (entries.length) pack.settings = { ...settings };
  }
  return pack;
}

/** Parses and validates pack JSON. Refuses text larger than `MOCHIPACK_MAX_BYTES`. */
export function parseMochipack(text: string): MochiPack {
  if (text.length > MOCHIPACK_MAX_BYTES) return bad("This file is too large to be a modpack.");
  let value: unknown;
  try { value = JSON.parse((text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)); } catch { return bad("This file is not valid JSON."); }
  return validatePack(value);
}

export const serializeMochipack = (pack: MochiPack, pretty = true): string => JSON.stringify(pack, null, pretty ? 2 : undefined);

// ---------- building a pack from a Tofu ----------

/** A file of the Tofu with what Mochi knows about it. `sha1` is the file's own hash (from the hash scan or the record). */
export type ExportFile = {
  folder: PackFolder; filename: string; enabled: boolean; sha1?: string;
  record?: { source: "modrinth" | "curseforge" | "nexus" | "manual"; projectId: string; fileId: string; sha1?: string };
};
export type BuildInput = { name?: string; game: PackGame; loader?: string; gameVersion?: string; files: readonly ExportFile[] };
export type BuildResult = { pack: MochiPack; /** Files that were neither matched nor hashed, so they cannot be listed at all. */ omitted: number };

const sameOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Matched files become `mods`; everything else goes to `unknown` with its SHA-1 (so a friend can look it up). CurseForge entries carry
 * ids only (no hashes). Output is sorted, so exporting twice gives identical text.
 */
export function buildMochipack({ name, game, loader, gameVersion, files }: BuildInput): BuildResult {
  const mods: PackMod[] = [];
  const unknown: PackUnknown[] = [];
  let omitted = 0;
  for (const file of files) {
    const name = file.filename.replace(/\.disabled$/i, "");
    if (!isSafeFileName(name)) { omitted += 1; continue; }
    const record = file.record;
    const idOk = record && record.source !== "manual" && (record.source === "modrinth" ? MODRINTH_ID : NUMERIC_ID).test(record.projectId) && (record.source === "modrinth" ? MODRINTH_ID : NUMERIC_ID).test(record.fileId);
    const sha1 = (file.sha1 ?? record?.sha1)?.toLowerCase();
    if (record && record.source !== "manual" && idOk) {
      mods.push({ provider: record.source, projectId: record.projectId, fileId: record.fileId, fileName: name, ...(record.source !== "curseforge" && sha1 && SHA1.test(sha1) ? { sha1 } : {}), folder: file.folder, enabled: file.enabled });
    } else if (sha1 && SHA1.test(sha1)) unknown.push({ fileName: name, sha1 });
    else omitted += 1;
  }
  mods.sort((a, b) => sameOrder(a.folder, b.folder) || sameOrder(a.provider, b.provider) || sameOrder(a.fileName.toLowerCase(), b.fileName.toLowerCase()));
  unknown.sort((a, b) => sameOrder(a.fileName.toLowerCase(), b.fileName.toLowerCase()));
  const pack: MochiPack = { format: MOCHIPACK_FORMAT, version: MOCHIPACK_VERSION, ...(name ? { name: name.slice(0, 60) } : {}), game: { ...game }, ...(loader ? { loader } : {}), ...(gameVersion ? { gameVersion } : {}), mods, unknown };
  return { pack, omitted };
}

// ---------- short code ----------

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return bad("The code contains characters that are not allowed.");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try { binary = atob(padded); } catch { return bad("The code is damaged."); }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Whether this webview can build or read short codes (CompressionStream with "deflate-raw"). Without it only files work. */
export function shortCodeSupported(): boolean {
  try { return typeof CompressionStream === "function" && typeof DecompressionStream === "function" && Boolean(new CompressionStream("deflate-raw")); } catch { return false; }
}

async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel().catch(() => undefined); return bad("The code expands to something too large."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const written = writer.write(bytes as unknown as BufferSource).then(() => writer.close());
  written.catch(() => undefined);
  const out = await readAll(stream.readable as ReadableStream<Uint8Array>, limit);
  await written.catch(() => undefined);
  return out;
}

/** `mochipack:<base64url(deflate-raw(minified json))>`, or null when the pack is too big (or the webview cannot compress). */
export async function encodeShortCode(pack: MochiPack): Promise<string | null> {
  if (!shortCodeSupported()) return null;
  try {
    const packed = await transform(new TextEncoder().encode(serializeMochipack(pack, false)), new CompressionStream("deflate-raw"), SHORT_CODE_MAX_BYTES);
    return packed.length < SHORT_CODE_MAX_BYTES ? CODE_PREFIX + toBase64Url(packed) : null;
  } catch { return null; }
}

/** Reads a short code back (strictly validated). */
export async function decodeShortCode(code: string): Promise<MochiPack> {
  const body = code.trim().replace(/^mochipack:/i, "").replace(/\s+/g, "");
  if (!body) return bad("The code is empty.");
  if (body.length > 96 * 1024) return bad("The code is too long.");
  if (!shortCodeSupported()) return bad("This version of the web view cannot read short codes. Use a .mochipack file instead.");
  const packed = fromBase64Url(body);
  let json: Uint8Array;
  try { json = await transform(packed, new DecompressionStream("deflate-raw"), MOCHIPACK_MAX_BYTES); }
  catch (error) { return error instanceof MochipackError ? bad(error.message) : bad("The code is damaged."); }
  return parseMochipack(new TextDecoder("utf-8", { fatal: false }).decode(json));
}

/** Accepts pasted text: a short code or the pack JSON. */
export async function parseMochipackInput(text: string): Promise<MochiPack> {
  const trimmed = text.trim();
  if (!trimmed) return bad("Nothing to import.");
  return /^mochipack:/i.test(trimmed) ? decodeShortCode(trimmed) : parseMochipack(trimmed);
}
