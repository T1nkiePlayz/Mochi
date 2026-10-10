import { describe, expect, it } from "vitest";
import {
  CODE_PREFIX, MOCHIPACK_MAX_ITEMS, MochipackError, buildMochipack, decodeShortCode, encodeShortCode, fromBase64Url, isSafeFileName, parseMochipack, parseMochipackInput,
  serializeMochipack, shortCodeSupported, toBase64Url, validatePack, type ExportFile,
} from "./mochipack";

const sha = (n: number) => n.toString(16).padStart(40, "0");
const game = { name: "Minecraft", minecraft: true, cfGameId: 432 };
const files: ExportFile[] = [
  { folder: "mods", filename: "sodium-0.6.0.jar", enabled: true, sha1: sha(1), record: { source: "modrinth", projectId: "AANobbMI", fileId: "u1Rzq6Id", sha1: sha(1) } },
  { folder: "mods", filename: "lithium.jar.disabled", enabled: false, sha1: sha(2), record: { source: "curseforge", projectId: "360438", fileId: "55", sha1: sha(2) } },
  { folder: "shaderpacks", filename: "bsl.zip", enabled: true, sha1: sha(3), record: { source: "nexus", projectId: "12", fileId: "99" } },
  { folder: "mods", filename: "mystery.jar", enabled: true, sha1: sha(4), record: { source: "manual", projectId: "", fileId: "" } },
  { folder: "mods", filename: "nohash.jar", enabled: true },
];

describe("buildMochipack", () => {
  const { pack, omitted } = buildMochipack({ name: "My pack", game, loader: "fabric", gameVersion: "1.21.1", files });
  it("lists matched files as mods, the rest by hash, and drops files it cannot describe", () => {
    expect(pack.mods.map((mod) => mod.fileName)).toEqual(["lithium.jar", "sodium-0.6.0.jar", "bsl.zip"]);
    expect(pack.unknown).toEqual([{ fileName: "mystery.jar", sha1: sha(4) }]);
    expect(omitted).toBe(1);
  });
  it("keeps the enabled state, strips .disabled and never puts a CurseForge hash in the pack", () => {
    const lithium = pack.mods.find((mod) => mod.provider === "curseforge")!;
    expect(lithium).toMatchObject({ enabled: false, fileName: "lithium.jar", projectId: "360438" });
    expect(lithium.sha1).toBeUndefined();
    expect(pack.mods.find((mod) => mod.provider === "modrinth")!.sha1).toBe(sha(1));
  });
  it("is deterministic regardless of input order", () => {
    const again = buildMochipack({ name: "My pack", game, loader: "fabric", gameVersion: "1.21.1", files: [...files].reverse() });
    expect(serializeMochipack(again.pack)).toBe(serializeMochipack(pack));
  });
  it("sends records with malformed ids to the unknown list", () => {
    const result = buildMochipack({ game, files: [{ folder: "mods", filename: "x.jar", enabled: true, sha1: sha(5), record: { source: "modrinth", projectId: "../x", fileId: "ok" } }] });
    expect(result.pack.mods).toEqual([]);
    expect(result.pack.unknown).toHaveLength(1);
  });
});

describe("serialize / parse round trip", () => {
  it("returns the same pack", () => {
    const { pack } = buildMochipack({ name: "n", game: { ...game, nexusDomain: "skyrim" }, loader: "fabric", gameVersion: "1.21.1", files });
    expect(parseMochipack(serializeMochipack(pack))).toEqual(pack);
    expect(parseMochipack(serializeMochipack(pack, false))).toEqual(pack);
  });
  it("defaults enabled to true and folder to mods, lowercases hashes and ignores unknown keys", () => {
    const pack = parseMochipack(JSON.stringify({ format: "mochipack", version: 1, game: { name: "G", evil: 1 }, evil: 1, mods: [{ provider: "modrinth", projectId: "AANobbMI", fileId: "abc", fileName: "a.jar", sha1: sha(255).toUpperCase(), extra: "x" }] }));
    expect(pack.mods[0]).toEqual({ provider: "modrinth", projectId: "AANobbMI", fileId: "abc", fileName: "a.jar", sha1: sha(255), folder: "mods", enabled: true });
    expect(pack.unknown).toEqual([]);
    expect(JSON.stringify(pack)).not.toContain("evil");
  });
});

const base = () => ({ format: "mochipack", version: 1, game: { name: "G" }, mods: [] as unknown[], unknown: [] as unknown[] });
const mod = (extra: Record<string, unknown> = {}) => ({ provider: "modrinth", projectId: "AANobbMI", fileId: "abc12345", fileName: "a.jar", ...extra });
const reject = (value: unknown) => expect(() => validatePack(value)).toThrow(MochipackError);

