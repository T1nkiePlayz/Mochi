import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import mochiManifest from "../themes/mochi/theme.json";
import mochiCss from "../themes/mochi/theme.css?raw";
import minecraftOreManifest from "../themes/minecraft-ore/theme.json";
import minecraftOreCss from "../themes/minecraft-ore/theme.css?raw";
import subnauticaManifest from "../themes/subnautica/theme.json";
import subnauticaCss from "../themes/subnautica/theme.css?raw";
import dungeonsManifest from "../themes/dungeons/theme.json";
import dungeonsCss from "../themes/dungeons/theme.css?raw";
import mochiLightManifest from "../themes/mochi-light/theme.json";
import mochiLightCss from "../themes/mochi-light/theme.css?raw";

export type ThemeManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  colors?: Record<string, string>;
  ui?: Record<string, string>;
  typography?: Record<string, string>;
  layout?: Record<string, string>;
  effects?: Record<string, string>;
  components?: Record<string, string>;
  icons?: Record<string, string>;
  assets?: Record<string, string>;
};

export type ThemeDescriptor = ThemeManifest & {
  source: "builtin" | "user";
};

export type LoadedTheme = ThemeDescriptor & {
  css: string;
  assetUrls: Record<string, string>;
};

type NativeUserTheme = {
  manifest: ThemeManifest;
  css: string;
  assets: Record<string, string>;
};

const assetModules = import.meta.glob("../themes/*/assets/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function builtinAssets(themeId: string, manifest: ThemeManifest): Record<string, string> {
  const result: Record<string, string> = {};
  const declarations: Array<[string, string]> = [
    ...Object.entries(manifest.assets ?? {}),
    ...Object.entries(manifest.icons ?? {}).map(([name, path]) => ["icon:" + name, path] as [string, string]),
  ];
  for (const [logicalName, relativePath] of declarations) {
    const key = "../themes/" + themeId + "/" + relativePath;
    if (assetModules[key]) result[logicalName] = assetModules[key];
  }
  return result;
}

const builtins: Array<{ manifest: ThemeManifest; css: string; assets: Record<string, string> }> = [
  { manifest: mochiManifest as ThemeManifest, css: mochiCss, assets: builtinAssets("mochi", mochiManifest as ThemeManifest) },
  { manifest: minecraftOreManifest as ThemeManifest, css: minecraftOreCss, assets: builtinAssets("minecraft-ore", minecraftOreManifest as ThemeManifest) },
  { manifest: subnauticaManifest as ThemeManifest, css: subnauticaCss, assets: builtinAssets("subnautica", subnauticaManifest as ThemeManifest) },
  { manifest: dungeonsManifest as ThemeManifest, css: dungeonsCss, assets: builtinAssets("dungeons", dungeonsManifest as ThemeManifest) },
  { manifest: mochiLightManifest as ThemeManifest, css: mochiLightCss, assets: builtinAssets("mochi-light", mochiLightManifest as ThemeManifest) },
];

const builtinsById = new Map(builtins.map((theme) => [theme.manifest.id, theme]));

export function getSystemThemeId(): "mochi" | "mochi-light" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "mochi-light" : "mochi";
  }
  return "mochi";
}

export function getBuiltinThemes(): ThemeDescriptor[] {
  return builtins.map(({ manifest }) => ({ ...manifest, source: "builtin" }));
}

export async function listThemes(): Promise<ThemeDescriptor[]> {
  try {
    const userThemes = await invoke<ThemeDescriptor[]>("list_user_themes");
    const userById = new Map(userThemes.map((theme) => [theme.id, theme]));
    return [
      ...getBuiltinThemes().map((theme) =>
        userById.has(theme.id)
          ? { ...theme, ...userById.get(theme.id), source: "user" as const }
          : theme,
      ),
      ...userThemes.filter((theme) => !builtinsById.has(theme.id)),
    ];
  } catch {
    return getBuiltinThemes();
  }
}

export async function getThemeConfig(): Promise<{
  configPath: string;
  themesPath: string;
  selectedTheme: string;
}> {
  return invoke("get_mochi_config_info");
}

export async function setTheme(themeId: string): Promise<void> {
  try {
    await invoke("set_mochi_theme", { themeId });
  } catch {
    window.localStorage.setItem("mochi:theme", themeId);
  }
}

