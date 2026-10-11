export function translateCommandTitle(title: string, t: (message: string) => string) {
  // Translate the UI-owned part of generated titles, preserving game, theme,
  // profile, and other runtime names exactly as supplied by the user.
  if (title.startsWith("Settings: ")) return `${t("Settings:")} ${t(title.slice("Settings: ".length))}`;
  if (title.startsWith("Theme: ")) return `${t("Theme:")} ${title.slice("Theme: ".length)}`;
  if (title.startsWith("Launch profile: ")) {
    const detail = title.slice("Launch profile: ".length);
    return `${t("Launch profile:")} ${detail.replace(" / Default options", ` / ${t("Default options")}`)}`;
  }
  const installMatch = /^Install mod "(.+)"$/.exec(title);
  if (installMatch) return `${t("Install mod")} "${installMatch[1]}"`;
  return t(title);
}

export function translateCommandGroup(group: string, t: (message: string) => string) {
  // "Recent" is a UI prefix, not part of the group label.
  if (group.startsWith("Recent · ")) return `${t("Recent")} · ${t(group.slice("Recent · ".length))}`;
  return t(group);
}

export function translatePaletteSubtitle(subtitle: string, t: (message: string) => string) {
  return translateCommandGroup(subtitle, t);
}
