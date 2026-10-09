import { invoke } from "@tauri-apps/api/core";
import type { ReactNode } from "react";
import { safeHttpUrl } from "../../lib/mods/sanitizeHtml";

/** Project descriptions are remote; cap their size and nesting so crafted text cannot freeze or overflow the renderer. */
const MAX_SOURCE = 50_000;
const MAX_DEPTH = 6;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeMarkdown(source: string): string {
  return decodeHtmlEntities(
    source
      .replace(/\r/g, "")
      .replace(/<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi, (_match, before, src, after) => {
        const attributes = before + after;
        const alt = attributes.match(/\balt=["']([^"']*)["']/i)?.[1] || "";
        return "\n![" + alt + "](" + src + ")\n";
      })
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => "\n" + "#".repeat(Number(level)) + " " + body + "\n")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1\n")
      .replace(/<\/?(?:ul|ol|p|div|section|article|center|figure|figcaption)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function findClosingDelimiter(source: string, start: number, delimiter: string): number {
  let index = start;
  while (index < source.length) {
    const found = source.indexOf(delimiter, index);
    if (found < 0) return -1;
    if (found === start || source[found - 1] !== "\\") return found;
    index = found + delimiter.length;
  }
  return -1;
}

/**
 * Index of the matching close for every unescaped "[" and "(" in one pass (-1 when unclosed).
 * Scanning forward from each opener instead is quadratic: a description full of "[" froze rendering.
 */
type Matches = { brackets: Int32Array; parens: Int32Array };

function matchPairs(source: string): Matches {
  const brackets = new Int32Array(source.length).fill(-1);
  const parens = new Int32Array(source.length).fill(-1);
  const openBrackets: number[] = [];
  const openParens: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (source[index - 1] === "\\") continue;
    if (char === "[") openBrackets.push(index);
    else if (char === "]" && openBrackets.length) brackets[openBrackets.pop()!] = index;
    else if (char === "(") openParens.push(index);
    else if (char === ")" && openParens.length) parens[openParens.pop()!] = index;
  }
  return { brackets, parens };
}

const closing = (pairs: Int32Array, source: string, start: number, open: string) =>
  source[start] === open && source[start - 1] !== "\\" ? pairs[start] : -1;

function parseInlineElement(source: string, start: number, depth: number, matches: Matches): { node: ReactNode; end: number } | null {
  if (source.startsWith("![", start)) {
    const labelEnd = closing(matches.brackets, source, start + 1, "[");
    if (labelEnd < 0 || source[labelEnd + 1] !== "(") return null;
    const urlEnd = closing(matches.parens, source, labelEnd + 1, "(");
    if (urlEnd < 0) return null;
    const alt = source.slice(start + 2, labelEnd);
    const url = safeHttpUrl(source.slice(labelEnd + 2, urlEnd).trim());
    // Only http(s) images load; anything else (data:, file:, javascript:) is shown as its alt text.
    if (!url) return { node: alt, end: urlEnd + 1 };
    return { node: <img className="project-markdown-image" src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" />, end: urlEnd + 1 };
  }

  if (source[start] === "[") {
    const labelEnd = closing(matches.brackets, source, start, "[");
    if (labelEnd < 0 || source[labelEnd + 1] !== "(") return null;
    const urlEnd = closing(matches.parens, source, labelEnd + 1, "(");
    if (urlEnd < 0) return null;
    const label = source.slice(start + 1, labelEnd);
    const url = safeHttpUrl(source.slice(labelEnd + 2, urlEnd).trim());
    // Links to other schemes (file:, mochi:, javascript:...) are shown as plain text instead of being opened.
    if (!url) return { node: <>{renderInline(label, depth + 1)}</>, end: urlEnd + 1 };
    return {
      node: <a href={url} target="_blank" rel="noreferrer noopener" onClick={(event) => { event.preventDefault(); void invoke("open_external_url", { url }).catch(() => undefined); }} onAuxClick={(event) => event.preventDefault()}>{renderInline(label, depth + 1)}</a>,
      end: urlEnd + 1,
    };
  }

  const marker = source.slice(start, start + 2);
  if (marker === "**" || marker === "__" || marker === "~~") {
    const end = findClosingDelimiter(source, start + 2, marker);
    if (end >= 0) {
      const inner = renderInline(source.slice(start + 2, end), depth + 1);
      if (marker === "~~") return { node: <del>{inner}</del>, end: end + 2 };
      return { node: <strong>{inner}</strong>, end: end + 2 };
    }
  }

  if (source[start] === "`") {
    const end = source.indexOf("`", start + 1);
    if (end > start + 1) return { node: <code>{source.slice(start + 1, end)}</code>, end: end + 1 };
  }

  if (source[start] === "*" || source[start] === "_") {
    const delimiter = source[start];
    const end = findClosingDelimiter(source, start + 1, delimiter);
    if (end > start + 1) return { node: <em>{renderInline(source.slice(start + 1, end), depth + 1)}</em>, end: end + 1 };
  }

  return null;
}

function renderInline(text: string, depth = 0): ReactNode[] {
  if (depth > MAX_DEPTH) return [text];
  const nodes: ReactNode[] = [];
  let plain = "";
  const flushPlain = () => {
    if (plain) {
      nodes.push(<span key={nodes.length}>{plain}</span>);
      plain = "";
    }
  };

  const matches = matchPairs(text);
  for (let index = 0; index < text.length;) {
    const candidate = parseInlineElement(text, index, depth, matches);
    if (candidate) {
      flushPlain();
      nodes.push(<span key={nodes.length}>{candidate.node}</span>);
      index = candidate.end;
      continue;
    }
    plain += text[index];
    index += 1;
  }

  flushPlain();
  return nodes;
}

export function Markdown({ source }: { source: string }) {
  const lines = normalizeMarkdown(source.length > MAX_SOURCE ? source.slice(0, MAX_SOURCE) : source).split(/\n/);
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let paragraphLines: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    nodes.push(<p key={"paragraph-" + nodes.length}>{renderInline(paragraphLines.join(" "))}</p>);
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length) {
      nodes.push(<ul key={"unordered-" + nodes.length}>{listItems.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ul>);
      listItems = [];
    }
    if (orderedItems.length) {
      nodes.push(<ol key={"ordered-" + nodes.length}>{orderedItems.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</ol>);
      orderedItems = [];
    }
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    nodes.push(<pre key={"code-" + nodes.length}><code>{codeLines.join("\n")}</code></pre>);
    codeLines = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith(String.fromCharCode(96).repeat(3))) {
      flushParagraph();
      flushList();
      if (inCodeBlock) flushCode();
      inCodeBlock = !inCodeBlock;
      return;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      return;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)/);
    if (unordered) {
      flushParagraph();
      orderedItems = [];
      listItems.push(unordered[1]);
      return;
    }
    if (ordered) {
      flushParagraph();
      listItems = [];
      orderedItems.push(ordered[1]);
      return;
    }

    flushList();
    const heading = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      const Heading = ("h" + Math.min(heading[1].length + 1, 6)) as keyof JSX.IntrinsicElements;
      nodes.push(<Heading key={"heading-" + index}>{renderInline(heading[2])}</Heading>);
      return;
    }
    if (/^>\s?/.test(trimmed)) {
      nodes.push(<blockquote key={"quote-" + index}>{renderInline(trimmed.replace(/^>\s?/, ""))}</blockquote>);
      return;
    }
    if (/^---+$/.test(trimmed)) {
      nodes.push(<hr key={"rule-" + index} />);
      return;
    }
    paragraphLines.push(trimmed);
  });

  flushParagraph();
  flushList();
  if (inCodeBlock) flushCode();
  return <div className="project-markdown">{nodes}</div>;
}