export async function loadTheme(theme: ThemeDescriptor): Promise<LoadedTheme> {
  const builtin = builtinsById.get(theme.id);
  if (builtin && theme.source === "builtin") {
    return { ...theme, css: builtin.css, assetUrls: builtin.assets };
  }

  try {
    const loaded = await invoke<NativeUserTheme>("load_user_theme", { themeId: theme.id });
    return {
      ...loaded.manifest,
      source: "user",
      css: loaded.css,
      assetUrls: loaded.assets,
    };
  } catch {
    const fallback = builtinsById.get("mochi")!;
    return {
      ...fallback.manifest,
      source: "builtin",
      css: fallback.css,
      assetUrls: fallback.assets,
    };
  }
}

function cssName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
}

function buildTokenSheet(theme: LoadedTheme): string {
  const lines = [":root {"];
  for (const [key, value] of Object.entries(theme.colors ?? {})) {
    lines.push("  --mochi-" + cssName(key) + ": " + value + ";");
  }
  for (const section of [theme.ui, theme.typography, theme.layout, theme.effects, theme.components]) {
    for (const [key, value] of Object.entries(section ?? {})) {
      lines.push("  --mochi-" + cssName(key) + ": " + value + ";");
    }
  }
  for (const [key, value] of Object.entries(theme.assetUrls ?? {})) {
    const prefix = key.startsWith("icon:") ? "mochi-icon-" : "mochi-asset-";
    const logical = key.startsWith("icon:") ? key.slice(5) : key;
    lines.push('  --' + prefix + cssName(logical) + ': url("' + value + '");');
  }
  lines.push("}");
  return lines.join("\n");
}

