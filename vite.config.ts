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
function jsxLocalizationPlugin() {
  const skippedTextTags = new Set(["CodeBlock", "WritingBlock", "AppBlock", "pre", "code", "textarea", "script", "style"]);
  const visibleAttributes = new Set(["aria-label", "aria-description", "aria-valuetext", "title", "placeholder", "alt", "label", "description", "emptyLabel", "confirmLabel", "cancelLabel", "submitLabel", "buttonLabel", "heading", "caption", "tooltip", "helpText"]);

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
        if (!ts.isJsxAttribute(attribute) || !visibleAttributes.has(attribute.name.getText(source)) || !attribute.initializer || !ts.isStringLiteral(attribute.initializer)) return attribute;
        const value = decodeEntities(attribute.initializer.text);
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
          const normalized = normalizeText(node.text);
          const message = decodeEntities(normalized.trim());
          if (!message || !/[\p{L}\p{N}]/u.test(message)) return node;
          return localizedText(message, !node.text.includes("\n") && /^\s/.test(node.text), !node.text.includes("\n") && /\s$/.test(node.text));
        }
        if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression) && !skipText) {
          return localizedText(decodeEntities(node.expression.text), false, false);
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
      const transformed = factory.updateSourceFile(source, [localizedImport, translateImport, ...statements]);
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
          // App code that is large and only needed once a game or mod is involved: keeps the entry chunk under the 500 kB limit.
          if (id.includes("/src/assets/launchers")) return "launcher-art";
          if (id.includes("/src/lib/mods/") || id.includes("/src/lib/nexus") || id.includes("/src/lib/modrinth") || id.includes("/src/lib/curseforge")) return "mods-core";
        },
      },
    },
  },
});
