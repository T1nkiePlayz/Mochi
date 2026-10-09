// Read-only proxy for the CurseForge REST API. The Mochi API key lives only in the
// CURSEFORGE_API_KEY function secret; it is never returned, logged or stored.
// Per the CurseForge 3rd Party API terms nothing from upstream is cached or persisted.
// Deploy with JWT verification disabled: supabase functions deploy curseforge-proxy --no-verify-jwt

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const API_BASE = "https://api.curseforge.com";
const MAX_BODY_BYTES = 8 * 1024;
const MAX_FINGERPRINTS = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
const RATE_LIMIT = 120; // requests per client IP per minute (best effort: per function instance)

type ErrorCode = "bad_request" | "not_configured" | "rate_limited" | "upstream";
type Params = Record<string, unknown>;
/** `body` makes the upstream call a POST with that JSON body (only the fingerprint lookup needs it). */
type Built = { path: string; query: URLSearchParams; downloadUrl?: boolean; body?: string };

export class ProxyError extends Error {
  constructor(message: string, readonly code: ErrorCode, readonly status: number) { super(message); }
}

const bad = (message: string) => new ProxyError(message, "bad_request", 400);

function intParam(params: Params, name: string, opts: { min: number; max: number; required?: boolean }): number | undefined {
  const value = params[name];
  if (value === undefined || value === null) {
    if (opts.required) throw bad(`"${name}" is required.`);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < opts.min || value > opts.max) {
    throw bad(`"${name}" must be an integer between ${opts.min} and ${opts.max}.`);
  }
  return value;
}

const ID_MAX = 2_147_483_647;
const id = (params: Params, name: string) => intParam(params, name, { min: 1, max: ID_MAX, required: true })!;

function textParam(params: Params, name: string, pattern: RegExp, maxLength: number): string | undefined {
  const value = params[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength || !pattern.test(value)) throw bad(`"${name}" is invalid.`);
  return value.trim() === "" ? undefined : value;
}