function buildBridgeSheet(): string {
  return [
    ":root { color: var(--mochi-text); background: var(--mochi-background); font-family: var(--mochi-font-body); }",
    "body { background: var(--mochi-background); color: var(--mochi-text); }",
    ".app-shell { background: var(--mochi-background); }",
    ".sidebar { width: var(--mochi-sidebar-width); flex-basis: var(--mochi-sidebar-width); background: var(--mochi-background-elevated); border-color: var(--mochi-border); }",
    ".brand strong, .page-heading h1, .hero-card h2, .settings-intro h2, .setup-page h1, .section-heading h3 { color: var(--mochi-text-strong); font-family: var(--mochi-font-display); }",
    ".brand span, .breadcrumb, .eyebrow, .text-button, .detail-label, .section-label { color: var(--mochi-text-muted); }",
    ".topbar { border-color: var(--mochi-border); }",
    ".nav-item, .piko-nav-item { color: var(--mochi-text-muted); }",
    ".nav-item:hover, .piko-nav-item:hover, .nav-item.active, .piko-nav-item.selected { background: var(--mochi-surface-hover); color: var(--mochi-text-strong); }",
    ".nav-item.active { box-shadow: inset 2px 0 var(--mochi-accent); }",
    ".icon-button { color: var(--mochi-text-muted); }",
    ".icon-button:hover { background: var(--mochi-surface-hover); color: var(--mochi-text-strong); }",
    ".search-box, .form-fields input, .form-fields select, .igdb-form input, .setup-fields input { border-color: var(--mochi-border); background: var(--mochi-background); color: var(--mochi-text); }",
    ".search-box:focus-within, .form-fields input:focus, .form-fields select:focus, .igdb-form input:focus { border-color: var(--mochi-accent-strong); }",
    ".secondary-button, .play-button { border-radius: var(--mochi-radius-sm); }",
    ".secondary-button { background: var(--mochi-surface-raised); color: var(--mochi-text-strong); }",
    ".secondary-button:hover { background: var(--mochi-surface-hover); }",
    ".play-button { color: var(--mochi-accent-text); background: var(--mochi-accent); }",
    ".play-button:hover { background: var(--mochi-accent-strong); }",
    ".hero-card, .tofu-card, .new-tofu-card, .settings-group, .modal, .theme-card, .game-card { border-color: var(--mochi-border); background-color: var(--mochi-surface); }",
    ".tofu-card:hover, .tofu-card.active, .game-card:hover, .game-card.selected, .theme-card:hover, .theme-card.selected { border-color: var(--mochi-accent-strong); background: var(--mochi-surface-raised); }",
    ".tofu-details, .tofu-mods, .game-card-copy small, .setting-row small, .theme-card small, .modal-description, .settings-intro > p:last-child { color: var(--mochi-text-muted); }",
    ".details-strip { border-color: var(--mochi-border); }",
    ".details-strip strong, .setting-row, .theme-card, .add-options button, .flatpak-item, .import-game-row { color: var(--mochi-text); }",
    ".setting-row { border-color: var(--mochi-border); }",
    ".setting-row:hover { background: var(--mochi-surface-hover); }",
    ".toggle:checked { background: var(--mochi-accent-strong); }",
    ".auth-error { color: var(--mochi-danger); }",
    ".ready-status { color: var(--mochi-success); }",
    ".ready-status.attention { color: var(--mochi-warning); }",
    ".modal-backdrop { background: color-mix(in srgb, var(--mochi-background) 74%, transparent); }",
    ".modal { box-shadow: 0 20px 70px var(--mochi-shadow); }",
    ".theme-card svg { color: var(--mochi-accent-strong); }",
    ".brand-mark { background: var(--mochi-surface-raised); border-color: var(--mochi-border-strong); }",
    ".account-avatar { background: var(--mochi-surface-raised); border-color: var(--mochi-border-strong); }",
    ".setup-shell { background: var(--mochi-background); }",
    ".setup-panel { background: var(--mochi-background-elevated); border-color: var(--mochi-border); box-shadow: 0 35px 120px var(--mochi-shadow); }",
    ".setup-progress span { background: var(--mochi-border); }",
    ".setup-progress span.active { background: var(--mochi-accent); }",
    ".setup-icon { color: var(--mochi-accent-strong); border-color: var(--mochi-border); background: var(--mochi-accent-soft); }",
    ".setup-choice, .setup-source, .import-source-row { background: var(--mochi-surface); border-color: var(--mochi-border); }",
    ".setup-choice-icon, .setup-source-logo, .import-source-icon { color: var(--mochi-accent-strong); background: var(--mochi-accent-soft); }",
    ".setup-next { color: var(--mochi-accent-text); border-color: var(--mochi-accent); background: var(--mochi-accent); }",
    ".setup-next:hover { background: var(--mochi-accent-strong); }",
    "footer { color: var(--mochi-text-faint); }",
    ".breadcrumb strong { color: var(--mochi-text); }",
    ".breadcrumb-slash { color: var(--mochi-border-strong); }",
    ".search-box { border-color: var(--mochi-border); background: var(--mochi-surface-raised); color: var(--mochi-text-muted); }",
    ".search-box input { color: var(--mochi-text); }",
    ".search-box kbd, .search-box input::placeholder, .clear-search { color: var(--mochi-text-faint); }",
    ".sidebar-account { color: var(--mochi-text); background: transparent; }",
    ".sidebar-account:hover { background: var(--mochi-surface-hover); }",
    ".sidebar-account small { color: var(--mochi-text-muted); }",
    ".account-menu { border-color: var(--mochi-border); background: var(--mochi-background-elevated); box-shadow: 0 18px 50px var(--mochi-shadow); }",
    ".account-menu button { color: var(--mochi-text); background: transparent; }",
    ".account-menu button:hover, .account-menu button.selected { background: var(--mochi-surface-hover); }",
    ".account-menu small { color: var(--mochi-text-muted); }",
    ".account-menu-add { border-top-color: var(--mochi-border); }",
    ".account-menu-avatar { color: var(--mochi-accent-strong); background: var(--mochi-accent-soft); }",
    ".notification-popover { border-color: var(--mochi-border); background: var(--mochi-background-elevated); box-shadow: 0 18px 50px var(--mochi-shadow); }",
    ".notification-heading { border-bottom-color: var(--mochi-border); color: var(--mochi-text-strong); }",
    ".notification-heading button { color: var(--mochi-accent-strong); background: transparent; }",
    ".notification-item { border-bottom-color: var(--mochi-border); color: var(--mochi-text); }",
    ".notification-item span, .notification-empty { color: var(--mochi-text-muted); }",
    ".notification-dot { background: var(--mochi-danger); }",
    ".section-heading h3 { color: var(--mochi-text-strong); }",
    ".hero-card p, .hero-kicker, .hero-meta { color: var(--mochi-text-muted); }",
    ".hero-meta strong { color: var(--mochi-text); }",
    ".details-strip strong { color: var(--mochi-text); }",
    ".muted { color: var(--mochi-text-muted); }",
    ".path-text { color: var(--mochi-text-muted) !important; }",
    ".tofu-card, .new-tofu-card { color: var(--mochi-text); }",
    ".tofu-card strong, .game-card-copy strong { color: var(--mochi-text-strong); }",
    ".tofu-details, .tofu-mods, .new-tofu-card small { color: var(--mochi-text-muted); }",
    ".tofu-details i { background: var(--mochi-text-faint); }",
    ".game-card-art, .igdb-candidate-art { background-color: var(--mochi-surface-raised); }",
    ".empty-state h2 { color: var(--mochi-text-strong); }",
    ".empty-icon { color: var(--mochi-accent-strong); background: var(--mochi-accent-soft); }",
    ".modal-header .icon-button, .modal .icon-button { color: var(--mochi-text-muted); }",
    ".modal h2 { color: var(--mochi-text-strong); }",
    ".add-options button, .flatpak-item, .igdb-candidate { border-color: var(--mochi-border); color: var(--mochi-text); background: var(--mochi-surface-raised); }",
    ".add-options button:hover, .flatpak-item:hover, .igdb-candidate:hover { border-color: var(--mochi-accent-strong); background: var(--mochi-surface-hover); }",
    ".add-options small, .flatpak-item small, .igdb-candidate-copy p { color: var(--mochi-text-muted); }",
    ".form-fields label, .igdb-form label { color: var(--mochi-text-muted); }",
    ".form-fields input, .form-fields select, .igdb-form input, .setup-fields input { border-color: var(--mochi-border); background: var(--mochi-background); color: var(--mochi-text); }",
    ".settings-group-heading { border-bottom-color: var(--mochi-border); }",
    ".settings-group-heading strong { color: var(--mochi-text-strong); }",
    ".settings-group-heading span { color: var(--mochi-text-muted); }",
    ".theme-card strong { color: var(--mochi-text-strong); }",
    ".theme-card small { color: var(--mochi-text-muted); }",
    ".theme-card-meta { color: var(--mochi-text-faint) !important; }",
    ".provider-credential-card, .setup-provider-card { border-color: var(--mochi-border); background: var(--mochi-surface-raised); color: var(--mochi-text); }",
    ".setup-shell { color: var(--mochi-text); background: var(--mochi-background); }",
    ".setup-panel { background: var(--mochi-background-elevated); border-color: var(--mochi-border); box-shadow: 0 35px 120px var(--mochi-shadow); }",
    ".setup-page h1, .setup-welcome-line { color: var(--mochi-text-strong); }",
    ".setup-description, .setup-footnote, .setup-subtitle, .setup-to { color: var(--mochi-text-muted); }",
    ".setup-progress span { background: var(--mochi-border); }",
    ".setup-progress span.active { background: var(--mochi-accent); }",
    ".setup-choice, .setup-source, .import-source-row, .setup-provider-card { border-color: var(--mochi-border); background: var(--mochi-surface); color: var(--mochi-text); }",
    ".setup-choice-icon, .setup-source-logo, .import-source-icon, .setup-icon { color: var(--mochi-accent-strong); background: var(--mochi-accent-soft); border-color: var(--mochi-border); }",
    ".setup-source:hover, .setup-source.selected, .import-source-row:hover { border-color: var(--mochi-accent-strong); background: var(--mochi-surface-hover); }",
    ".setup-source-check { border-color: var(--mochi-border-strong); background: var(--mochi-background); }",
    ".setup-source.selected .setup-source-check { border-color: var(--mochi-accent); background: var(--mochi-accent); }",
    ".setup-source-copy small, .setup-source>svg, .setup-scan-state, .setup-no-sources { color: var(--mochi-text-muted); }",
    ".setup-footer { border-top-color: var(--mochi-border); background: color-mix(in srgb, var(--mochi-background-elevated) 88%, transparent); }",
    ".setup-nav { border-color: var(--mochi-border); color: var(--mochi-text); background: var(--mochi-surface-raised); }",
    ".setup-nav:hover { border-color: var(--mochi-border-strong); background: var(--mochi-surface-hover); }",
    ".setup-next { color: var(--mochi-accent-text); border-color: var(--mochi-accent); background: var(--mochi-accent); }",
    ".setup-theme-card { border-color: var(--mochi-border); background: var(--mochi-surface); color: var(--mochi-text); }",
    ".setup-theme-card:hover, .setup-theme-card.selected { border-color: var(--mochi-accent); background: var(--mochi-surface-raised); }",
  ].join("\n");
}

