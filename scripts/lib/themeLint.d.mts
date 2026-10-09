export type ThemeLintFinding = { selector: string; property: string; message: string };
export const REQUIRED_COLORS: string[];
export function lintThemeCss(css: string): ThemeLintFinding[];
export function lintManifest(manifest: unknown): ThemeLintFinding[];
