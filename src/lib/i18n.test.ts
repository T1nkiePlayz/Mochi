import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { launcherLanguages } from "./languages";
import { getTranslationMessages, hasTranslation, translate } from "./i18n";

describe("shared UI translations", () => {
  it("translates core setup and shell messages for every supported non-English language", () => {
    for (const language of launcherLanguages) {
      if (language.code === "en") continue;
      for (const message of ["Loading…", "Not found.", "Get started", "Back", "Skip", "Next", "Finish", "Language", "Theme", "Accessibility", "Account", "Sign in", "Sign out", "Settings", "General", "Activity", "No active downloads", "Nothing is downloading right now.", "Your games, your way.", "Choose your language.", "Choose your theme.", "Make Mochi comfortable.", "Find your games.", "Connected", "Main navigation", "Search languages…", "Light", "Dark", "Preferences", "Make Mochi yours.", "Display language", "Launcher-wide language preference", "Appearance", "Personalize the launcher", "Open menu", "Search your library", "Clear search", "Notifications", "You’re all caught up.", "Game news", "Launcher behavior", "Launch Mochi on startup", "In-app notifications", "System notifications", "Separate account profiles", "System tray service", "Always active", "Download controls", "Bandwidth limit", "Download schedule", "Start time", "End time", "Clear finished", "Pause all", "Resume all", "Refresh", "Your stores", "On sale", "Free on Epic", "Price watches", "Announcements", "Mod updates", "Free games & deals", "Checking…", "Free now", "Coming soon", "Your collection", "Continue playing", "Add Piko", "What should I play?", "Done selecting", "Select", "Sort by", "No games match.", "Good evening", "Good morning", "Good afternoon", "You're offline. Your library, saves and cached artwork still work.", "Your Mochi library is empty.", "Mochi starts clean. Add a game when you are ready.", "Jump back in", "Show everything", "Category", "Soundtracks & extras", "New Tofu", "Manage", "Your Tofus", "Choose the language Mochi should use wherever a translation is available. Game news will automatically follow this choice. You can change it any time in Settings.", "Themes restyle the whole launcher and apply as soon as you pick one. Change it any time in Settings, where you can also install your own.", "Pick text size, motion and contrast now. These are saved on this device and you can change them any time in Settings.", "Pick what to bring in. Nothing is moved or changed; Mochi just remembers how to start each game or launcher.", "Bring your cloud library with you.", "If you have used Mochi on another device, import the games saved to your account. Mochi merges cloud games into this device and keeps games that exist only here.", "Check and import cloud data", "Your account is ready.", "Connect your Mochi account.", "Your account is connected. Provider keys can be saved securely, and cloud features are ready when you need them.", "Signing in lets you store provider keys securely and sync your library. Your installed games and files stay on this device.", "Connect your game services.", "Optional keys that unlock richer game pages. They are stored in your account vault and cannot be read back.", "Sign in to add keys.", "You can do this later from Settings.", "Text size", "Make everything larger or smaller.", "Reduce motion", "Stop animations and sliding transitions.", "Follow system", "High contrast", "Strong borders and black-and-white colours.", "Colour-blind mode", "Distinct status colours.", "Focus rings", "How strongly the selected control is outlined.", "Readable font", "Larger click targets", "Buttons and fields are at least 44 pixels.", "You can change all of this later in Settings, Accessibility."]) {
        expect(hasTranslation(message, language.code), `${language.code}: ${message}`).toBe(true);
        expect(translate(message, language.code), `${language.code}: ${message}`).toBeTruthy();
      }
    }
  });

  it("has an explicit translation for every catalogue entry in every supported locale", () => {
    for (const language of launcherLanguages) {
      if (language.code === "en") continue;
      for (const message of getTranslationMessages()) {
        expect(hasTranslation(message, language.code), `${language.code}: ${message}`).toBe(true);
      }
    }
  });

  it("covers every literal user-facing JSX string in every supported locale", () => {
    const root = path.resolve(process.cwd(), "src");
    const skippedTags = new Set(["CodeBlock", "WritingBlock", "AppBlock", "pre", "code", "textarea", "script", "style", "kbd"]);
    const visibleAttributes = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "placeholder", "alt", "label", "description", "emptyLabel", "confirmLabel", "cancelLabel", "submitLabel", "buttonLabel", "heading", "caption", "tooltip", "helpText"]);
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.isFile() && entry.name.endsWith(".tsx") && !/\.test\.tsx$/.test(entry.name) && entry.name !== "LocalizedText.tsx") files.push(fullPath);
      }
    };
    const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
    const normalize = (value: string) => value.split(/\r?\n/).map((line, index, lines) => {
      let part = line.replace(/\t/g, " ");
      if (index > 0) part = part.replace(/^\s+/, "");
      if (index < lines.length - 1) part = part.replace(/\s+$/, "");
      return part;
    }).filter(Boolean).join(" ").trim();
    const found = new Map<string, string>();
    const untranslatedByDesign = new Set(["Mochi", "Mochi v", "Mochi Cloud", "GitHub", "Google", "CheapShark", "Epic Games Store", "U", "you@example.com", "org.company.game"]);
    const collect = (node: ts.Node, skipText = false) => {
      if (ts.isJsxElement(node)) {
        const tag = node.openingElement.tagName.getText();
        const skipChildren = skipText || skippedTags.has(tag);
        for (const attribute of node.openingElement.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && visibleAttributes.has(attribute.name.getText()) && attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
            const message = decode(attribute.initializer.text).trim();
            if (message && /\p{L}/u.test(message)) found.set(message, path.relative(root, attribute.getSourceFile().fileName));
          }
        }
        node.children.forEach((child) => collect(child, skipChildren));
        return;
      }
      if (ts.isJsxSelfClosingElement(node)) {
        for (const attribute of node.attributes.properties) {
          if (ts.isJsxAttribute(attribute) && visibleAttributes.has(attribute.name.getText()) && attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
            const message = decode(attribute.initializer.text).trim();
            if (message && /\p{L}/u.test(message)) found.set(message, path.relative(root, attribute.getSourceFile().fileName));
          }
        }
        return;
      }
      if (ts.isJsxFragment(node)) {
        node.children.forEach((child) => collect(child, skipText));
        return;
      }
      if (ts.isJsxText(node) && !skipText) {
        const message = decode(normalize(node.text));
        if (message && /\p{L}/u.test(message)) found.set(message, path.relative(root, node.getSourceFile().fileName));
        return;
      }
      if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression) && !skipText) {
        const message = decode(node.expression.text).trim();
        if (message && /\p{L}/u.test(message)) found.set(message, path.relative(root, node.getSourceFile().fileName));
        return;
      }
      ts.forEachChild(node, (child) => collect(child, skipText));
    };
    walk(root);
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      collect(source);
    }
    const missing = new Map<string, { file: string; languages: string[] }>();
    for (const [message, file] of found) {
      if (untranslatedByDesign.has(message)) continue;
      const languages = launcherLanguages.filter((language) => language.code !== "en" && !hasTranslation(message, language.code)).map((language) => language.code);
      if (languages.length) missing.set(message, { file, languages });
    }
    const missingMessages = [...missing.entries()].map(([message, details]) => `"${message}" (${details.file}) — missing: ${details.languages.join(", ")}`);
    expect(missingMessages, `Missing literal UI translations (${missingMessages.length} strings):\n${missingMessages.slice(0, 200).join("\n")}`).toEqual([]);
  });

  it("resolves translations from every supplemental catalogue", () => {
    expect(translate("Playtime", "fr")).toBe("Temps de jeu");
    expect(translate("Search games", "ja")).toBe("ゲームを検索");
    expect(translate("Add a Piko", "de")).toBe("Piko hinzufügen");
    expect(translate("Local-first by design", "es")).toBe("Diseñado para priorizar el uso local");
    expect(translate("Cloud sync active", "de")).toBe("Cloud-Synchronisierung aktiv");
  });

  it("falls back to the original text for unknown messages and unsupported locales", () => {
    expect(translate("A new string")).toBe("A new string");
    expect(translate("Loading…", "not-a-language")).toBe("Loading…");
  });

  it("uses navigation translations from the existing catalogue", () => {
    expect(translate("Library", "fr")).toBe("Bibliothèque");
    expect(translate("Downloads", "ja")).toBe("ダウンロード");
  });
});
