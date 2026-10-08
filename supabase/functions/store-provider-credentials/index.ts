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
  | { action: "igdb-search"; query: string; limit?: number }
  | { action: "sgdb-search"; query: string }
  | {
    action: "sgdb-assets"; gameId?: number; steamAppId?: number; kinds?: SgdbKind[]; dimensions?: string[]; styles?: string[];
    limit?: number; page?: number;
  };

type IgdbCredential = { clientId: string; clientSecret: string };

const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);
const ACTIONS = new Set(["set", "status", "delete", "nexus-games", "nexus-mods", "igdb-search", "sgdb-search", "sgdb-assets"]);
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

async function searchIgdb(userId: string, query: string, limit: number) {
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

  const accessToken = await igdbAccessToken(credentials);
  const escapedQuery = query.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const upstream = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": credentials.clientId.trim(),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
  body: `search "${escapedQuery}"; fields name,summary,cover.url,artworks.url,screenshots.url,videos.name,videos.video_id,genres.name,themes.name,game_modes.name,player_perspectives.name,first_release_date; limit ${limit};`,
  });
  if (!upstream.ok) {
    console.error("IGDB request failed", upstream.status);
    throw new Error(`IGDB metadata request failed (${upstream.status}).`);
  }
  return await upstream.json();
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
      const headers = await nexusHeaders(user.id);
      if (!nexusGamesCache || Date.now() - nexusGamesCache.fetchedAt > NEXUS_GAMES_TTL_MS) {
        const upstream = await fetch("https://api.nexusmods.com/v1/games.json", { headers });
        if (!upstream.ok) return response({ error: `Nexus Mods returned HTTP ${upstream.status} while loading games.` }, upstreamStatus(upstream.status));
        nexusGamesCache = { fetchedAt: Date.now(), games: await upstream.json() as Array<Record<string, unknown>> };
      }
      const games = nexusGamesCache.games;
      const query = typeof body.query === "string" ? body.query.trim().toLowerCase() : "";
      const filtered = games
        .filter((game) => typeof game.name === "string" && typeof game.domain_name === "string")
        .filter((game) => !query || String(game.name).toLowerCase().includes(query) || String(game.domain_name).toLowerCase().includes(query))
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
    } catch (error) {
      console.error("Nexus game search failed", error);
      return response({ error: error instanceof Error ? error.message : "Unable to search Nexus Mods games." }, 502);
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
      const headers = await nexusHeaders(user.id);
      if (sort === "trending") {
        const upstream = await fetch(`https://api.nexusmods.com/v3/games/${encodeURIComponent(domain)}/trending-mods`, { headers });
        if (!upstream.ok) return response({ error: `Nexus Mods returned HTTP ${upstream.status} while loading trending mods.` }, upstreamStatus(upstream.status));
        const payload = await upstream.json() as { data?: { mods?: Array<Record<string, unknown>> } };
        const mods = (payload.data?.mods ?? []).map((mod) => ({
          id: String(mod.mod_id ?? mod.id ?? mod.mod_page_url ?? ""),
          name: String(mod.name ?? "Untitled mod"),
          author: typeof mod.author === "string" ? mod.author : undefined,
          summary: typeof mod.summary === "string" ? mod.summary : undefined,
          pictureUrl: typeof mod.picture_url === "string" ? mod.picture_url : undefined,
          modPageUrl: String(mod.mod_page_url ?? `https://www.nexusmods.com/${domain}/mods/${String(mod.mod_id ?? "")}`),
        }));
        return response({ mods, total: mods.length, offset: 0 });
      }

      // Nexus V3 currently has no paginated all-mods or downloads-ranked endpoint.
      // Use the same paginated V2 GraphQL query used by Nexus's own Vortex client.
      const upstream = await fetch("https://api.nexusmods.com/v2/graphql", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", APIKEY: headers.apikey },
        body: JSON.stringify({
          query: "query($domain: String!, $count: Int!, $offset: Int!) { mods(filter: { filter: [{ gameDomainName: { value: $domain, op: EQUALS } }] }, count: $count, offset: $offset) { totalCount nodes { modId name } } }",
          variables: { domain, count: limit, offset },
        }),
      });
      if (!upstream.ok) return response({ error: `Nexus Mods returned HTTP ${upstream.status} while loading the game catalog.` }, upstreamStatus(upstream.status));
      const payload = await upstream.json() as { data?: { mods?: { totalCount?: number; nodes?: Array<{ modId?: number | string; name?: string }> } }; errors?: Array<{ message?: string }> };
      if (payload.errors?.length) return response({ error: payload.errors.map((item) => item.message).filter(Boolean).join("; ") || "Nexus Mods could not load this game catalog." }, 502);
      const result = payload.data?.mods;
      const mods = (result?.nodes ?? []).map((mod) => {
        const id = String(mod.modId ?? "");
        return { id, name: String(mod.name ?? "Untitled mod"), modPageUrl: `https://www.nexusmods.com/${encodeURIComponent(domain)}/mods/${encodeURIComponent(id)}` };
      }).filter((mod) => mod.id);
      return response({ mods, total: Number(result?.totalCount ?? mods.length), offset });
    } catch (error) {
      console.error("Nexus mod search failed", error);
      return response({ error: error instanceof Error ? error.message : "Unable to load Nexus Mods." }, 502);
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
