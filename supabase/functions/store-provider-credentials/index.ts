import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Pool } from "jsr:@db/postgres@^0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Provider = "igdb" | "nexus" | "steamgriddb";
type SgdbKind = "grids" | "heroes" | "logos" | "icons";
type Body =
  | { action: "set"; provider: Provider; secret: string }
  | { action: "status"; provider?: Provider }
  | { action: "delete"; provider: Provider }
  | { action: "nexus-games"; query?: string }
  | { action: "nexus-mods"; gameDomain: string; sort?: "catalog" | "trending"; offset?: number; limit?: number }
  | { action: "nexus-status" }
  | { action: "nexus-mod"; gameDomain: string; modId: number }
  | { action: "nexus-files"; gameDomain: string; modId: number }
  | { action: "nexus-download"; gameDomain: string; modId: number; fileId: number; key?: string; expires?: number | string }
  | { action: "nexus-md5"; gameDomain: string; md5: string }
  | { action: "igdb-search"; query: string; limit?: number }
  | { action: "igdb-company"; slug?: string; name?: string }
  | { action: "sgdb-search"; query: string }
  | {
    action: "sgdb-assets"; gameId?: number; steamAppId?: number; kinds?: SgdbKind[]; dimensions?: string[]; styles?: string[];
    limit?: number; page?: number;
  };

type IgdbCredential = { clientId: string; clientSecret: string };

const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);
const ACTIONS = new Set(["set", "status", "delete", "nexus-games", "nexus-mods", "nexus-status", "nexus-mod", "nexus-files", "nexus-download", "nexus-md5", "igdb-search", "igdb-company", "sgdb-search", "sgdb-assets"]);
const SGDB_API = "https://www.steamgriddb.com/api/v2";
const SGDB_KINDS = new Set<SgdbKind>(["grids", "heroes", "logos", "icons"]);
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 60; // requests per user per minute (best effort: per function instance)
const rateWindow = new Map<string, { start: number; count: number }>();
const igdbTokens = new Map<string, { token: string; expiresAt: number }>();
let nexusGamesCache: { fetchedAt: number; games: Array<Record<string, unknown>> } | null = null;
const NEXUS_GAMES_TTL_MS = 60 * 60 * 1000;

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateWindow.get(userId);
  if (!entry || now - entry.start > 60_000) {
    rateWindow.set(userId, { start: now, count: 1 });
    if (rateWindow.size > 5000) for (const [key, value] of rateWindow) if (now - value.start > 60_000) rateWindow.delete(key);
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

/** Upstream failures are reported as 502 (or 429) so the launcher always receives a readable message. */
function upstreamStatus(status: number): number {
  return status === 429 ? 429 : 502;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validProvider(value: unknown): value is Provider {
  return value === "igdb" || value === "nexus" || value === "steamgriddb";
}

function validNexusApiKey(value: string): boolean {
  return value.length >= 32 && value.length <= 4096 && /^[!-~]+$/.test(value);
}

function validSteamGridDbKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,256}$/.test(value);
}

