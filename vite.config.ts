import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * Puts every launcher stylesheet into a cascade layer so themes (which load in the later `theme` / `user` layers)
 * always win over launcher defaults, while src/styles/layout.css (layer `layout`, !important guards) protects the shell.
 * Order is declared in index.html and src/styles/layers.css: reset < tokens < base < layout < theme < user.
 */
function layerPlugin() {
  return {
    postcssPlugin: "mochi-layers",
    Once(root: { source?: { input?: { file?: string } }; nodes: unknown[]; removeAll(): void; append(node: unknown): void }, { AtRule }: { AtRule: new (init: { name: string; params: string }) => { append(nodes: unknown[]): void } }) {
      const file = (root.source?.input?.file ?? "").replace(/\\/g, "/");
      if (!file.includes("/src/") || /fonts\.generated\.css$|\/layout\.css$|\/layers\.css$/.test(file)) return;
      const layer = new AtRule({ name: "layer", params: /\/tokens\.css$/.test(file) ? "tokens" : "base" });
      const nodes = [...root.nodes];
      root.removeAll();
      layer.append(nodes);
      root.append(layer);
    },
  };
}
layerPlugin.postcss = true;

/**
 * Routes literal JSX copy through LocalizedText automatically, so new UI strings cannot
 * bypass the translation catalogue simply because a component author forgot a wrapper.
 * Source code blocks and editable text are deliberately excluded.
 */
