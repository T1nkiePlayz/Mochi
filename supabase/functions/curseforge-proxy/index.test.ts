import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handle, resetRateLimit } from "./index.ts";

const SECRET = "$2a$10$super-secret-key-value";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://x.test/curseforge-proxy", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function mockFetch(status: number, payload: unknown, calls: Array<{ url: string; key: string | null }> = []): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), key: new Headers(init?.headers).get("x-api-key") });
    return Promise.resolve(new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status }));
  }) as typeof fetch;
}

async function withKey<T>(key: string | undefined, run: () => Promise<T>): Promise<T> {
  const old = Deno.env.get("CURSEFORGE_API_KEY");
  if (key === undefined) Deno.env.delete("CURSEFORGE_API_KEY"); else Deno.env.set("CURSEFORGE_API_KEY", key);
  resetRateLimit();
  try { return await run(); } finally {
    if (old === undefined) Deno.env.delete("CURSEFORGE_API_KEY"); else Deno.env.set("CURSEFORGE_API_KEY", old);
  }
}

Deno.test("OPTIONS returns CORS headers", async () => {
  const res = await handle(new Request("https://x.test", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("access-control-allow-headers")!, "apikey");
});

Deno.test("rejects unknown routes, bad JSON and bad params", async () => {
  await withKey(SECRET, async () => {
    const f = mockFetch(200, { data: [] });
    for (const body of [
      "not json", [], { route: "nope" }, { route: "constructor" }, { route: "mod" }, { route: "mod", modId: "1" },
      { route: "mod", modId: -1 }, { route: "mod", modId: 1.5 }, { route: "search" },
      { route: "search", gameId: 432, pageSize: 51 }, { route: "search", gameId: 432, index: 9990, pageSize: 20 },
      { route: "search", gameId: 432, searchFilter: "a<script>" }, { route: "search", gameId: 432, searchFilter: "x".repeat(101) },
      { route: "search", gameId: 432, gameVersion: "1.20/../x" }, { route: "search", gameId: 432, sortField: 13 },
      { route: "search", gameId: 432, sortOrder: "up" }, { route: "search", gameId: 432, modLoaderType: 4 },
      { route: "files", modId: 1, modLoaderType: 7 }, { route: "download-url", modId: 1 },
    ]) {
      const res = await handle(post(body), f);
      assertEquals(res.status, 400, JSON.stringify(body));
      assertEquals((await res.json()).code, "bad_request");
    }
  });
});

Deno.test("valid search is forwarded with the key header only upstream", async () => {
  await withKey(SECRET, async () => {
    const calls: Array<{ url: string; key: string | null }> = [];
    const res = await handle(
      post({ route: "search", gameId: 432, classId: 6, searchFilter: "jei", gameVersion: "1.20.1", modLoaderType: 1, sortField: 2, sortOrder: "desc" }),
      mockFetch(200, { data: [{ id: 1 }], pagination: { totalCount: 1 } }, calls),
    );
    const text = await res.text();
    assertEquals(res.status, 200);
    assertEquals(JSON.parse(text).data[0].id, 1);
    assertEquals(calls[0].key, SECRET);
    assertEquals(text.includes(SECRET), false);
    assertStringIncludes(calls[0].url, "https://api.curseforge.com/v1/mods/search?");
    assertStringIncludes(calls[0].url, "modLoaderType=1");
    assertStringIncludes(calls[0].url, "pageSize=20");
  });
});

Deno.test("missing secret gives 503 not_configured", async () => {
  await withKey(undefined, async () => {
    const res = await handle(post({ route: "games" }), mockFetch(200, {}));
    assertEquals(res.status, 503);
    assertEquals((await res.json()).code, "not_configured");
  });
});

Deno.test("upstream errors are mapped and never leak the key", async () => {
  await withKey(SECRET, async () => {
    const cases: Array<[number, number, string]> = [[429, 429, "rate_limited"], [500, 502, "upstream"], [403, 502, "upstream"], [404, 502, "upstream"]];
    for (const [upstream, status, code] of cases) {
      const res = await handle(post({ route: "mod", modId: 5 }), mockFetch(upstream, `error ${SECRET}`));
      const text = await res.text();
      assertEquals(res.status, status);
      assertEquals(JSON.parse(text).code, code);
      assertEquals(text.includes(SECRET), false);
    }
    const down = await handle(post({ route: "mod", modId: 5 }), (() => Promise.reject(new TypeError("boom"))) as typeof fetch);
    assertEquals(down.status, 502);
  });
});

Deno.test("download-url shapes restricted and available results", async () => {
  await withKey(SECRET, async () => {
    const ok = await handle(post({ route: "download-url", modId: 1, fileId: 2 }), mockFetch(200, { data: "https://edge.forgecdn.net/files/1/2/a.jar" }));
    assertEquals(await ok.json(), { data: "https://edge.forgecdn.net/files/1/2/a.jar", restricted: false });
    const forbidden = await handle(post({ route: "download-url", modId: 1, fileId: 2 }), mockFetch(403, "no"));
    assertEquals(forbidden.status, 200);
    assertEquals(await forbidden.json(), { data: null, restricted: true });
    const empty = await handle(post({ route: "download-url", modId: 1, fileId: 2 }), mockFetch(200, { data: "" }));
    assertEquals(await empty.json(), { data: null, restricted: true });
    const insecure = await handle(post({ route: "download-url", modId: 1, fileId: 2 }), mockFetch(200, { data: "http://evil/x.jar" }));
    assertEquals(await insecure.json(), { data: null, restricted: true });
  });
});

Deno.test("per-IP rate limit", async () => {
  await withKey(SECRET, async () => {
    const f = mockFetch(200, { data: [] });
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await handle(post({ route: "games" }, { "x-forwarded-for": "1.2.3.4" }), f)).status;
    assertEquals(last, 429);
    assertEquals((await handle(post({ route: "games" }, { "x-forwarded-for": "5.6.7.8" }), f)).status, 200);
  });
});
