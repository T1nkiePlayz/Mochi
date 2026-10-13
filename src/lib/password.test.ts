import { afterEach, describe, expect, it, vi } from "vitest";
import { passwordIsBreached } from "./password";

// Stand-in for SHA-1(password): 40 hex characters. The implementation only ever
// sends the first five to the range endpoint; the suffix must stay on the machine.
const HASH = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";
const PREFIX = HASH.slice(0, 5);
const SUFFIX = HASH.slice(5);
const digestOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
const stubDigest = (hex: string) => {
  const digest = vi.fn(async (_algorithm: AlgorithmIdentifier, _data: BufferSource) => digestOf(hex).buffer);
  vi.stubGlobal("crypto", { subtle: { digest } });
  return digest;
};
// The real API answers CRLF-separated "SUFFIX:COUNT" lines; Add-Padding pads the
// counts of rare hashes with leading zeroes.
const corpus = (...lines: string[]) => new Response(lines.map((line) => `${line}:00000000AD2`).join("\r\n") + "\r\n");

afterEach(() => vi.unstubAllGlobals());

describe("passwordIsBreached", () => {
  it("reports a corpus match but sends only the first five hash characters", async () => {
    const digest = stubDigest(HASH);
    const fetchMock = vi.fn(async () => corpus("00000000000000000000000000000000000", SUFFIX, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await passwordIsBreached("hunter2")).toBe(true);
    expect(digest.mock.calls[0]?.[0]).toBe("SHA-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(url).not.toContain(SUFFIX); // the full hash must never leave the machine
    expect(url).not.toContain(HASH);
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe("true");
  });

  it("returns false when the corpus does not contain the hash suffix", async () => {
    stubDigest(HASH);
    vi.stubGlobal("fetch", vi.fn(async () => corpus("00000000000000000000000000000000000", "ABCDEF0123456789ABCDEF0123456789ABCDE", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF")));
    expect(await passwordIsBreached("a-unique-enough-passphrase")).toBe(false);
  });

  it("returns null when the range endpoint answers with a non-OK status", async () => {
    stubDigest(HASH);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await passwordIsBreached("hunter2")).toBeNull();
  });

  it("returns null when the request throws, as it does offline", async () => {
    stubDigest(HASH);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await passwordIsBreached("hunter2")).toBeNull();
  });

  it("matches through CRLF line endings and padded zero counts", async () => {
    stubDigest(HASH);
    const body = `11111111111111111111111111111111111:00000000AD2\r\n${SUFFIX}:00000000AD2\r\n22222222222222222222222222222222222:00000000AD2\r\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    expect(await passwordIsBreached("hunter2")).toBe(true);
  });

  it("compares an uppercase digest even when the hash encodes as lowercase hex", async () => {
    stubDigest(HASH.toLowerCase());
    const fetchMock = vi.fn(async () => corpus("00000000000000000000000000000000000", SUFFIX));
    vi.stubGlobal("fetch", fetchMock);
    expect(await passwordIsBreached("hunter2")).toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
  });
});
