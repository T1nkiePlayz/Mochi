import { createElement, memo, useMemo, type ReactNode } from "react";
import { openExternalUrl } from "../../lib/platform";
import { sanitizeHtml, type SafeNode } from "../../lib/mods/sanitizeHtml";

function render(nodes: SafeNode[], onLink: (url: string) => void, path = ""): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${path}${index}`;
    if (typeof node === "string") return node;
    if (node.tag === "a") {
      const href = node.attrs.href;
      return href
        ? <a key={key} href={href} title={node.attrs.title} rel="noopener noreferrer nofollow" onClick={(event) => { event.preventDefault(); onLink(href); }}>{render(node.children, onLink, key + ".")}</a>
        : <span key={key}>{render(node.children, onLink, key + ".")}</span>;
    }
    if (node.tag === "img") return <img key={key} src={node.attrs.src} alt={node.attrs.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
    const attrs: Record<string, unknown> = { key };
    if (node.attrs.colspan) attrs.colSpan = Number(node.attrs.colspan);
    if (node.attrs.rowspan) attrs.rowSpan = Number(node.attrs.rowspan);
    return createElement(node.tag, attrs, ...(node.tag === "br" || node.tag === "hr" ? [] : render(node.children, onLink, key + ".")));
  });
}

/** Author-written HTML (CurseForge, Nexus) shown through the strict allow-list sanitizer; never as raw markup. */
export const SafeHtml = memo(function SafeHtml({ html }: { html: string }) {
  const tree = useMemo(() => sanitizeHtml(html), [html]);
  return <div className="project-markdown mod-html">{render(tree, (url) => void openExternalUrl(url).catch(() => undefined))}</div>;
});
