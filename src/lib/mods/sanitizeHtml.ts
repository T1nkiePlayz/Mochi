// Pure helpers: no runtime imports so they can be unit tested with plain `node --test`.
// A strict allow-list HTML parser. It never produces markup: the result is a tree of known tags with
// known attributes that the UI turns into React elements, so nothing here can run script or load
// arbitrary resources.

export type SafeNode = string | { tag: string; attrs: Record<string, string>; children: SafeNode[] };

const MAX_INPUT = 300_000;
const MAX_NODES = 12_000;
const MAX_DEPTH = 40;

const VOID = new Set(["br", "hr", "img"]);
const ALLOWED = new Set([
  "p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "strike", "del", "ins", "sub", "sup",
  "ul", "ol", "li", "blockquote", "pre", "code", "kbd", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "details", "summary", "center",
]);
/** Elements whose entire content is discarded, not just the tag. */
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "head", "title", "textarea", "select", "button", "form", "video", "audio", "canvas"]);
const ATTRS: Record<string, string[]> = { a: ["href", "title"], img: ["src", "alt", "title", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] };

/** Hosts that description images may load from (they are also the hosts the app's CSP allows). */
export const IMAGE_HOSTS = [/(^|\.)forgecdn\.net$/, /(^|\.)nexusmods\.com$/, /(^|\.)modrinth\.com$/, /(^|\.)githubusercontent\.com$/, /(^|\.)steamstatic\.com$/];

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", trade: "™" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 && code !== 9 && code !== 10 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) return "";
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** An http(s) URL (protocol-relative becomes https), or null. Rejects every other scheme, including obfuscated ones. */
export function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[\u0000-\u0020\u007f-\u009f]+/g, "");
  const absolute = compact.startsWith("//") ? "https:" + compact : compact;
  if (!/^https?:\/\/[^/?#\s]+/i.test(absolute)) return null;
  try {
    const url = new URL(absolute);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && IMAGE_HOSTS.some((host) => host.test(parsed.hostname));
  } catch { return false; }
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function cleanAttrs(tag: string, raw: Record<string, string>): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const name of ATTRS[tag] ?? []) {
    const value = raw[name];
    if (value === undefined) continue;
    if (name === "href") { const url = safeHttpUrl(value); if (url) out.href = url; }
    else if (name === "src") { const url = safeHttpUrl(value); if (url && isAllowedImageUrl(url)) out.src = url; }
    else if (name === "width" || name === "height" || name === "colspan" || name === "rowspan") { if (/^\d{1,4}$/.test(value)) out[name] = value; }
    else out[name] = value.slice(0, 300);
  }
  if (tag === "img" && !out.src) return null;
  return out;
}

/** Parse untrusted HTML into a tree that only contains allow-listed tags and attributes. */
export function sanitizeHtml(html: string): SafeNode[] {
  const input = html.length > MAX_INPUT ? html.slice(0, MAX_INPUT) : html;
  const root: { tag: string; attrs: Record<string, string>; children: SafeNode[] } = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let count = 0;
  let dropping: string | null = null;
  let dropDepth = 0;
  const top = () => stack[stack.length - 1];
  const pushText = (text: string) => { if (text && count < MAX_NODES) { top().children.push(text); count += 1; } };

  const token = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>|<([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">]){0,2000})>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(input))) {
    if (!dropping) pushText(decodeEntities(input.slice(last, match.index)));
    last = token.lastIndex;
    const closing = match[1]?.toLowerCase();
    const opening = match[2]?.toLowerCase();
    if (dropping) {
      if (opening === dropping && !match[3].endsWith("/")) dropDepth += 1;
      if (closing === dropping && --dropDepth === 0) dropping = null;
      continue;
    }
    if (opening) {
      if (DROP_CONTENT.has(opening)) {
        if (!(match[3] ?? "").trim().endsWith("/")) { dropping = opening; dropDepth = 1; }
        continue;
      }
      if (!ALLOWED.has(opening)) continue;
      if (count >= MAX_NODES) break;
      const attrs = cleanAttrs(opening, parseAttrs(match[3] ?? ""));
      if (!attrs) continue;
      const element = { tag: opening, attrs, children: [] as SafeNode[] };
      top().children.push(element);
      count += 1;
      if (!VOID.has(opening) && stack.length < MAX_DEPTH) stack.push(element);
    } else if (closing && ALLOWED.has(closing)) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tag === closing) { stack.length = index; break; }
      }
    }
  }
  if (!dropping) pushText(decodeEntities(input.slice(last).replace(/<[^>]*$/, "")));
  return root.children;
}

/** Plain text of a sanitized tree; used for summaries and tests. */
export function textOf(nodes: SafeNode[]): string {
  return nodes.map((node) => typeof node === "string" ? node : textOf(node.children)).join("");
}
