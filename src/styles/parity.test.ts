// Parity guard for the base cascade layer.
//
// src/index.css (legacy) and src/styles/{components,bridge}.css share the same
// `base` cascade layer, so a selector defined in more than one of them resolves
// purely by source order (components.css wins) — the bug class that hid the
// game-card hover-lift fix in PRs #165/#168. These tests freeze the *current*
// duplication into allowlists so it can be migrated away commit by commit, and
// fails the moment a new cross-file duplicate appears.
//
// Parse rules with a depth counter (these sheets are simple enough that we do
// not need to respect braces inside strings/url()). Comments are stripped.
// Rules inside grouping at-rules (@media/@supports/@container/@layer/@scope)
// are keyed with the at-rule prelude as prefix, so a top-level `.sidebar` never
// collides with `@media (…) .sidebar`; @keyframes/@font-face bodies are
// skipped entirely. Grouped selectors are split on top-level commas only.
//
// Files are read from disk: vitest stubs `.css` module imports (even `?raw`
// yields ""), so the usual `?raw` idiom cannot be used here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
const indexCss = read("../index.css");
const bridgeCss = read("./bridge.css");
const componentsCss = read("./components.css");
const layoutCss = read("./layout.css");

function ruleCounts(css: string): Map<string, number> {
  const counts = new Map<string, number>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const frames: Array<{ prefix: string; skip: boolean; record?: string }> = [{ prefix: "", skip: false }];
  let preludeStart = 0;
  const add = (selector: string) => counts.set(selector, (counts.get(selector) ?? 0) + 1);
  for (let i = 0; i < clean.length; i += 1) {
    if (clean[i] === "{") {
      const prelude = clean.slice(preludeStart, i).trim().replace(/\s+/g, " ");
      const parent = frames[frames.length - 1];
      preludeStart = i + 1;
      if (parent.skip) frames.push({ prefix: "", skip: true });
      else if (prelude.startsWith("@")) {
        const groups = /^@(media|supports|container|layer|scope)\b/.test(prelude);
        frames.push(groups ? { prefix: parent.prefix + prelude + " ", skip: false } : { prefix: "", skip: true });
      } else frames.push({ prefix: parent.prefix, skip: false, record: prelude });
    } else if (clean[i] === "}") {
      const frame = frames.pop()!;
      if (frame.record !== undefined) {
        let depth = 0;
        let current = "";
        const flush = () => {
          const selector = current.replace(/\s+/g, " ").trim();
          if (selector) add(frame.prefix + selector);
          current = "";
        };
        for (const ch of frame.record) {
          if (ch === "(" || ch === "[") depth += 1;
          else if (ch === ")" || ch === "]") depth -= 1;
          else if (ch === "," && depth === 0) { flush(); continue; }
          current += ch;
        }
        flush();
      }
      preludeStart = i + 1;
    }
  }
  if (frames.length !== 1) throw new Error("unbalanced braces in CSS input");
  return counts;
}

const list = (block: string) =>
  block.split(/[|\n]+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);

// --- committed allowlists (regenerate when migrating, never grow silently) ---