async function sgdbFetch(apiKey: string, path: string): Promise<Record<string, unknown>> {
  const upstream = await fetch(`${SGDB_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (upstream.status === 401 || upstream.status === 403) throw new SgdbError("SteamGridDB rejected the saved API key. Save a new key in Settings.", 422);
  if (upstream.status === 404) return { data: [] }; // unknown game: no assets, not an error
  if (!upstream.ok) throw new SgdbError(`SteamGridDB request failed (${upstream.status}).`, upstreamStatus(upstream.status));
  return await upstream.json() as Record<string, unknown>;
}

class SgdbError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function sgdbKey(userId: string): Promise<string> {
  const key = await getStoredSecret(userId, "steamgriddb");
  if (!key) throw new SgdbError("SteamGridDB API key is not configured for this Mochi account.", 400);
  return key;
}

const safeToken = (value: unknown) => typeof value === "string" && /^[a-z0-9_]{1,24}$/.test(value);
const safeDimension = (value: unknown) => typeof value === "string" && /^\d{2,4}x\d{2,4}$/.test(value);
const isHttps = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith("steamgriddb.com"); } catch { return false; }
};

let cachedPublishableKey: string | null = null;
function publishableKey(): string {
  if (!cachedPublishableKey) cachedPublishableKey = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")!).default as string;
  return cachedPublishableKey;
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const client = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  return error || !user ? null : user;
}

async function getStoredSecret(userId: string, provider: Provider): Promise<string | null> {
  const connection = await pool.connect();
  try {
    const rows = await connection.queryObject<{ decrypted_secret: string }>(
      "select decrypted_secret from vault.decrypted_secrets where id = (select secret_id from mochi_private.user_credentials where user_id = $1 and provider = $2)",
      [userId, provider],
    );
    return rows.rows[0]?.decrypted_secret ?? null;
  } finally {
    connection.release();
  }
}

/** Twitch app tokens last weeks; reuse them instead of requesting one per search. */
async function igdbAccessToken(credentials: IgdbCredential): Promise<string> {
  const clientId = credentials.clientId.trim();
  // Key on a hash of the secret so a token is never shared with someone who only knows the client id.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${clientId}:${credentials.clientSecret.trim()}`));
  const cacheKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const cached = igdbTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: credentials.clientSecret.trim(), grant_type: "client_credentials" }),
  });
  if (!tokenResponse.ok) {
    console.error("IGDB Twitch token request failed", tokenResponse.status);
    throw new Error("IGDB authentication failed. Check the Client ID and Client Secret.");
  }
  const token = await tokenResponse.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("IGDB authentication did not return an access token.");
  igdbTokens.set(cacheKey, { token: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
  return token.access_token;
}

async function igdbCredentials(userId: string): Promise<IgdbCredential> {
  const raw = await getStoredSecret(userId, "igdb");
  if (!raw) throw new Error("IGDB credentials are not configured for this Mochi account.");

  let credentials: IgdbCredential;
  try {
    credentials = JSON.parse(raw) as IgdbCredential;
  } catch {
    throw new Error("The stored IGDB credentials use an invalid format. Please save them again.");
  }
  if (!credentials.clientId?.trim() || !credentials.clientSecret?.trim()) {
    throw new Error("Both the IGDB Client ID and Client Secret are required.");
  }
  return credentials;
}

/** Escapes a value for use inside an IGDB Apicalypse string literal. */
const igdbString = (value: string) => value.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');

async function igdbPost(userId: string, endpoint: "games" | "companies", query: string): Promise<unknown> {
  const credentials = await igdbCredentials(userId);
  const accessToken = await igdbAccessToken(credentials);
  const upstream = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": credentials.clientId.trim(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body: query,
    signal: AbortSignal.timeout(15_000),
  });
  if (!upstream.ok) {
    console.error("IGDB request failed", upstream.status);
    throw new Error(`IGDB metadata request failed (${upstream.status}).`);
  }
  return await upstream.json();
}

function searchIgdb(userId: string, query: string, limit: number) {
  return igdbPost(
    userId,
    "games",
    `search "${igdbString(query)}"; fields name,summary,cover.url,artworks.url,screenshots.url,videos.name,videos.video_id,genres.name,themes.name,game_modes.name,player_perspectives.name,first_release_date,slug,url,platforms.name,total_rating,total_rating_count,websites.url,involved_companies.developer,involved_companies.company.name,similar_games.name,similar_games.cover.url; limit ${limit};`,
  );
}

const IGDB_SLUG = /^[a-z0-9-]{1,64}$/;
const IGDB_IMAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Looks up a company profile (igdb.com/companies/<slug>) for launcher logos.
 * Tries the exact slug first, then an exact case-insensitive name match. Only the logo is returned: no trailers.
 */
async function igdbCompany(userId: string, slug: string | undefined, name: string | undefined) {
  const fields = "fields name,slug,url,logo.image_id,logo.width,logo.height;";
  const attempts: string[] = [];
  if (slug) attempts.push(`${fields} where slug = "${igdbString(slug)}"; limit 1;`);
  if (name) attempts.push(`${fields} where name ~ "${igdbString(name)}" & logo != null; limit 1;`);
  for (const query of attempts) {
    const rows = await igdbPost(userId, "companies", query);
    const company = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
    if (!company || typeof company.name !== "string") continue;
    const logo = company.logo as { image_id?: unknown; width?: unknown; height?: unknown } | undefined;
    const imageId = typeof logo?.image_id === "string" && IGDB_IMAGE_ID.test(logo.image_id) ? logo.image_id : undefined;
    return {
      name: company.name,
      slug: typeof company.slug === "string" ? company.slug : undefined,
      url: typeof company.url === "string" && company.url.startsWith("https://www.igdb.com/") ? company.url : undefined,
      logoUrl: imageId ? `https://images.igdb.com/igdb/image/upload/t_logo_med/${imageId}.png` : undefined,
      logoUrlLarge: imageId ? `https://images.igdb.com/igdb/image/upload/t_original/${imageId}.png` : undefined,
      width: typeof logo?.width === "number" ? logo.width : undefined,
      height: typeof logo?.height === "number" ? logo.height : undefined,
    };
  }
  return null;
}