export function jsxLocalizationPlugin() {
  const skippedTextTags = new Set(["CodeBlock", "WritingBlock", "AppBlock", "pre", "code", "textarea", "script", "style", "kbd"]);
  const visibleAttributes = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "placeholder", "alt", "label", "description", "emptyLabel", "confirmLabel", "cancelLabel", "submitLabel", "buttonLabel", "heading", "caption", "tooltip", "helpText"]);
  // State setters below feed visible feedback, not JSX literal text.
  const uiMessageSetters = new Set(["setMessage", "setError", "setLaunchError", "setAuthNotice", "setNote", "setNotice", "setFeedback", "setSuccess", "setWarning", "setProblem", "setStatusMessage", "setErrorMessage"]);

  function normalizeText(value: string): string {
    const lines = value.split(/\r?\n/);
    const normalized = lines.map((line, index) => {
      let part = line.replace(/\t/g, " ");
      if (index > 0) part = part.replace(/^\s+/, "");
      if (index < lines.length - 1) part = part.replace(/\s+$/, "");
      return part;
    }).filter((part) => part.length > 0);
    return normalized.join(" ");
  }

  function decodeEntities(value: string): string {
    return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  }

  return {
    name: "mochi-jsx-localization",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const filename = id.split("?")[0].replace(/\\/g, "/");
      if (!filename.includes("/src/") || !filename.endsWith(".tsx") || filename.endsWith("/LocalizedText.tsx") || /\.test\.tsx$/.test(filename)) return null;

      const source = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let changed = false;
      let changedSetter = false;
      const factory = ts.factory;

      const localizedText = (message: string, before: boolean, after: boolean) => {
        const attributes = [
          factory.createJsxAttribute(factory.createIdentifier("message"), factory.createStringLiteral(message)),
          ...(before ? [factory.createJsxAttribute(factory.createIdentifier("spaceBefore"), factory.createJsxExpression(undefined, factory.createTrue()))] : []),
          ...(after ? [factory.createJsxAttribute(factory.createIdentifier("spaceAfter"), factory.createJsxExpression(undefined, factory.createTrue()))] : []),
        ];
        changed = true;
        return factory.createJsxSelfClosingElement(factory.createIdentifier("LocalizedText"), undefined, factory.createJsxAttributes(attributes));
      };

      const visitAttributes = (attributes: ts.JsxAttributes): ts.JsxAttributes => factory.updateJsxAttributes(attributes, attributes.properties.map((attribute) => {
        if (!ts.isJsxAttribute(attribute) || !visibleAttributes.has(attribute.name.getText(source)) || !attribute.initializer) return attribute;
        // JSX allows visible attribute strings as either plain literals or literal expressions.
        // Leave dynamic expressions (IDs, state and interpolation) untouched.
        const initializer = attribute.initializer;
        const literalValue = ts.isStringLiteral(initializer)
          ? initializer.text
          : ts.isJsxExpression(initializer) && initializer.expression && ts.isStringLiteralLike(initializer.expression)
            ? initializer.expression.text
            : null;
        if (literalValue === null) return attribute;
        const value = decodeEntities(literalValue);
        changed = true;
        return factory.updateJsxAttribute(attribute, attribute.name, factory.createJsxExpression(undefined, factory.createCallExpression(factory.createIdentifier("translate"), undefined, [factory.createStringLiteral(value)])));
      }));

      const visitNode = (node: ts.Node, skipText = false): ts.Node => {
        if (ts.isJsxElement(node)) {
          const tag = node.openingElement.tagName.getText(source);
          const skipChildren = skipText || skippedTextTags.has(tag);
          const opening = factory.updateJsxOpeningElement(node.openingElement, node.openingElement.tagName, node.openingElement.typeArguments, visitAttributes(node.openingElement.attributes));
          const children = node.children.map((child) => visitNode(child, skipChildren) as ts.JsxChild);
          const closing = factory.updateJsxClosingElement(node.closingElement, node.closingElement.tagName);
          return factory.updateJsxElement(node, opening, children, closing);
        }
        if (ts.isJsxSelfClosingElement(node)) {
          return factory.updateJsxSelfClosingElement(node, node.tagName, node.typeArguments, visitAttributes(node.attributes));
        }
        if (ts.isJsxFragment(node)) {
          const children = node.children.map((child) => visitNode(child, skipText) as ts.JsxChild);
          return factory.updateJsxFragment(node, node.openingFragment, children, node.closingFragment);
        }
        if (ts.isJsxText(node) && !skipText) {
          const normalized = decodeEntities(normalizeText(node.text));
          const message = normalized.trim();
          if (!message || !/[\p{L}\p{N}]/u.test(message) || /^(?:--?[\w-]+)(?:\s+--?[\w-]+)*$/.test(message) || /^https?:\/\//i.test(message)) return node;
          // Preserve significant spaces even when JSX formatting introduces a newline.
          // Checking the raw node only works for single-line text and joins adjacent
          // dynamic expressions together in multiline JSX.
          return localizedText(message, /^\s/.test(normalized), /\s$/.test(normalized));
        }
        if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression) && !skipText) {
          return localizedText(decodeEntities(node.expression.text), false, false);
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && uiMessageSetters.has(node.expression.text) && node.arguments.length > 0) {
          const first = node.arguments[0];
          const alreadyTranslated = ts.isCallExpression(first) && ts.isIdentifier(first.expression) && first.expression.text === "translateUiMessage";
          if (alreadyTranslated || ts.isArrowFunction(first) || ts.isFunctionExpression(first) || first.kind === ts.SyntaxKind.NullKeyword || first.kind === ts.SyntaxKind.TrueKeyword || first.kind === ts.SyntaxKind.FalseKeyword || (ts.isStringLiteralLike(first) && !first.text.trim())) return node;
          changed = true;
          changedSetter = true;
          const translated = factory.createCallExpression(factory.createIdentifier("translateUiMessage"), undefined, [first]);
          return factory.updateCallExpression(node, node.expression, node.typeArguments, [translated, ...node.arguments.slice(1)]);
        }
        return ts.visitEachChild(node, (child) => visitNode(child, skipText), context);
      };

      const context = ts.nullTransformationContext;
      const statements = source.statements.map((statement) => visitNode(statement) as ts.Statement);
      if (!changed) return null;
      const relative = path.relative(path.dirname(filename), path.resolve("src/components/LocalizedText")).replace(/\\/g, "/");
      const importPath = relative.startsWith(".") ? relative : "./" + relative;
      const localizedImport = factory.createImportDeclaration(
        undefined,
        factory.createImportClause(false, undefined, factory.createNamedImports([factory.createImportSpecifier(false, undefined, factory.createIdentifier("LocalizedText"))])),
        factory.createStringLiteral(importPath),
        undefined,
      );
      const translateImport = factory.createImportDeclaration(
        undefined,
        factory.createImportClause(false, undefined, factory.createNamedImports([factory.createImportSpecifier(false, undefined, factory.createIdentifier("translate"))])),
        factory.createStringLiteral(path.relative(path.dirname(filename), path.resolve("src/lib/i18n")).replace(/\\/g, "/").replace(/^([^.]|$)/, "./$1")),
        undefined,
      );
      const messageImport = factory.createImportDeclaration(
        undefined,
        factory.createImportClause(false, undefined, factory.createNamedImports([factory.createImportSpecifier(false, undefined, factory.createIdentifier("translateUiMessage"))])),
        factory.createStringLiteral(path.relative(path.dirname(filename), path.resolve("src/lib/i18n")).replace(/\\/g, "/").replace(/^([^.]|$)/, "./$1")),
        undefined,
      );
      const transformed = factory.updateSourceFile(source, [localizedImport, translateImport, ...(changedSetter ? [messageImport] : []), ...statements]);
      return { code: ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed), map: null };
    },
  };
}