const DUP_INDEX_VS_COMPONENTS = list(
`  *|.account-menu|.account-menu button|.account-menu button.selected|.account-menu button:hover|.add-options button|.add-options button:hover|.app-shell|.auth-error|.auth-notice|.brand strong|.category-count|.compact-input|.content|.continue-art|.credential-status
  .credential-status.saved|.detail-label|.details-strip|.discover-card|.discover-card:hover|.discover-header h2|.discover-modal-backdrop|.discover-tabs button|.discover-tabs button.active|.discover-tabs button:hover|.download-empty|.download-empty h3|.download-group|.download-progress|.download-row|.downloads-intro h2
  .empty-state|.empty-state h2|.eyebrow|.flatpak-item|.flatpak-item:hover|.form-fields input|.form-fields input:focus|.form-fields label|.form-fields select|.form-fields select:focus|.game-card|.game-card-art|.game-card-copy|.game-card-copy small|.game-card-copy strong|.game-card-grid
  .game-card-play|.game-card.selected|.game-card:hover|.game-cloud-status|.game-cloud-status.is-synced|.game-cloud-status.not-synced|.game-details-cover|.game-details-hero|.game-details-section|.game-details-title h2|.game-trailer-poster|.hero-copy|.hero-meta|.hero-meta strong|.icon-button|.icon-button:hover
  .igdb-candidate|.igdb-candidate:hover|.installed-content-row|.library-category|.modal|.modal h2|.modal-backdrop|.modrinth-manager|.modrinth-result|.nav-item|.nav-item.active|.nav-item:hover|.new-tofu-card|.new-tofu-card:hover|.nexus-game-picker-row|.nexus-game-picker-row:hover
  .notification-dot|.notification-heading|.notification-item|.notification-popover|.page-heading|.page-heading h1|.play-button|.play-button:disabled|.profile-row|.profile-row.active|.project-details-window|.project-tabs button|.project-tabs button.active|.provider-credential-card|.provider-credential-card input|.provider-credential-card input:focus
  .ready-status|.ready-status.attention|.reset-button|.running-badge|.search-box|.search-box input|.search-box kbd|.search-box:focus-within|.secondary-button|.section-heading h3|.setting-location-value code|.setting-row|.setting-row small|.setting-row:hover|.settings-group|.settings-group-heading
  .settings-intro|.settings-intro h2|.setup-choice|.setup-nav|.setup-nav:disabled|.setup-next|.setup-page h1|.setup-provider-card input|.setup-provider-card input:focus|.setup-theme-card|.setup-theme-card.selected|.setup-theme-card:hover|.setup-welcome-line|.sidebar|.sidebar-account|.sidebar-account:hover
  .stop-button|.text-button|.text-button:hover|.theme-card|.theme-card.selected|.theme-card:hover|.theme-config-path code|.theme-grid|.tofu-card|.tofu-card.active|.tofu-card:hover|.tofu-details|.tofu-manager-form textarea|.tofu-manager-item|.tofu-manager-item.active|.tofu-mods
  .tofu-picker-row|.tofu-workspace-header h3|.toggle:checked|.topbar|.workspace-section-title|.workspace-tabs button|.workspace-tabs button.active|.workspace-tabs button:hover|body`
);

const DUP_INDEX_VS_BRIDGE = list(
`  .account-avatar|.account-menu|.account-menu button|.account-menu button.selected|.account-menu button:hover|.account-menu small|.account-menu-add|.account-menu-avatar|.add-options button|.add-options button:hover|.add-options small|.app-shell|.auth-error|.brand span|.brand strong|.brand-mark
  .breadcrumb|.breadcrumb strong|.breadcrumb-slash|.clear-search|.detail-label|.details-strip|.details-strip strong|.empty-icon|.empty-state h2|.eyebrow|.flatpak-item|.flatpak-item small|.flatpak-item:hover|.form-fields input|.form-fields input:focus|.form-fields label
  .form-fields select|.form-fields select:focus|.game-card|.game-card-art|.game-card-copy small|.game-card-copy strong|.game-card.selected|.game-card:hover|.hero-meta|.hero-meta strong|.icon-button|.icon-button:hover|.igdb-candidate|.igdb-candidate-art|.igdb-candidate-copy p|.igdb-candidate:hover
  .modal|.modal h2|.modal-backdrop|.modal-description|.muted|.nav-item|.nav-item.active|.nav-item:hover|.new-tofu-card|.new-tofu-card small|.notification-dot|.notification-empty|.notification-heading|.notification-heading button|.notification-item|.notification-item span
  .notification-popover|.page-heading h1|.path-text|.play-button|.play-button:hover|.provider-credential-card|.ready-status|.ready-status.attention|.search-box|.search-box input|.search-box input::placeholder|.search-box kbd|.search-box:focus-within|.secondary-button|.secondary-button:hover|.section-heading h3
  .security-actions|.setting-row|.setting-row small|.setting-row:hover|.settings-group|.settings-group-heading|.settings-group-heading span|.settings-group-heading strong|.settings-intro > p:last-child|.settings-intro h2|.setup-choice|.setup-description|.setup-footer|.setup-icon|.setup-nav|.setup-nav:hover
  .setup-next|.setup-next:hover|.setup-no-sources|.setup-page h1|.setup-panel|.setup-platform-logo|.setup-progress span|.setup-progress span.active|.setup-provider-card|.setup-provider-card input|.setup-provider-card label|.setup-scan-state|.setup-shell|.setup-subtitle|.setup-theme-card|.setup-theme-card.selected
  .setup-theme-card:hover|.setup-welcome-line|.sidebar|.sidebar-account|.sidebar-account small|.sidebar-account-wrap|.sidebar-account:hover|.text-button|.theme-card|.theme-card small|.theme-card strong|.theme-card svg|.theme-card-meta|.theme-card.selected|.theme-card:hover|.tofu-card
  .tofu-card strong|.tofu-card.active|.tofu-card:hover|.tofu-details|.tofu-details i|.tofu-mods|.toggle:checked|.topbar|:root|body|footer`
);

