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
  | { action: "clear" }
  | { action: "nexus-games"; query?: string }
  | { action: "nexus-mods"; gameDomain: string };

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "POST required" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return response({ error: "Authentication required" }, 401);

  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")!);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, publishableKeys["default"], {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return response({ error: "Authentication required" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return response({ error: "Invalid JSON body" }, 400);
  }

  if ((body.action === "set" || body.action === "delete") && !validProvider(body.provider)) {
    return response({ error: "Unsupported provider" }, 400);
  }
  if (body.action === "set" && (typeof body.secret !== "string" || body.secret.trim().length < 8 || body.secret.length > 4096)) {
    return response({ error: "Credential is invalid or outside the supported length." }, 400);
  }

  const connection = await pool.connect();
  try {
    if (body.action === "clear") {
      await connection.queryObject("begin");
      try {
        await connection.queryObject(
          "delete from vault.secrets where id in (select secret_id from mochi_private.user_credentials where user_id = $1)",
          [user.id],
        );
        await connection.queryObject("delete from mochi_private.user_credentials where user_id = $1", [user.id]);
        await connection.queryObject("delete from public.pikos where user_id = $1", [user.id]);
        await connection.queryObject("delete from public.profiles where id = $1", [user.id]);
        await connection.queryObject("commit");
      } catch (error) {
        await connection.queryObject("rollback");
        throw error;
      }
      return response({ cleared: true });
    }

    if (body.action === "nexus-games" || body.action === "nexus-mods") {
      const secretRows = await connection.queryObject<{ decrypted_secret: string }>(
        "select decrypted_secret from vault.decrypted_secrets where id = (select secret_id from mochi_private.user_credentials where user_id = $1 and provider = 'nexus')",
        [user.id],
      );
      const apiKey = secretRows.rows[0]?.decrypted_secret;
      if (!apiKey) return response({ error: "Nexus Mods API key is not configured." }, 403);

      const headers = {
        Accept: "application/json",
        apikey: apiKey,
        "Application-Name": "Mochi",
        "Application-Version": "0.1.0",
      };

      if (body.action === "nexus-games") {
        const upstream = await fetch("https://api.nexusmods.com/v1/games.json", { headers });
        if (!upstream.ok) return response({ error: "Nexus Mods returned HTTP " + upstream.status + " while loading games." }, upstream.status);
        const games = await upstream.json() as Array<Record<string, unknown>>;
        const query = body.query?.trim().toLowerCase() ?? "";
        const filtered = games
          .filter((game) => typeof game.name === "string" && typeof game.domain_name === "string")
          .filter((game) => !query || String(game.name).toLowerCase().includes(query) || String(game.domain_name).toLowerCase().includes(query))
          .map((game) => ({
            id: String(game.id ?? ""),
            name: String(game.name),
            domainName: String(game.domain_name),
            iconUrl: typeof game.id === "number" || /^\d+$/.test(String(game.id ?? ""))
              ? "https://staticdelivery.nexusmods.com/images/games/cover_" + String(game.id) + ".jpg"
              : undefined,
            modCount: typeof game.mods === "number" ? game.mods : undefined,
          }))
          .filter((game) => game.id && game.name && game.domainName);
        return response({ games: filtered });
      }

      const domain = body.gameDomain.trim().replace(/[^a-z0-9_-]/gi, "");
      if (!domain) return response({ error: "Invalid Nexus game." }, 400);
      const upstream = await fetch("https://api.nexusmods.com/v3/games/" + encodeURIComponent(domain) + "/trending-mods", { headers });
      if (!upstream.ok) return response({ error: "Nexus Mods returned HTTP " + upstream.status + " while loading mods." }, upstream.status);
      const payload = await upstream.json() as { data?: { mods?: Array<Record<string, unknown>> } };
      const mods = (payload.data?.mods ?? []).map((mod) => ({
        id: String(mod.mod_id ?? mod.id ?? mod.mod_page_url ?? ""),
        name: String(mod.name ?? "Untitled mod"),
        author: typeof mod.author === "string" ? mod.author : undefined,
        summary: typeof mod.summary === "string" ? mod.summary : undefined,
        pictureUrl: typeof mod.picture_url === "string" ? mod.picture_url : undefined,
        modPageUrl: String(mod.mod_page_url ?? ("https://www.nexusmods.com/" + domain + "/mods/" + String(mod.mod_id ?? ""))),
      }));
      return response({ mods });
    }
    if (body.action === "status" && !body.provider) {
      const rows = await connection.queryObject<{ provider: Provider }>(
        "select provider from mochi_private.user_credentials where user_id = $1 order by provider",
        [user.id],
      );
      return response({ providers: rows.rows.map((row) => row.provider) });
    }

    const existing = await connection.queryObject<{ secret_id: string }>(
      "select secret_id from mochi_private.user_credentials where user_id = $1 and provider = $2",
      [user.id, body.provider],
    );

    if (body.action === "status") {
      return response({ provider: body.provider, configured: existing.rows.length > 0 });
    }

    if (body.action === "set") {
      if (body.provider === "nexus") {
        const apiKey = body.secret.trim();
        if (!validNexusApiKey(apiKey)) {
          return response({ error: "Nexus Mods Personal API keys must be at least 32 characters with no spaces or line breaks." }, 400);
        }
        let validation: Response;
        try {
          validation = await fetch("https://api.nexusmods.com/v1/users/validate.json", {
            headers: {
              Accept: "application/json",
              apikey: apiKey,
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
          return response({ error: "Nexus Mods could not validate this API key (HTTP " + validation.status + "). Try again." }, 502);
        }
      }

      if (existing.rows[0]?.secret_id) {
        await connection.queryObject(
          "select vault.update_secret($1::uuid, $2, $3, $4)",
          [existing.rows[0].secret_id, body.secret.trim(), "mochi_" + body.provider + "_" + user.id, "Mochi " + body.provider + " credential"],
        );
      } else {
        const created = await connection.queryObject<{ create_secret: string }>(
          "select vault.create_secret($1, $2, $3)",
          [body.secret.trim(), "mochi_" + body.provider + "_" + user.id, "Mochi " + body.provider + " credential"],
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
    console.error("credential operation failed", error);
    return response({ error: "Credential operation failed." }, 500);
  } finally {
    connection.release();
  }
});
