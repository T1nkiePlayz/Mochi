# CurseForge and Nexus Mods integration (backend)

## Architecture

```
Mochi app --supabase.functions.invoke--> curseforge-proxy (Edge Function, no login)
                                              |  x-api-key: $CURSEFORGE_API_KEY (secret, server only)
                                              v
                                        api.curseforge.com

Mochi app (signed in) --> store-provider-credentials (nexus-status | nexus-mod | nexus-files | nexus-download)
                                              |  the user's own Nexus key from Supabase Vault
                                              v
                                        api.nexusmods.com/v1

Mochi app --Tauri command start_mod_download--> Rust downloader --> provider CDN (allow-listed hosts)
```

- `supabase/functions/curseforge-proxy` accepts `POST { route, ...params }` with an allow-list of read-only routes
  (`games`, `categories`, `search`, `mod`, `description`, `files`, `download-url`). Every parameter is validated
  (integers and ranges, `pageSize <= 50`, `index + pageSize <= 10000`, restricted charset for `searchFilter` and
  `gameVersion`). Errors are `{ error, code }` with `code` one of `bad_request` (400), `not_configured` (503),
  `rate_limited` (429), `upstream` (502). `download-url` returns `{ data, restricted }`.
- The Nexus actions use the same auth, validation and rate limiting as the other `store-provider-credentials`
  actions. A free Nexus account can only get a download link when the `key` and `expires` from an `nxm://` link
  are supplied; otherwise the function answers 403 `premium_required`.
- `src-tauri/src/downloads.rs` verifies the provider host allow-list (including redirects), size cap (250 MiB),
  SHA-1 (when supplied), file names, and extracts zips safely (no path traversal, entry count/size/ratio caps).

## Terms-driven constraints

From the CurseForge 3rd Party API terms and REST docs:

- The API key is non-transferable and must not be disclosed: it is never in the app, the repository or any response.
  It only exists as the `CURSEFORGE_API_KEY` function secret.
- API data must not be saved or cached: the proxy keeps nothing (it only de-duplicates identical in-flight
  requests), and the app must hold CurseForge responses in memory only. The Modrinth disk cache is not used for CurseForge.
  The per-Tofu install record (`mods.json`) keeps only what identifies a file the user installed (project id, file id, file name, version, title, SHA-1, file date), never icons or descriptions; update-check results are in memory only.
- Authors can disable third-party distribution (`allowModDistribution === false`, or a null `downloadUrl`). Mochi never
  builds forgecdn URLs by hand; in that case it links to the mod's CurseForge page instead.
- Show "Powered by CurseForge" and a link back to each mod.

## Owner setup (exact steps)

The key must never be committed. Put it only in Supabase secrets.

1. Add the secret (either way):
   - Dashboard: Project > Edge Functions > Secrets > Add new secret, name `CURSEFORGE_API_KEY`, value = your key.
   - CLI: `supabase secrets set CURSEFORGE_API_KEY=... --project-ref <ref>`
2. Deploy (no `config.toml` is committed, so pass the flag):
   ```
   supabase functions deploy curseforge-proxy --no-verify-jwt --project-ref <ref>
   supabase functions deploy store-provider-credentials --project-ref <ref>
   ```
   `curseforge-proxy` must be deployed with JWT verification disabled because users are not required to sign in.
   `store-provider-credentials` keeps its normal JWT handling and must be redeployed for the Nexus actions.
3. Test with the publishable key (safe to expose):
   ```
   curl -s https://<ref>.supabase.co/functions/v1/curseforge-proxy \
     -H "apikey: <publishable key>" -H "Authorization: Bearer <publishable key>" \
     -H "Content-Type: application/json" \
     -d '{"route":"search","gameId":432,"classId":6,"searchFilter":"jei","pageSize":5}'
   ```
   Expect `{ "data": [...], "pagination": {...} }`. A 503 `not_configured` means the secret is missing
   (secrets are read at invocation; redeploy if you added it after deploying and it is still missing).
4. Key rotation: create a new key in the CurseForge console, run `supabase secrets set CURSEFORGE_API_KEY=<new>`,
   then revoke the old key. No app update is needed because the app never holds the key.
5. Abuse hardening options: the built-in limit is 120 requests per IP per minute per function instance (best effort).
   For more, put Cloudflare or another WAF in front, lower `RATE_LIMIT` in `index.ts`, add a durable counter in
   Postgres, or require a signed-in user by redeploying without `--no-verify-jwt` (the client already sends the
   publishable key; verifying a user JWT would need the app to send the user session token).
6. Never commit the key, paste it into issues, or log it. The function never logs or echoes it.

## Tests

`cd supabase/functions/curseforge-proxy && deno test --allow-env index.test.ts` (no network; fetch is mocked).
Rust: `cd src-tauri && cargo test downloads`.