const DUP_BRIDGE_VS_COMPONENTS = list(
`  .account-menu|.account-menu button|.account-menu button.selected|.account-menu button:hover|.add-options button|.add-options button:hover|.app-shell|.auth-error|.brand strong|.danger-outline|.detail-label|.details-strip|.empty-state h2|.eyebrow|.flatpak-item|.flatpak-item:hover
  .form-fields input|.form-fields input:focus|.form-fields label|.form-fields select|.form-fields select:focus|.game-card|.game-card-art|.game-card-copy small|.game-card-copy strong|.game-card.selected|.game-card:hover|.hero-meta|.hero-meta strong|.icon-button|.icon-button:hover|.igdb-candidate
  .igdb-candidate:hover|.mfa-setup-card|.mfa-setup-card code|.mfa-title|.modal|.modal h2|.modal-backdrop|.nav-item|.nav-item.active|.nav-item:hover|.new-tofu-card|.notification-dot|.notification-heading|.notification-item|.notification-popover|.page-heading h1
  .passkey-row|.play-button|.provider-credential-card|.ready-status|.ready-status.attention|.search-box|.search-box input|.search-box kbd|.search-box:focus-within|.secondary-button|.section-heading h3|.security-card|.security-provider|.security-signed-out|.setting-row|.setting-row small
  .setting-row:hover|.settings-group|.settings-group-heading|.settings-intro h2|.setup-choice|.setup-nav|.setup-next|.setup-page h1|.setup-provider-card input|.setup-theme-card|.setup-theme-card.selected|.setup-theme-card:hover|.setup-welcome-line|.sidebar|.sidebar-account|.sidebar-account:hover
  .text-button|.theme-card|.theme-card.selected|.theme-card:hover|.tofu-card|.tofu-card.active|.tofu-card:hover|.tofu-details|.tofu-mods|.toggle:checked|.topbar|body`
);

// Intra-file repeats are allowed: within one file the last declaration wins
// deterministically, and these sheets legitimately restate selectors
// (index.css refines earlier rules later; bridge.css restates one concern per
// rule; layout.css repeats @layer-scoped rules across breakpoints).
const INTRA_DUP_INDEX = list(
`  .account-avatar|.account-avatar img|.account-avatar-image|.account-menu|.account-menu button|.account-menu button>span:nth-child(2)|.account-menu small|.account-menu strong|.account-menu-avatar|.add-options small|.add-options strong|.app-shell|.brand-mark|.brand-mark img|.content|.discover-card-icon.fallback
  .discover-controls|.download-empty|.download-empty h3|.download-empty p|.empty-icon|.flatpak-item small|.flatpak-item strong|.form-fields select|.game-card|.game-card-art|.game-card-copy strong|.game-card-play|.game-trailer-start|.help-link|.library-grid-view|.library-mod-fallback
  .library-mod-result small|.library-mod-result strong|.main-content|.modrinth-result p|.modrinth-result small|.modrinth-result strong|.modrinth-result-icon|.nav-item|.nav-item .mochi-icon-wrap|.new-tofu-card|.notification-empty|.play-button|.play-button:disabled|.project-details-header|.project-details-window|.project-markdown
  .project-markdown h1|.project-markdown h2|.project-markdown h3|.project-markdown h4|.project-markdown h5|.project-markdown h6|.project-markdown ol|.project-markdown ul|.project-overview|.project-tabs|.project-version|.provider-credential-heading small|.secondary-button|.setting-row|.setting-row small|.setting-row strong
  .setting-row:hover|.settings-group|.settings-group-heading|.settings-group-heading span|.settings-group-heading strong|.settings-intro h2|.setup-theme-card.selected|.sidebar|.sidebar-account|.sidebar-account small|.sidebar-account strong|.sidebar-account>span:nth-child(2)|.sidebar-bottom|.theme-card|.theme-card small|.theme-card strong
  .theme-grid|@media(max-width:700px) .project-details-header|button`
);

