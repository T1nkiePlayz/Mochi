import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readString, writeString } from "./storage";

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
  /** Google Fonts stylesheet URLs (https://fonts.googleapis.com/css...). Ignored for built-in themes (bundled); user themes get them downloaded once and cached locally. */
  fonts?: string[];
  /** Where the navigation lives: a left sidebar (default), right sidebar, top bar, bottom bar or icon rail. */
  shell?: "left" | "right" | "top" | "bottom" | "rail";
  /** Whether native controls (scrollbars, form widgets) should render light or dark. */
  scheme?: "light" | "dark";
  /** Sort position in theme pickers; built-in themes only. */
  order?: number;
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

const manifestModules = import.meta.glob("../themes/*/theme.json", { eager: true, import: "default" }) as Record<string, ThemeManifest>;
const cssModules = import.meta.glob("../themes/*/theme.css", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

/** Every folder under src/themes is a built-in theme; no registration needed. */
const builtins: Array<{ manifest: ThemeManifest; css: string; assets: Record<string, string> }> = Object.entries(manifestModules)
  .map(([path, manifest]) => ({
    manifest,
    css: cssModules[path.replace("theme.json", "theme.css")] ?? "",
    assets: builtinAssets(path.split("/")[2], manifest),
  }))
  .sort((a, b) => (a.manifest.order ?? 100) - (b.manifest.order ?? 100) || a.manifest.name.localeCompare(b.manifest.name));

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
    writeString("mochi:theme", themeId);
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

/** A token value may not close its declaration or rule, or open a comment: that would let one token rewrite the sheet. */
export function isSafeCssValue(value: unknown): value is string {
  return typeof value === "string" && !/[{};]|\/\*|\*\//.test(value) && !/[\r\n]/.test(value);
}

const cssUrl = (value: string) => 'url("' + value.replace(/[\\"\r\n]/g, (char) => encodeURIComponent(char)) + '")';

export function buildTokenSheet(theme: LoadedTheme): string {
  const lines = [":root {"];
  const sections = [theme.colors, theme.ui, theme.typography, theme.layout, theme.effects, theme.components];
  for (const section of sections) {
    for (const [key, value] of Object.entries(section ?? {})) {
      if (isSafeCssValue(value)) lines.push("  --mochi-" + cssName(key) + ": " + value + ";");
    }
  }
  for (const [key, value] of Object.entries(theme.assetUrls ?? {})) {
    if (typeof value !== "string") continue;
    const prefix = key.startsWith("icon:") ? "mochi-icon-" : "mochi-asset-";
    const logical = key.startsWith("icon:") ? key.slice(5) : key;
    lines.push('  --' + prefix + cssName(logical) + ': ' + cssUrl(value) + ';');
  }
  lines.push("}");
  return lines.join("\n");
}

const fontStyleId = "mochi-theme-fonts";
const MAX_FONT_URLS = 6;

/** Mirrors the native allow-list: only Google Fonts CSS endpoints over https. */
export function isGoogleFontsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "fonts.googleapis.com" && !url.port && !url.username && !url.password && url.pathname.startsWith("/css");
  } catch {
    return false;
  }
}

export function applyTheme(theme: LoadedTheme): () => void {
  const styleId = "mochi-theme-engine";
  document.getElementById(styleId)?.remove();

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = [buildTokenSheet(theme), theme.css].join("\n");
  document.head.appendChild(style);

  document.getElementById(fontStyleId)?.remove();
  // Built-in fonts are bundled (fonts.generated.css). Only user themes can declare Google Fonts,
  // which the native side downloads once and serves from the Mochi config folder.
  let cancelled = false;
  if (theme.source === "user") {
    const urls = (theme.fonts ?? []).filter(isGoogleFontsUrl).slice(0, MAX_FONT_URLS);
    if (urls.length) {
      void invoke<string>("cache_theme_fonts", { themeId: theme.id, urls }).then((fontCss) => {
        if (cancelled || !fontCss) return;
        document.getElementById(fontStyleId)?.remove();
        const fontStyle = document.createElement("style");
        fontStyle.id = fontStyleId;
        fontStyle.textContent = fontCss;
        document.head.appendChild(fontStyle);
      }).catch(() => { /* Offline and uncached: the theme falls back to its system font stack. */ });
    }
  }

  document.documentElement.dataset.mochiTheme = theme.id;
  document.documentElement.dataset.mochiShell = theme.shell ?? "left";
  document.documentElement.style.colorScheme = theme.scheme ?? "dark";
  window.dispatchEvent(new Event("mochi-theme-changed"));

  return () => {
    cancelled = true;
    document.getElementById(styleId)?.remove();
    document.getElementById(fontStyleId)?.remove();
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

  const selection = useRef(0);
  const selectTheme = async (themeId: string) => {
    const mine = ++selection.current;
    setThemeState(themeId);
    await setTheme(themeId);
    const available = await listThemes();
    const descriptor = available.find((candidate) => candidate.id === themeId);
    const loaded = descriptor ? await loadTheme(descriptor) : null;
    // Clicking through themes quickly: only the last choice may be applied, whatever order the loads finish in.
    if (mine === selection.current && loaded) applyTheme(loaded);
    setThemes(available);
  };

  useEffect(() => {
    let cancelled = false;
    const refreshConfigInfo = async () => {
      try {
        const info = await getThemeConfig();
        if (!cancelled) setConfigInfo(info);
      } catch {
        // Browser/development mode or an unavailable native backend.
      }
    };
    const onConfigChanged = () => { void refreshConfigInfo(); };
    window.addEventListener("mochi-config-changed", onConfigChanged);
    void (async () => {
      try {
        const [info, available] = await Promise.all([getThemeConfig(), listThemes()]);
        if (cancelled) return;
        setConfigInfo(info);
        const stored = readString("mochi:theme");
        let legacyTheme = stored;
        if (!legacyTheme) {
          try {
            const legacySettings = JSON.parse(readString("mochi:settings") || "{}");
            legacyTheme = typeof legacySettings?.theme === "string" ? legacySettings.theme : null;
          } catch {
            legacyTheme = null;
          }
        }
        const selected = legacyTheme || (readString("mochi:setup-complete") === "true" ? info.selectedTheme || "mochi" : getSystemThemeId());
        setThemeState(selected);
        if (legacyTheme && legacyTheme !== info.selectedTheme) {
          await setTheme(legacyTheme);
        }
        setThemes(available);
        const descriptor = available.find((candidate) => candidate.id === selected) ?? available[0];
        if (descriptor) {
          setThemeState(descriptor.id);
          const loaded = await loadTheme(descriptor);
          // The user may have picked a theme while the first one was loading.
          if (!cancelled && selection.current === 0) applyTheme(loaded);
        }
      } catch {
        const stored = readString("mochi:theme") || "mochi";
        const available = getBuiltinThemes();
        const descriptor = available.find((candidate) => candidate.id === stored) ?? available[0];
        setThemes(available);
        setThemeState(descriptor.id);
        applyTheme(await loadTheme(descriptor));
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("mochi-config-changed", onConfigChanged);
    };
  }, []);

  return { themes, theme, setTheme: selectTheme, reloadThemes, configInfo };
}