describe("validation rejects malicious or broken input", () => {
  it("wrong shape, format or version", () => {
    reject(null); reject([]); reject("x"); reject({ ...base(), format: "other" }); reject({ ...base(), version: 2 }); reject({ ...base(), version: "1" });
    reject({ ...base(), game: undefined }); reject({ ...base(), mods: "nope" }); reject({ ...base(), mods: undefined });
  });
  it("says a newer version needs a newer Mochi", () => {
    expect(() => validatePack({ ...base(), version: 7 })).toThrow(/newer Mochi/);
  });
  it("disallowed providers, folders and bad ids", () => {
    reject({ ...base(), mods: [mod({ provider: "evil.example" })] });
    reject({ ...base(), mods: [mod({ provider: "url", url: "https://evil.example/x.jar" })] });
    reject({ ...base(), mods: [mod({ folder: "../etc" })] });
    reject({ ...base(), mods: [mod({ projectId: "a/b" })] });
    reject({ ...base(), mods: [mod({ projectId: "https://x" })] });
    reject({ ...base(), mods: [mod({ provider: "curseforge", projectId: "12abc", fileId: "1" })] });
    reject({ ...base(), mods: [mod({ provider: "nexus", projectId: "0", fileId: "1" })] });
    reject({ ...base(), mods: [mod({ enabled: "yes" })] });
  });
  it("path-like or control-character file names and bad hashes", () => {
    for (const fileName of ["../evil.jar", "a/b.jar", "a\\b.jar", "..", ".", "a\u0000.jar", "x\n.jar", "", "a".repeat(256)]) reject({ ...base(), mods: [mod({ fileName })] });
    reject({ ...base(), mods: [mod({ sha1: "zz" })] });
    reject({ ...base(), mods: [mod({ sha1: "a".repeat(39) })] });
    reject({ ...base(), unknown: [{ fileName: "a.jar" }] });
    reject({ ...base(), unknown: [{ fileName: "../a.jar", sha1: sha(1) }] });
  });
  it("bad game, loader, version and settings fields", () => {
    reject({ ...base(), game: { name: "" } }); reject({ ...base(), game: { name: "G", nexusDomain: "../x" } }); reject({ ...base(), game: { name: "G", cfGameId: -3 } });
    reject({ ...base(), game: { name: "G", cfGameId: 1.5 } }); reject({ ...base(), game: { name: "G", minecraft: "yes" } });
    reject({ ...base(), loader: "fabric; rm -rf" }); reject({ ...base(), gameVersion: "<script>" });
    reject({ ...base(), settings: { a: { nested: true } } }); reject({ ...base(), settings: [1] }); reject({ ...base(), settings: { "bad key!": 1 } });
  });
  it("caps the number of mods and unknown files at 2000", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => mod({ fileId: String(i + 1000), fileName: `${i}.jar` }));
    expect(validatePack({ ...base(), mods: many(MOCHIPACK_MAX_ITEMS) }).mods).toHaveLength(MOCHIPACK_MAX_ITEMS);
    reject({ ...base(), mods: many(MOCHIPACK_MAX_ITEMS + 1) });
    reject({ ...base(), unknown: Array.from({ length: MOCHIPACK_MAX_ITEMS + 1 }, (_, i) => ({ fileName: `${i}.jar`, sha1: sha(i) })) });
  });
  it("invalid JSON and oversized text", () => {
    expect(() => parseMochipack("{nope")).toThrow(/not valid JSON/);
    expect(() => parseMochipack("x".repeat(2 * 1024 * 1024 + 1))).toThrow(/too large/);
  });
  it("does not let __proto__ pollute settings or the result", () => {
    const text = '{"format":"mochipack","version":1,"game":{"name":"G"},"mods":[],"settings":{"__proto__":1}}';
    expect(() => parseMochipack(text)).toThrow(MochipackError);
    parseMochipack('{"format":"mochipack","version":1,"game":{"name":"G"},"mods":[],"__proto__":{"polluted":true}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("isSafeFileName", () => {
    expect(isSafeFileName("sodium-0.6.0+mc1.21.jar")).toBe(true);
    expect(isSafeFileName("a/b")).toBe(false);
  });
});

describe("short code", () => {
  const { pack } = buildMochipack({ game, loader: "fabric", gameVersion: "1.21.1", files });
  it("is available in the test runtime", () => expect(shortCodeSupported()).toBe(true));
  it("round trips through encode and decode", async () => {
    const code = await encodeShortCode(pack);
    expect(code).toMatch(/^mochipack:[A-Za-z0-9_-]+$/);
    expect(await decodeShortCode(code!)).toEqual(pack);
    expect(await parseMochipackInput(`  ${code}\n`)).toEqual(pack);
    expect(await parseMochipackInput(serializeMochipack(pack))).toEqual(pack);
  });
  it("tolerates whitespace and a wrapped code", async () => {
    const code = (await encodeShortCode(pack))!;
    expect(await decodeShortCode(code.slice(0, 20) + "\n " + code.slice(20))).toEqual(pack);
  });
  it("gives no code when the compressed pack is 4 KB or more", async () => {
    // Random-looking hashes do not compress, so a few hundred unknown files exceed the limit.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed.toString(16).padStart(8, "0"); };
    const unknown = Array.from({ length: 300 }, (_, i) => ({ fileName: `file-${i}.jar`, sha1: (rnd() + rnd() + rnd() + rnd() + rnd()).slice(0, 40) }));
    expect(await encodeShortCode({ ...pack, unknown })).toBeNull();
    expect(await encodeShortCode({ ...pack, unknown: unknown.slice(0, 5) })).not.toBeNull();
  });
  it("rejects garbage, wrong characters and a decompression bomb", async () => {
    await expect(decodeShortCode(CODE_PREFIX)).rejects.toThrow(MochipackError);
    await expect(decodeShortCode("mochipack:!!!")).rejects.toThrow(MochipackError);
    await expect(decodeShortCode("mochipack:AAAA")).rejects.toThrow(MochipackError);
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    void writer.write(new Uint8Array(8 * 1024 * 1024)); void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const bomb = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0; for (const c of chunks) { bomb.set(c, at); at += c.length; }
    await expect(decodeShortCode(CODE_PREFIX + toBase64Url(bomb))).rejects.toThrow(/too large/);
  });
  it("rejects a code that decodes to a non-pack", async () => {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    void writer.write(new TextEncoder().encode('{"format":"zip"}')); void writer.close();
    const out = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    await expect(decodeShortCode(CODE_PREFIX + toBase64Url(out))).rejects.toThrow(/not a Mochi modpack/);
  });
  it("base64url helpers round trip every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });
});