export function applyTheme(theme: LoadedTheme): () => void {
  const styleId = "mochi-theme-engine";
  document.getElementById(styleId)?.remove();

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = [buildTokenSheet(theme), theme.css, buildBridgeSheet()].join("\n");
  document.head.appendChild(style);

  document.documentElement.dataset.mochiTheme = theme.id;
  document.documentElement.style.colorScheme = theme.id === "mochi-light" ? "light" : "dark";
  window.dispatchEvent(new Event("mochi-theme-changed"));

  return () => {
    document.getElementById(styleId)?.remove();
  };
}

export async function importThemeFile(): Promise<ThemeDescriptor | null> {
  const selected = await open({
    title: "Import Mochi theme",
    multiple: false,
    directory: false,
    filters: [{ name: "Mochi theme manifest", extensions: ["json"] }],
  });
  if (typeof selected !== "string") return null;
  return invoke<ThemeDescriptor>("import_theme", { sourcePath: selected });
}

export async function importThemeFolder(): Promise<ThemeDescriptor | null> {
  const selected = await open({
    title: "Import Mochi theme folder",
    multiple: false,
    directory: true,
  });
  if (typeof selected !== "string") return null;
  return invoke<ThemeDescriptor>("import_theme", { sourcePath: selected });
}


export function useThemeEngine() {
  const [themes, setThemes] = useState<ThemeDescriptor[]>(getBuiltinThemes);
  const [theme, setThemeState] = useState("mochi");
  const [configInfo, setConfigInfo] = useState<{ configPath: string; themesPath: string; selectedTheme: string } | null>(null);

  const reloadThemes = async () => {
    const nextThemes = await listThemes();
    setThemes(nextThemes);
    return nextThemes;
  };

  const selectTheme = async (themeId: string) => {
    setThemeState(themeId);
    await setTheme(themeId);
    const descriptor = (await listThemes()).find((candidate) => candidate.id === themeId);
    if (descriptor) {
      const loaded = await loadTheme(descriptor);
      applyTheme(loaded);
    }
    setThemes(await listThemes());
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await getThemeConfig();
        if (cancelled) return;
        setConfigInfo(info);
        const stored = window.localStorage.getItem("mochi:theme");
        let legacyTheme = stored;
        if (!legacyTheme) {
          try {
            const legacySettings = JSON.parse(window.localStorage.getItem("mochi:settings") || "{}");
            legacyTheme = typeof legacySettings.theme === "string" ? legacySettings.theme : null;
          } catch {
            legacyTheme = null;
          }
        }
        const selected = legacyTheme || (window.localStorage.getItem("mochi:setup-complete") === "true" ? info.selectedTheme || "mochi" : getSystemThemeId());
        setThemeState(selected);
        if (legacyTheme && legacyTheme !== info.selectedTheme) {
          await setTheme(legacyTheme);
        }
        const available = await listThemes();
        if (cancelled) return;
        setThemes(available);
        const descriptor = available.find((candidate) => candidate.id === selected) ?? available[0];
        if (descriptor) {
          setThemeState(descriptor.id);
          applyTheme(await loadTheme(descriptor));
        }
      } catch {
        const stored = window.localStorage.getItem("mochi:theme") || "mochi";
        const available = getBuiltinThemes();
        const descriptor = available.find((candidate) => candidate.id === stored) ?? available[0];
        setThemes(available);
        setThemeState(descriptor.id);
        applyTheme(await loadTheme(descriptor));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { themes, theme, setTheme: selectTheme, reloadThemes, configInfo };
}