async function nexusHeaders(userId: string) {
  const apiKey = await getStoredSecret(userId, "nexus");
  if (!apiKey) throw new Error("Nexus Mods API key is not configured.");
  return {
    Accept: "application/json",
    apikey: apiKey,
    "Application-Name": "Mochi",
    "Application-Version": "0.1.0",
  };
}

const NEXUS_V1 = "https://api.nexusmods.com/v1";
const NEXUS_GRAPHQL = "https://api.nexusmods.com/v2/graphql";
/** The public GraphQL API serves at most this many nodes per request. */
const NEXUS_GRAPHQL_MAX = 80;
const NEXUS_PUBLIC_HEADERS = { Accept: "application/json", "Content-Type": "application/json", "Application-Name": "Mochi", "Application-Version": "0.1.0" };
const NEXUS_DOMAIN = /^[a-z0-9_-]{1,64}$/;
const NEXUS_DL_KEY = /^[A-Za-z0-9_-]{8,256}$/;
const nexusId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
const nexusPictureUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith("nexusmods.com") ? value : undefined; } catch { return undefined; }
};

class NexusError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

/** GET against Nexus v1 with the user's own key. Errors are mapped to readable messages and never include the key. */
async function nexusV1(userId: string, path: string): Promise<unknown> {
  const headers = await nexusHeaders(userId);
  let upstream: Response;
  try {
    upstream = await fetch(`${NEXUS_V1}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new NexusError("Unable to reach Nexus Mods. Try again.", 502);
  }
  if (upstream.status === 401) throw new NexusError("Nexus Mods rejected the saved API key. Save a new key in Settings.", 422);
  if (upstream.status === 403) throw new NexusError("Nexus Mods denied this request.", 403, "forbidden");
  if (upstream.status === 404) throw new NexusError("Nexus Mods could not find that item.", 404, "not_found");
  if (upstream.status === 429) throw new NexusError("Nexus Mods is rate limiting requests. Try again later.", 429);
  if (!upstream.ok) throw new NexusError(`Nexus Mods request failed (HTTP ${upstream.status}).`, upstreamStatus(upstream.status));
  try { return await upstream.json(); } catch { throw new NexusError("Nexus Mods returned invalid data.", 502); }
}

/** Public Nexus catalog data (games, mod lists) needs no key; sending none also avoids Nexus rejecting a stale one. */
async function nexusGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let upstream: Response;
  try {
    upstream = await fetch(NEXUS_GRAPHQL, { method: "POST", headers: NEXUS_PUBLIC_HEADERS, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new NexusError("Unable to reach Nexus Mods. Try again.", 502);
  }
  if (upstream.status === 429) throw new NexusError("Nexus Mods is rate limiting requests. Try again later.", 429);
  if (!upstream.ok) throw new NexusError(`Nexus Mods request failed (HTTP ${upstream.status}).`, upstreamStatus(upstream.status));
  let payload: { data?: T; errors?: Array<{ message?: string }> };
  try { payload = await upstream.json(); } catch { throw new NexusError("Nexus Mods returned invalid data.", 502); }
  if (!payload.data) throw new NexusError(payload.errors?.map((item) => item.message).filter(Boolean).join("; ") || "Nexus Mods returned invalid data.", 502);
  return payload.data;
}

function nexusFailure(error: unknown, fallback: string) {
  if (error instanceof NexusError) return response({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  // nexusHeaders throws a plain Error when no key is stored.
  if (error instanceof Error && error.message === "Nexus Mods API key is not configured.") return response({ error: error.message, code: "not_configured" }, 400);
  console.error(fallback, error instanceof Error ? error.message : "unknown");
  return response({ error: fallback }, 502);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "POST required" }, 405);

  const user = await authenticate(req);
  if (!user) return response({ error: "Authentication required" }, 401);

  if (rateLimited(user.id)) return response({ error: "Too many requests. Try again in a minute." }, 429);

  let body: Body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return response({ error: "Request body is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return response({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object" || !ACTIONS.has((body as { action?: string }).action ?? "")) {
    return response({ error: "Unknown action" }, 400);
  }

  if (body.action === "igdb-search") {
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 200) {
      return response({ error: "IGDB search query is invalid." }, 400);
    }
    const limit = Math.max(1, Math.min(Number(body.limit) || 6, 10));
    try {
      return response({ games: await searchIgdb(user.id, body.query, limit) });
    } catch (error) {
      console.error("IGDB search failed", error);
      return response({ error: error instanceof Error ? error.message : "IGDB search failed." }, 502);
    }
  }

  if (body.action === "igdb-company") {
    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : undefined;
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    if ((slug !== undefined && !IGDB_SLUG.test(slug)) || (name !== undefined && (!name || name.length > 100))) {
      return response({ error: "IGDB company lookup is invalid." }, 400);
    }
    if (!slug && !name) return response({ error: "Provide a company slug or name." }, 400);
    try {
      return response({ company: await igdbCompany(user.id, slug, name) });
    } catch (error) {
      console.error("IGDB company lookup failed", error instanceof Error ? error.message : "unknown");
      return response({ error: error instanceof Error ? error.message : "IGDB company lookup failed." }, 502);
    }
  }

  if (body.action === "sgdb-search") {
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 200) {
      return response({ error: "SteamGridDB search query is invalid." }, 400);
    }
    try {
      const key = await sgdbKey(user.id);
      // Path segment, so encode everything that could change the route.
      const payload = await sgdbFetch(key, `/search/autocomplete/${encodeURIComponent(body.query.trim())}`);
      const games = (Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : []).slice(0, 10)
        .filter((game) => typeof game.id === "number" && typeof game.name === "string")
        .map((game) => ({
          id: game.id as number, name: game.name as string, verified: game.verified === true,
          release_date: typeof game.release_date === "number" ? game.release_date : undefined,
        }));
      return response({ games });
    } catch (error) {
      console.error("SteamGridDB search failed", error instanceof Error ? error.message : error);
      if (error instanceof SgdbError) return response({ error: error.message }, error.status);
      return response({ error: "SteamGridDB search failed." }, 502);
    }
  }

  if (body.action === "sgdb-assets") {
    const gameId = body.gameId === undefined ? undefined : Number(body.gameId);
    const steamAppId = body.steamAppId === undefined ? undefined : Number(body.steamAppId);
    if ((gameId === undefined) === (steamAppId === undefined)) return response({ error: "Provide either gameId or steamAppId." }, 400);
    const id = (gameId ?? steamAppId) as number;
    if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return response({ error: "Invalid game id." }, 400);
    const kinds = body.kinds === undefined ? ["grids" as SgdbKind] : body.kinds;
    if (!Array.isArray(kinds) || !kinds.length || kinds.length > 4 || !kinds.every((kind) => SGDB_KINDS.has(kind))) {
      return response({ error: "Invalid asset kind." }, 400);
    }
    const dimensions = body.dimensions ?? [];
    const styles = body.styles ?? [];
    if (!Array.isArray(dimensions) || dimensions.length > 6 || !dimensions.every(safeDimension)) return response({ error: "Invalid dimensions filter." }, 400);
    if (!Array.isArray(styles) || styles.length > 6 || !styles.every(safeToken)) return response({ error: "Invalid style filter." }, 400);
    const limit = Math.max(1, Math.min(Math.floor(Number(body.limit) || 12), 50));
    const page = Math.max(0, Math.min(Math.floor(Number(body.page) || 0), 100));
    try {
      const key = await sgdbKey(user.id);
      const items: Array<Record<string, unknown>> = [];
      for (const kind of new Set(kinds)) {
        const params = new URLSearchParams({ nsfw: "false", epilepsy: "false", page: String(page) });
        // Dimensions only apply to grids, heroes and icons; logos have no fixed sizes.
        if (dimensions.length && kind !== "logos") params.set("dimensions", dimensions.join(","));
        if (styles.length) params.set("styles", styles.join(","));
        const route = steamAppId !== undefined ? `/${kind}/steam/${id}` : `/${kind}/game/${id}`;
        const payload = await sgdbFetch(key, `${route}?${params}`);
        for (const item of (Array.isArray(payload.data) ? payload.data as Array<Record<string, unknown>> : []).slice(0, limit)) {
          if (typeof item.id !== "number" || !isHttps(item.url)) continue;
          const author = item.author as { name?: unknown } | undefined;
          items.push({
            id: item.id, kind, url: item.url, thumb: isHttps(item.thumb) ? item.thumb : item.url,
            width: typeof item.width === "number" ? item.width : 0, height: typeof item.height === "number" ? item.height : 0,
            style: typeof item.style === "string" ? item.style : undefined,
            author: typeof author?.name === "string" ? author.name : undefined,
          });
        }
      }
      return response({ items });
    } catch (error) {
      console.error("SteamGridDB asset request failed", error instanceof Error ? error.message : error);
      if (error instanceof SgdbError) return response({ error: error.message }, error.status);
      return response({ error: "SteamGridDB asset request failed." }, 502);
    }
  }

  if (body.action === "nexus-games") {
    try {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      const key = await getStoredSecret(user.id, "nexus");
      let upstreamGames: Array<Record<string, unknown>> | null = null;
      if (key) {
        // The full v1 list is only available with a key; if Nexus refuses it, fall back to the public catalog below.
        if (!nexusGamesCache || Date.now() - nexusGamesCache.fetchedAt > NEXUS_GAMES_TTL_MS) {
          const upstream = await fetch("https://api.nexusmods.com/v1/games.json", { headers: await nexusHeaders(user.id), signal: AbortSignal.timeout(15_000) }).catch(() => null);
          if (upstream?.ok) nexusGamesCache = { fetchedAt: Date.now(), games: await upstream.json() as Array<Record<string, unknown>> };
        }
        upstreamGames = nexusGamesCache?.games ?? null;
      }
      if (upstreamGames) {
        const needle = query.toLowerCase();
        const filtered = upstreamGames
          .filter((game) => typeof game.name === "string" && typeof game.domain_name === "string")
          .filter((game) => !needle || String(game.name).toLowerCase().includes(needle) || String(game.domain_name).toLowerCase().includes(needle))
          .map((game) => ({
            id: String(game.id ?? ""),
            name: String(game.name),
            domainName: String(game.domain_name),
            iconUrl: game.id != null ? `https://staticdelivery.nexusmods.com/images/games/cover_${String(game.id)}.jpg` : undefined,
            modCount: typeof game.mods === "number" ? game.mods : undefined,
            genre: typeof game.genre === "string" ? game.genre : undefined,
          }))
          .filter((game) => game.id && game.name && game.domainName);
        return response({ games: filtered });
      }
      const data = await nexusGraphql<{ games?: { nodes?: Array<Record<string, unknown>> } }>(
        "query($count: Int!, $filter: GamesSearchFilter) { games(filter: $filter, count: $count, sort: [{ downloads: { direction: DESC } }]) { nodes { id name domainName modCount genre } } }",
        { count: NEXUS_GRAPHQL_MAX, filter: query ? { name: { value: query, op: "WILDCARD" } } : undefined },
      );
      const games = (data.games?.nodes ?? [])
        .filter((game) => typeof game.name === "string" && typeof game.domainName === "string" && game.id != null)
        .map((game) => ({
          id: String(game.id),
          name: String(game.name),
          domainName: String(game.domainName),
          iconUrl: `https://staticdelivery.nexusmods.com/images/games/cover_${String(game.id)}.jpg`,
          modCount: typeof game.modCount === "number" ? game.modCount : undefined,
          genre: typeof game.genre === "string" ? game.genre : undefined,
        }));
      return response({ games });
    } catch (error) {
      return nexusFailure(error, "Unable to search Nexus Mods games.");
    }
  }

  if (body.action === "nexus-status") {
    try {
      const key = await getStoredSecret(user.id, "nexus");
      if (!key) return response({ configured: false, premium: false });
      const info = await nexusV1(user.id, "/users/validate.json") as { is_premium?: unknown; name?: unknown };
      return response({ configured: true, premium: info.is_premium === true, ...(typeof info.name === "string" ? { name: info.name } : {}) });
    } catch (error) {
      return nexusFailure(error, "Unable to check Nexus Mods account status.");
    }
  }

  if (body.action === "nexus-md5") {
    if (typeof body.gameDomain !== "string" || !NEXUS_DOMAIN.test(body.gameDomain)) return response({ error: "Invalid Nexus game." }, 400);
    if (typeof body.md5 !== "string" || !/^[a-f0-9]{32}$/i.test(body.md5)) return response({ error: "Invalid MD5 hash." }, 400);
    try {
      const payload = await nexusV1(user.id, `/games/${body.gameDomain}/mods/md5_search/${body.md5.toLowerCase()}.json`);
      const text = (value: unknown) => typeof value === "string" ? value : undefined;
      const matches = (Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []).flatMap((entry) => {
        const mod = entry.mod as Record<string, unknown> | undefined;
        const file = entry.file_details as Record<string, unknown> | undefined;
        if (!mod || !file || !nexusId(mod.mod_id) || !nexusId(file.file_id)) return [];
        return [{
          modId: mod.mod_id, fileId: file.file_id, name: text(mod.name) ?? "Untitled mod", author: text(mod.author),
          pictureUrl: nexusPictureUrl(mod.picture_url), modVersion: text(mod.version), fileName: text(file.file_name),
          fileVersion: text(file.version), uploadedAt: typeof file.uploaded_timestamp === "number" ? file.uploaded_timestamp : undefined,
          modPageUrl: `https://www.nexusmods.com/${body.gameDomain}/mods/${mod.mod_id}`,
        }];
      });
      return response({ matches });
    } catch (error) {
      // Nexus answers 404 when no file has this hash: that is an empty result, not a failure.
      if (error instanceof NexusError && error.status === 404) return response({ matches: [] });
      return nexusFailure(error, "Unable to look up this file on Nexus Mods.");
    }
  }

  if (body.action === "nexus-mod" || body.action === "nexus-files" || body.action === "nexus-download") {
    if (typeof body.gameDomain !== "string" || !NEXUS_DOMAIN.test(body.gameDomain)) return response({ error: "Invalid Nexus game." }, 400);
    if (!nexusId(body.modId)) return response({ error: "Invalid Nexus mod id." }, 400);
    const base = `/games/${body.gameDomain}/mods/${body.modId}`;

    if (body.action === "nexus-mod") {
      try {
        const mod = await nexusV1(user.id, `${base}.json`) as Record<string, unknown>;
        const text = (value: unknown) => typeof value === "string" ? value : undefined;
        return response({
          id: body.modId, name: text(mod.name) ?? "Untitled mod", summary: text(mod.summary) ?? "", description: text(mod.description),
          author: text(mod.author) ?? text(mod.uploaded_by) ?? "", pictureUrl: nexusPictureUrl(mod.picture_url), version: text(mod.version),
          endorsements: typeof mod.endorsement_count === "number" ? mod.endorsement_count : undefined,
          modPageUrl: `https://www.nexusmods.com/${body.gameDomain}/mods/${body.modId}`,
        });
      } catch (error) {
        return nexusFailure(error, "Unable to load this Nexus mod.");
      }
    }

    if (body.action === "nexus-files") {
      try {
        const payload = await nexusV1(user.id, `${base}/files.json`) as { files?: Array<Record<string, unknown>> };
        const hidden = new Set(["ARCHIVED", "REMOVED", "DELETED"]);
        const files = (Array.isArray(payload.files) ? payload.files : [])
          .filter((file) => nexusId(file.file_id) && typeof file.file_name === "string" && !hidden.has(String(file.category_name ?? "").toUpperCase()))
          .map((file) => ({
            fileId: file.file_id as number,
            name: typeof file.name === "string" ? file.name : String(file.file_name),
            fileName: String(file.file_name),
            version: typeof file.version === "string" ? file.version : "",
            category: String(file.category_name ?? "").toLowerCase(),
            sizeKb: typeof file.size_kb === "number" ? file.size_kb : 0,
            uploadedAt: typeof file.uploaded_timestamp === "number" ? file.uploaded_timestamp : 0,
            primary: file.is_primary === true,
          }));
        return response({ files });
      } catch (error) {
        return nexusFailure(error, "Unable to load Nexus mod files.");
      }
    }

    if (!nexusId(body.fileId)) return response({ error: "Invalid Nexus file id." }, 400);
    const hasKey = body.key !== undefined && body.key !== null;
    const hasExpires = body.expires !== undefined && body.expires !== null;
    if (hasKey !== hasExpires) return response({ error: "Provide both key and expires from the Nexus download link." }, 400);
    const params = new URLSearchParams();
    if (hasKey) {
      const expires = Number(body.expires);
      if (typeof body.key !== "string" || !NEXUS_DL_KEY.test(body.key) || !Number.isInteger(expires) || expires <= 0 || expires > 99_999_999_999) {
        return response({ error: "The Nexus download link parameters are invalid." }, 400);
      }
      params.set("key", body.key);
      params.set("expires", String(expires));
    }
    try {
      const linksPayload = await nexusV1(user.id, `${base}/files/${body.fileId}/download_link.json${params.size ? `?${params}` : ""}`);
      const links = Array.isArray(linksPayload) ? linksPayload as Array<Record<string, unknown>> : [];
      const uri = links.map((link) => link.URI).find((value): value is string => typeof value === "string" && value.startsWith("https://"));
      if (!uri) return response({ error: "Nexus Mods did not return a download link.", code: "no_link" }, 502);
      const files = await nexusV1(user.id, `${base}/files/${body.fileId}.json`).catch(() => null) as { file_name?: unknown } | null;
      return response({ url: uri, fileName: typeof files?.file_name === "string" ? files.file_name : decodeURIComponent(new URL(uri).pathname.split("/").pop() ?? "") });
    } catch (error) {
      if (error instanceof NexusError && error.status === 403) {
        return response({ error: "Nexus Mods only allows premium members to download from outside the website. Use the Download with Mod Manager button on the mod page.", code: "premium_required" }, 403);
      }
      return nexusFailure(error, "Unable to get a Nexus download link.");
    }
  }

  if (body.action === "nexus-mods") {
    if (typeof body.gameDomain !== "string") return response({ error: "Invalid Nexus game." }, 400);
    const domain = body.gameDomain.trim().replace(/[^a-z0-9_-]/gi, "");
    if (!domain) return response({ error: "Invalid Nexus game." }, 400);
    const sort = body.sort === "trending" ? "trending" : "catalog";
    const offset = Math.max(0, Math.min(100_000, Math.floor(Number(body.offset) || 0)));
    const limit = Math.max(8, Math.min(100, Math.floor(Number(body.limit) || 100)));
    try {
      if (sort === "trending") {
        const headers = await nexusHeaders(user.id);
        const upstream = await fetch(`https://api.nexusmods.com/v3/games/${encodeURIComponent(domain)}/trending-mods`, { headers });
        if (!upstream.ok) return response({ error: `Nexus Mods returned HTTP ${upstream.status} while loading trending mods.` }, upstreamStatus(upstream.status));
        const payload = await upstream.json() as { data?: { mods?: Array<Record<string, unknown>> } };
        const mods = (payload.data?.mods ?? []).map((mod) => ({
          id: String(mod.mod_id ?? mod.id ?? mod.mod_page_url ?? ""),
          modId: Number.isInteger(Number(mod.mod_id ?? mod.id)) ? Number(mod.mod_id ?? mod.id) : undefined,
          name: String(mod.name ?? "Untitled mod"),
          author: typeof mod.author === "string" ? mod.author : undefined,
          summary: typeof mod.summary === "string" ? mod.summary : undefined,
          pictureUrl: typeof mod.picture_url === "string" ? mod.picture_url : undefined,
          modPageUrl: String(mod.mod_page_url ?? `https://www.nexusmods.com/${domain}/mods/${String(mod.mod_id ?? "")}`),
        }));
        return response({ mods, total: mods.length, offset: 0 });
      }

      // Nexus V3 currently has no paginated all-mods or downloads-ranked endpoint, so the catalog uses the public V2
      // GraphQL API: no key (a key is never sent), most downloaded first, same paging as before.
      const data = await nexusGraphql<{ mods?: { totalCount?: number; nodes?: Array<{ modId?: number | string; name?: string; summary?: string; thumbnailUrl?: string; pictureUrl?: string; author?: string }> } }>(
        "query($domain: String!, $count: Int!, $offset: Int!) { mods(filter: { gameDomainName: { value: $domain, op: EQUALS } }, sort: [{ downloads: { direction: DESC } }], count: $count, offset: $offset) { totalCount nodes { modId name summary thumbnailUrl pictureUrl author } } }",
        { domain, count: Math.min(limit, NEXUS_GRAPHQL_MAX), offset },
      );
      const result = data.mods;
      const mods = (result?.nodes ?? []).map((mod) => {
        const id = String(mod.modId ?? "");
        return {
          id, modId: Number(id) || undefined, name: String(mod.name ?? "Untitled mod"),
          author: typeof mod.author === "string" ? mod.author : undefined,
          summary: typeof mod.summary === "string" ? mod.summary : undefined,
          pictureUrl: nexusPictureUrl(mod.thumbnailUrl) ?? nexusPictureUrl(mod.pictureUrl),
          modPageUrl: `https://www.nexusmods.com/${encodeURIComponent(domain)}/mods/${encodeURIComponent(id)}`,
        };
      }).filter((mod) => mod.id);
      return response({ mods, total: Number(result?.totalCount ?? mods.length), offset });
    } catch (error) {
      return nexusFailure(error, "Unable to load Nexus Mods.");
    }
  }

  if (body.action === "status" && !body.provider) {
    const connection = await pool.connect();
    try {
      const rows = await connection.queryObject<{ provider: Provider }>(
        "select provider from mochi_private.user_credentials where user_id = $1 order by provider",
        [user.id],
      );
      return response({ providers: rows.rows.map((row) => row.provider) });
    } finally {
      connection.release();
    }
  }

  if ((body.action === "set" || body.action === "delete" || body.action === "status") && !validProvider(body.provider)) {
    return response({ error: "Unsupported provider" }, 400);
  }
  if (body.action === "set" && (typeof body.secret !== "string" || body.secret.trim().length < 8 || body.secret.length > 4096)) {
    return response({ error: "Credential is invalid or outside the supported length." }, 400);
  }
  if (body.action === "set" && body.provider === "nexus" && !validNexusApiKey(body.secret.trim())) {
    return response({ error: "Nexus Mods Personal API keys must be at least 32 characters with no spaces or line breaks." }, 400);
  }

  if (body.action === "set" && body.provider === "steamgriddb" && !validSteamGridDbKey(body.secret.trim())) {
    return response({ error: "SteamGridDB API keys only contain letters, numbers, dashes and underscores (16 to 256 characters)." }, 400);
  }

  const connection = await pool.connect();
  try {
    const existing = await connection.queryObject<{ secret_id: string }>(
      "select secret_id from mochi_private.user_credentials where user_id = $1 and provider = $2",
      [user.id, body.provider],
    );

    if (body.action === "status") {
      return response({ provider: body.provider, configured: existing.rows.length > 0 });
    }

    if (body.action === "set") {
      const secret = body.secret.trim();
      if (body.provider === "nexus") {
        let validation: Response;
        try {
          validation = await fetch("https://api.nexusmods.com/v1/users/validate.json", {
            headers: {
              Accept: "application/json",
              apikey: secret,
              "Application-Name": "Mochi",
              "Application-Version": "0.1.0",
            },
          });
        } catch {
          return response({ error: "Unable to reach Nexus Mods to validate this API key. Try again." }, 502);
        }
        if (!validation.ok) {
          if (validation.status === 401 || validation.status === 403) {
            return response({ error: "Nexus Mods rejected this API key. Check that you copied the full Personal API Key." }, 422);
          }
          return response({ error: `Nexus Mods could not validate this API key (HTTP ${validation.status}). Try again.` }, 502);
        }
      }

      if (body.provider === "steamgriddb") {
        let validation: Response;
        try {
          validation = await fetch(`${SGDB_API}/search/autocomplete/test`, {
            headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          return response({ error: "Unable to reach SteamGridDB to validate this API key. Try again." }, 502);
        }
        if (!validation.ok) {
          if (validation.status === 401 || validation.status === 403) {
            return response({ error: "SteamGridDB rejected this API key. Copy it again from your SteamGridDB preferences page." }, 422);
          }
          return response({ error: `SteamGridDB could not validate this API key (HTTP ${validation.status}). Try again.` }, 502);
        }
      }

      if (existing.rows[0]?.secret_id) {
        await connection.queryObject(
          "select vault.update_secret($1::uuid, $2, $3, $4)",
          [existing.rows[0].secret_id, secret, `mochi_${body.provider}_${user.id}`, `Mochi ${body.provider} credential`],
        );
      } else {
        const created = await connection.queryObject<{ create_secret: string }>(
          "select vault.create_secret($1, $2, $3)",
          [secret, `mochi_${body.provider}_${user.id}`, `Mochi ${body.provider} credential`],
        );
        await connection.queryObject(
          "insert into mochi_private.user_credentials (user_id, provider, secret_id) values ($1, $2, $3)",
          [user.id, body.provider, created.rows[0].create_secret],
        );
      }
      await connection.queryObject(
        "update mochi_private.user_credentials set updated_at = now() where user_id = $1 and provider = $2",
        [user.id, body.provider],
      );
      return response({ provider: body.provider, configured: true });
    }

    if (body.action === "delete") {
      const secretId = existing.rows[0]?.secret_id;
      if (secretId) {
        await connection.queryObject("delete from vault.secrets where id = $1::uuid", [secretId]);
        await connection.queryObject(
          "delete from mochi_private.user_credentials where user_id = $1 and provider = $2",
          [user.id, body.provider],
        );
      }
      return response({ provider: body.provider, configured: false });
    }

    return response({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("Credential operation failed", error);
    return response({ error: "Credential operation failed." }, 500);
  } finally {
    connection.release();
  }
});