// Letters (any script), digits, spaces and a few harmless punctuation marks.
const SEARCH_FILTER = /^[\p{L}\p{N} _.'+&:,!()-]*$/u;
const GAME_VERSION = /^[A-Za-z0-9._+ -]{1,32}$/;

function paging(params: Params, query: URLSearchParams) {
  const index = intParam(params, "index", { min: 0, max: 9_999 }) ?? 0;
  const pageSize = intParam(params, "pageSize", { min: 1, max: 50 }) ?? 20;
  if (index + pageSize > 10_000) throw bad('"index" + "pageSize" must not exceed 10000.');
  query.set("index", String(index));
  query.set("pageSize", String(pageSize));
}

function setInt(query: URLSearchParams, name: string, value: number | undefined) {
  if (value !== undefined) query.set(name, String(value));
}

/** Every allowed route and how its params map to the upstream request. Anything else is rejected. */
const ROUTES: Record<string, (params: Params) => Built> = {
  games: (params) => {
    const query = new URLSearchParams();
    paging(params, query);
    return { path: "/v1/games", query };
  },
  categories: (params) => {
    const query = new URLSearchParams({ gameId: String(id(params, "gameId")) });
    setInt(query, "classId", intParam(params, "classId", { min: 1, max: ID_MAX }));
    if (params.classesOnly !== undefined && params.classesOnly !== null) {
      if (typeof params.classesOnly !== "boolean") throw bad('"classesOnly" must be a boolean.');
      if (params.classesOnly) query.set("classesOnly", "true");
    }
    return { path: "/v1/categories", query };
  },
  search: (params) => {
    const query = new URLSearchParams({ gameId: String(id(params, "gameId")) });
    setInt(query, "classId", intParam(params, "classId", { min: 1, max: ID_MAX }));
    setInt(query, "categoryId", intParam(params, "categoryId", { min: 1, max: ID_MAX }));
    const gameVersion = textParam(params, "gameVersion", GAME_VERSION, 32);
    if (gameVersion) query.set("gameVersion", gameVersion);
    const searchFilter = textParam(params, "searchFilter", SEARCH_FILTER, 100);
    if (searchFilter) query.set("searchFilter", searchFilter);
    setInt(query, "sortField", intParam(params, "sortField", { min: 1, max: 12 }));
    if (params.sortOrder !== undefined && params.sortOrder !== null) {
      if (params.sortOrder !== "asc" && params.sortOrder !== "desc") throw bad('"sortOrder" must be "asc" or "desc".');
      query.set("sortOrder", params.sortOrder);
    }
    const loader = intParam(params, "modLoaderType", { min: 0, max: 6 });
    if (loader !== undefined && loader !== 0) {
      if (!gameVersion) throw bad('"modLoaderType" requires "gameVersion".');
      query.set("modLoaderType", String(loader));
    }
    paging(params, query);
    return { path: "/v1/mods/search", query };
  },
  mod: (params) => ({ path: `/v1/mods/${id(params, "modId")}`, query: new URLSearchParams() }),
  description: (params) => ({ path: `/v1/mods/${id(params, "modId")}/description`, query: new URLSearchParams() }),
  files: (params) => {
    const query = new URLSearchParams();
    const gameVersion = textParam(params, "gameVersion", GAME_VERSION, 32);
    if (gameVersion) query.set("gameVersion", gameVersion);
    const loader = intParam(params, "modLoaderType", { min: 0, max: 6 });
    if (loader !== undefined && loader !== 0) query.set("modLoaderType", String(loader));
    paging(params, query);
    return { path: `/v1/mods/${id(params, "modId")}/files`, query };
  },
  // Identifies installed mod files: the launcher sends CurseForge's MurmurHash2 fingerprint of each file
  // (computed locally with whitespace bytes removed) and gets back the exact matches.
  fingerprints: (params) => {
    const gameId = intParam(params, "gameId", { min: 1, max: ID_MAX });
    const values = params.fingerprints;
    if (!Array.isArray(values) || values.length === 0 || values.length > MAX_FINGERPRINTS) {
      throw bad(`"fingerprints" must be a list of 1 to ${MAX_FINGERPRINTS} numbers.`);
    }
    if (!values.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff)) {
      throw bad('"fingerprints" must contain unsigned 32-bit integers.');
    }
    const unique = [...new Set(values as number[])].sort((a, b) => a - b);
    return {
      path: gameId === undefined ? "/v1/fingerprints" : `/v1/fingerprints/${gameId}`,
      query: new URLSearchParams(),
      body: JSON.stringify({ fingerprints: unique }),
    };
  },
  "download-url": (params) => ({
    path: `/v1/mods/${id(params, "modId")}/files/${id(params, "fileId")}/download-url`,
    query: new URLSearchParams(),
    downloadUrl: true,
  }),
};

const rateWindow = new Map<string, { start: number; count: number }>();

