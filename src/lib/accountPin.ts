import { readJson, writeJson } from "./storage";
import { askPin } from "./pinPrompt";

/**
 * Optional PINs that protect switching to a saved account on a shared computer. They live only on this device
 * (never synced) as a salted PBKDF2 hash. A PIN stops a family member clicking into your account; it is not
 * encryption, and your Mochi sign-in still protects the account itself.
 */
const KEY = "mochi:account-pins";
const ITERATIONS = 150_000;
export const PIN_PATTERN = /^\d{4,8}$/;
export const MAX_PIN_TRIES = 5;

type Entry = { salt: string; hash: string };
const toHex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function derive(pin: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256));
}

function read(): Map<string, Entry> {
  const raw = readJson<unknown>(KEY, {});
  const map = new Map<string, Entry>();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const entry = value as Partial<Entry> | null;
      if (entry && typeof entry.salt === "string" && typeof entry.hash === "string") map.set(id, { salt: entry.salt, hash: entry.hash });
    }
  }
  return map;
}
function write(map: Map<string, Entry>) { writeJson(KEY, Object.fromEntries(map)); }

export const hasPin = (accountId: string) => read().has(accountId);

export async function setPin(accountId: string, pin: string): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw new Error("A PIN is 4 to 8 digits.");
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const map = read();
  map.set(accountId, { salt, hash: await derive(pin, salt) });
  write(map);
}

export function removePin(accountId: string) { const map = read(); if (map.delete(accountId)) write(map); }

export async function verifyPin(accountId: string, pin: string): Promise<boolean> {
  const entry = read().get(accountId);
  if (!entry) return true;
  const candidate = await derive(pin, entry.salt);
  // Both are fixed-length hex strings; compare without stopping at the first difference.
  let diff = candidate.length ^ entry.hash.length;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ (entry.hash.charCodeAt(i) || 0);
  return diff === 0;
}

/** Asks for the account's PIN (a few tries) before switching to it. True when there is no PIN, or it was entered correctly. */
export async function checkAccountPin(accountId: string, name: string): Promise<boolean> {
  if (!hasPin(accountId)) return true;
  let error: string | undefined;
  for (let attempt = 0; attempt < MAX_PIN_TRIES; attempt++) {
    const pin = await askPin({ title: "Enter PIN", message: `${name} is protected with a PIN.`, error });
    if (pin === null) return false;
    if (await verifyPin(accountId, pin)) return true;
    error = `Wrong PIN (${MAX_PIN_TRIES - attempt - 1} ${MAX_PIN_TRIES - attempt - 1 === 1 ? "try" : "tries"} left).`;
  }
  return false;
}