const INTRA_DUP_BRIDGE = list(
`  .add-options button|.details-strip strong|.flatpak-item|.form-fields input|.form-fields select|.modal|.nav-item.active|.new-tofu-card|.passkey-row small|.passkey-row strong|.play-button|.search-box|.secondary-button|.section-heading h3|.security-card-copy small|.security-card-copy strong
  .setting-row|.setup-choice|.setup-choice-icon|.setup-footer|.setup-icon|.setup-nav|.setup-next|.setup-page h1|.setup-panel|.setup-progress span|.setup-progress span.active|.setup-provider-card|.setup-shell|.theme-card|.theme-card small|.tofu-card
  .tofu-details|.tofu-mods`
);

const INTRA_DUP_COMPONENTS = list(
`  .category-count|.discover-card|.download-progress.failed > span|.game-card|.game-card-art|.game-card-copy small|.game-card.selected|.game-details-cover|.game-trailer-poster|.hero-meta|.new-tofu-card|.notification-item|.page-heading h1|.play-button|.section-heading h3|.settings-intro h2
  .stop-button|.theme-card|.tofu-card|[data-mochi-shell="bottom"] .app-shell|[data-mochi-shell="bottom"] .brand|[data-mochi-shell="bottom"] .sidebar|[data-mochi-shell="top"] .sidebar`
);

const INTRA_DUP_LAYOUT = list(
`  @layer layout .bp-root|@layer layout .breadcrumb|@layer layout .breadcrumb > strong|@layer layout .main-content-library.is-scrolling .game-card|@layer layout .play-button|@layer layout .secondary-button|@layer layout .setup-nav|@layer layout [data-mochi-shell="bottom"] .sidebar|@layer layout [data-mochi-shell="top"] .app-shell|@layer layout [data-mochi-shell="top"] .app-shell .sidebar|@layer layout [data-mochi-shell="top"] .main-content|@layer layout [data-mochi-shell="top"] .sidebar|@layer layout body|@layer layout html`
);

const INDEX = ruleCounts(indexCss);
const BRIDGE = ruleCounts(bridgeCss);
const COMPONENTS = ruleCounts(componentsCss);
const LAYOUT = ruleCounts(layoutCss);

const shared = (a: Map<string, number>, b: Map<string, number>) =>
  [...a.keys()].filter((selector) => b.has(selector)).sort();

describe("base-layer selector parity", () => {
  it("index.css ∩ components.css matches the committed allowlist (shrink only)", () => {
    expect(shared(INDEX, COMPONENTS)).toEqual(DUP_INDEX_VS_COMPONENTS);
  });

  it("index.css ∩ bridge.css matches the committed allowlist (shrink only)", () => {
    expect(shared(INDEX, BRIDGE)).toEqual(DUP_INDEX_VS_BRIDGE);
  });

  it("bridge.css ∩ components.css matches the committed allowlist (shrink only)", () => {
    expect(shared(BRIDGE, COMPONENTS)).toEqual(DUP_BRIDGE_VS_COMPONENTS);
  });

  it("layout.css (unlayered) shares no selector with any base-layer sheet", () => {
    expect(shared(LAYOUT, INDEX)).toEqual([]);
    expect(shared(LAYOUT, BRIDGE)).toEqual([]);
    expect(shared(LAYOUT, COMPONENTS)).toEqual([]);
  });
});

describe("no new intra-file selector duplication", () => {
  it.each([
    ["index.css", INDEX, INTRA_DUP_INDEX],
    ["bridge.css", BRIDGE, INTRA_DUP_BRIDGE],
    ["components.css", COMPONENTS, INTRA_DUP_COMPONENTS],
    ["layout.css", LAYOUT, INTRA_DUP_LAYOUT],
  ])("%s repeats only allowlisted selectors internally", (_name, counts, allowed) => {
    const repeated = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s).sort();
    expect(repeated).toEqual(allowed);
  });
});
