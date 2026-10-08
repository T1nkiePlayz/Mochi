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
  | { action: "nexus-mods"; gameDomain: string }
  | { action: "igdb-search"; query: string; limit?: number };

type IgdbCredential = { clientId: string; clientSecret: string };

const pool = new Pool(Deno.env.get("SUPABASE_DB_URL")!, 1, true);

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

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")!);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, publishableKeys.default, {
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

  const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId.trim(),
      client_secret: credentials.clientSecret.trim(),
      grant_type: "client_credentials",
    }),
  });
  if (!tokenResponse.ok) {
    console.error("IGDB Twitch token request failed", tokenResponse.status);
    throw new Error("IGDB authentication failed. Check the Client ID and Client Secret.");
  }

  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("IGDB authentication did not return an access token.");
  const escapedQuery = query.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const upstream = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": credentials.clientId.trim(),
      Authorization: `Bearer ${token.access_token}`,
      "Content-Type": "text/plain",
      Accept: "application/json",
    },
    body: `search "${escapedQuery}"; fields name,summary,cover.url,artworks.url,genres.name,first_release_date; limit ${limit};`,
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

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return response({ error: "Invalid JSON body" }, 400);
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
      const upstream = await fetch("https://api.nexusmods.com/v1/games.json", { headers });
      if (!upstream.ok) return response({ error: `Nexus Mods returned HTTP ${upstream.status} while loading games.` }, upstream.status);
      const games = await upstream.json() as Array<Record<string, unknown>>;
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
    try {
      const headers = await nexusHeaders(user.id);
      const upstream = await fetch(`https://api.nexusmods.com/v3/games/${encodeURIComponent(domain)}/trending-mods`, { headers });
      if (!upstream.ok) return response({ error: `Nexus Mods returned HTTP ${upstream.status} while loading mods.` }, upstream.status);
      const payload = await upstream.json() as { data?: { mods?: Array<Record<string, unknown>> } };
      const mods = (payload.data?.mods ?? []).map((mod) => ({
        id: String(mod.mod_id ?? mod.id ?? mod.mod_page_url ?? ""),
        name: String(mod.name ?? "Untitled mod"),
        author: typeof mod.author === "string" ? mod.author : undefined,
        summary: typeof mod.summary === "string" ? mod.summary : undefined,
        pictureUrl: typeof mod.picture_url === "string" ? mod.picture_url : undefined,
        modPageUrl: String(mod.mod_page_url ?? `https://www.nexusmods.com/${domain}/mods/${String(mod.mod_id ?? "")}`),
      }));
      return response({ mods });
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