export default defineConfig({
  plugins: [jsxLocalizationPlugin(), react()],
  css: { postcss: { plugins: [layerPlugin()] } },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@supabase/")) return "supabase";
          if (id.includes("/node_modules/lucide-react/")) return "icons";
          if (id.includes("/node_modules/react-dom/") || id.includes("/node_modules/react/")) return "react";
          // Keep translation catalogues out of the app entry. The lookup is synchronous,
          // so they are all needed at startup; isolate the largest catalogues and group smaller
          // ones by feature. This avoids dozens of tiny eager chunks without creating oversized bundles.
          if (id.includes("/src/lib/i18n") && !id.includes(".test.")) {
            const fileName = path.basename(id, path.extname(id));
            const standaloneChunks: Record<string, string> = {
              i18nCommonPart2: "translations-common-part2",
              i18nAudit: "translations-audit",
              i18nRecentUi: "translations-recent-ui",
              i18nMetadataPart2: "translations-metadata-part2",
              i18nMetadataPart1: "translations-metadata-part1",
              i18nUiExtra: "translations-ui-extra",
              i18nCommonPart1: "translations-common-part1",
              i18nSettingsRecent: "translations-settings-recent",
              i18nSettings: "translations-settings-core",
              i18nInstalled: "translations-installed",
              i18nStats: "translations-stats",
              i18nLongHelp: "translations-long-help",
              i18nAccessibilitySettings: "translations-accessibility-settings",
            };
            const standaloneChunk = standaloneChunks[fileName];
            if (standaloneChunk) return standaloneChunk;
            if (fileName === "i18n") return "translations-core";
            if (/^i18n(?:Setup|CloudSetup|AccountSetup|ServiceSetup|Chrome|AccountHardware|Accessibility)/.test(fileName)) return "translations-setup";
            if (/^i18n(?:Settings|Controls|Navigation|Keyboard|Launch|UpdateArtwork|ArtworkSources|ExportShare|PickerGuidance|EditFilter|SavedFilter)/.test(fileName)) return "translations-settings";
            if (/^i18n(?:Library|Downloads|Mod|Tofu|Save|Saves|Duplicates)/.test(fileName)) return "translations-content";
            if (/^i18n(?:Discover|Discovery|Project|Deals|Metadata|Stats)/.test(fileName)) return "translations-discovery";
            return "translations-common";
          }
          // App code that is large and only needed once a game or mod is involved: keeps the entry chunk under the 500 kB limit.
          if (id.includes("/src/assets/launchers")) return "launcher-art";
          if (id.includes("/src/lib/mods/") || id.includes("/src/lib/nexus") || id.includes("/src/lib/modrinth") || id.includes("/src/lib/curseforge")) return "mods-core";
        },
      },
    },
  },
});