export function rateLimited(ip: string, now = Date.now()): boolean {
  const entry = rateWindow.get(ip);
  if (!entry || now - entry.start > 60_000) {
    rateWindow.set(ip, { start: now, count: 1 });
    if (rateWindow.size > 10_000) for (const [key, value] of rateWindow) if (now - value.start > 60_000) rateWindow.delete(key);
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

export function resetRateLimit() { rateWindow.clear(); }

function clientIp(req: Request): string {
  // Supabase Edge Functions run behind Cloudflare, which supplies this edge-derived header.
  // Never trust x-forwarded-for: callers can provide it themselves and rotate spoofed identities.
  const edgeIp = req.headers.get("cf-connecting-ip")?.trim() ?? "";
  // Missing trusted metadata shares one bucket rather than trusting caller-controlled input.
  return edgeIp && /^[0-9a-fA-F:.]+$/.test(edgeIp) ? edgeIp : "unknown";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(error: ProxyError) {
  return json({ error: error.message, code: error.code }, error.status);
}

/** Reads at most MAX_RESPONSE_BYTES so a misbehaving upstream cannot exhaust memory. */
async function readCapped(upstream: Response): Promise<string> {
  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new ProxyError("CurseForge returned an unexpectedly large response.", "upstream", 502);
  const reader = upstream.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProxyError("CurseForge returned an unexpectedly large response.", "upstream", 502);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(merged);
}

// Identical concurrent requests share one upstream call; nothing is kept once it settles.
const inFlight = new Map<string, Promise<{ status: number; text: string }>>();

async function callUpstream(built: Built, apiKey: string, fetcher: typeof fetch): Promise<{ status: number; text: string }> {
  const url = `${API_BASE}${built.path}${built.query.size ? `?${built.query}` : ""}`;
  const flightKey = built.body === undefined ? url : `${url}\n${built.body}`;
  const pending = inFlight.get(flightKey) ?? (async () => {
    try {
      const upstream = await fetcher(url, {
        method: built.body === undefined ? "GET" : "POST",
        body: built.body,
        headers: {
          Accept: "application/json",
          "x-api-key": apiKey,
          ...(built.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        redirect: "error",
      });
      return { status: upstream.status, text: await readCapped(upstream) };
    } catch (error) {
      if (error instanceof ProxyError) throw error;
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new ProxyError(timedOut ? "CurseForge took too long to respond." : "Unable to reach CurseForge.", "upstream", 502);
    }
  })();
  inFlight.set(flightKey, pending);
  try {
    return await pending;
  } finally {
    if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey);
  }
}

export async function handle(req: Request, fetcher: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required", code: "bad_request" }, 405);

  if (rateLimited(clientIp(req))) return fail(new ProxyError("Too many requests. Try again in a minute.", "rate_limited", 429));

  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw bad("Request body is too large.");
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw bad("Invalid JSON body."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Request body must be a JSON object.");
    const params = body as Params;
    const route = typeof params.route === "string" && Object.hasOwn(ROUTES, params.route) ? params.route : null;
    if (!route) throw bad("Unknown route.");
    const built = ROUTES[route](params);

    const apiKey = Deno.env.get("CURSEFORGE_API_KEY");
    if (!apiKey) throw new ProxyError("CurseForge is not configured on this Mochi server yet.", "not_configured", 503);

    const upstream = await callUpstream(built, apiKey, fetcher);
    if (built.downloadUrl) {
      // 403/404 or an empty body means the author disabled third-party downloads for this file.
      if (upstream.status === 403 || upstream.status === 404) return json({ data: null, restricted: true });
      if (upstream.status < 200 || upstream.status >= 300) throw upstreamError(upstream.status);
      let data: unknown = null;
      try { data = (JSON.parse(upstream.text) as { data?: unknown }).data; } catch { /* treated as restricted */ }
      const url = typeof data === "string" && data.startsWith("https://") ? data : null;
      return json({ data: url, restricted: url === null });
    }
    if (upstream.status < 200 || upstream.status >= 300) throw upstreamError(upstream.status);
    try { JSON.parse(upstream.text); } catch { throw new ProxyError("CurseForge returned invalid data.", "upstream", 502); }
    return new Response(upstream.text, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    if (error instanceof ProxyError) return fail(error);
    console.error("curseforge-proxy failed", error instanceof Error ? error.name : "unknown");
    return fail(new ProxyError("CurseForge request failed.", "upstream", 502));
  }
}

function upstreamError(status: number): ProxyError {
  if (status === 429) return new ProxyError("CurseForge is rate limiting Mochi right now. Try again shortly.", "rate_limited", 429);
  if (status === 404) return new ProxyError("CurseForge could not find that item.", "upstream", 502);
  // 401/403 means our key was rejected; never say more than that to clients.
  if (status === 401 || status === 403) return new ProxyError("CurseForge rejected the Mochi server's API key.", "upstream", 502);
  return new ProxyError(`CurseForge request failed (HTTP ${status}).`, "upstream", 502);
}

