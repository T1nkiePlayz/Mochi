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
  | { action: "delete"; provider: Provider };

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