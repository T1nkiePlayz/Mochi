import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Pool } from "jsr:@db/postgres@^0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Provider = "igdb" | "nexus";
type Body =
  | { action: "set"; provider: Provider; secret: string }
  | { action: "status"; provider?: Provider }
  | { action: "delete"; provider: Provider }
  | { action: "nexus-games"; query?: string }
  | { action: "nexus-mods"; gameDomain: string; sort?: "catalog" | "trending"; offset?: number; limit?: number }
  | { action: "igdb-search"; query: string; limit?: number };

type IgdbCredential = { clientId: string; clientSecret: string };

const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);
const ACTIONS = new Set(["set", "status", "delete", "nexus-games", "nexus-mods", "igdb-search"]);
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
  return value === "igdb" || value === "nexus";
}

function validNexusApiKey(value: string): boolean {
  return value.length >= 32 && value.length <= 4096 && /^[!-~]+$/.test(value);
}

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
