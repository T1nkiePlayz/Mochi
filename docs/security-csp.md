# Content Security Policy

The webview runs under the policy in `src-tauri/tauri.conf.json` (`app.security.csp`). A CSP tells the
webview which sources it may load code, images, connections and frames from, so an injected script or a
hostile image URL cannot phone home or run. `devCsp` is the same policy loosened for the Vite dev server
(inline preamble script, `localhost:5173`, HMR websocket). Release builds use `csp` only.

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Anything not listed below may only come from the app itself. |
| `script-src` | `'self'` | Only bundled JavaScript runs. No inline scripts, no `eval`, no remote scripts. (Dev adds `'unsafe-inline'` for Vite's React refresh preamble.) |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | `'unsafe-inline'` is required: React writes inline styles for dynamic layout and the theme engine injects a `<style>` element at runtime (`src/lib/theme.ts`). Google Fonts stylesheets are allowed because themes may declare fonts (`theme.json` `fonts`, validated to `https://fonts.googleapis.com/` in `themes.rs`). |
| `font-src` | `'self' data: https://fonts.gstatic.com` | Bundled fonts, inlined fonts, and the files Google Fonts stylesheets point at. |
| `img-src` | `'self' data: blob:` plus hosts below | Artwork and avatars. |
| `media-src` | `'self' data: blob:` | Local media only. |
| `connect-src` | `'self' ipc: http://ipc.localhost https://*.supabase.co wss://*.supabase.co https://api.modrinth.com https://api.github.com` | Tauri IPC; Supabase (auth, REST, realtime); Modrinth API called from `src/lib/modrinth.ts`; GitHub releases API used by the update fallback. The updater itself downloads from Rust, not the webview. |
| `frame-src` | `https://www.youtube-nocookie.com` | Game trailers in `GameDetails.tsx`. |
| `object-src` | `'none'` | No plugins/embeds. |
| `base-uri` | `'self'` | Stops injected `<base>` tags rewriting relative URLs. |
| `form-action` | `'self'` | Forms cannot post to other sites. |

Image hosts: `images.igdb.com` (IGDB), `cdn2.steamgriddb.com` and `*.steamgriddb.com`, `*.steamstatic.com`
(Steam CDN), `cdn.modrinth.com`, `staticdelivery.nexusmods.com`, `lh3.googleusercontent.com` and
`avatars.githubusercontent.com` (OAuth avatars), `*.supabase.co` (storage), `www.gravatar.com`,
`cdn.simpleicons.org` and `raw.githubusercontent.com` (source icons in first-launch setup).

Artwork reaches the webview as `data:` URLs (`game_artwork.rs` caches IGDB images and returns base64) or
as the remote image URL before it is cached, so no asset-protocol scope is needed
(`app.security.assetProtocol` stays disabled and `asset:` is not in `img-src`).

`dangerousDisableAssetCspModification: ["style-src"]` stops Tauri from appending a nonce to `style-src`;
a nonce would make browsers ignore `'unsafe-inline'` and break the runtime-injected theme `<style>`.
`script-src` is still handled by Tauri (it adds hashes for the bundled inline scripts).

Not allowed on purpose: user themes that reference arbitrary remote images in CSS (`url(https://...)`);
bundle images with the theme or add the host below.

## Adding a host

1. Find which directive the request falls under (image -> `img-src`, `fetch`/websocket -> `connect-src`,
   iframe -> `frame-src`).
2. Add the host to that directive in both `csp` and `devCsp` in `src-tauri/tauri.conf.json`
   (prefer exact hosts over wildcards).
3. Run the smoke test below. A blocked request shows in the webview console as
   `Refused to load ... because it violates the following Content Security Policy directive`.

## Smoke test (real Tauri window)

`npm run tauri dev` (uses `devCsp`) and then `npm run tauri build` and run the binary (uses `csp`).
Open the webview devtools (right-click > Inspect, or `--features devtools` in release) and verify no CSP
violations while: starting up; Settings > Appearance (switch themes, one using Google Fonts); signing in
(Supabase) and a cloud sync; adding a game with IGDB matching (cover, screenshots, YouTube trailer
iframe); Discover (Modrinth icons and search); first-launch setup icons; Settings > Updates > Check now.
