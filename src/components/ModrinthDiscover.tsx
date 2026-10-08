import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Eye, ExternalLink, PackageOpen, Plus, RefreshCw, Search, X } from "lucide-react";
import {
  getModrinthGameVersions,
  getModrinthProject,
  getModrinthVersions,
  getPopularModrinth,
  startModrinthDownload,
  type ModrinthProject,
  type ModrinthProjectDetails,
  type ModrinthProjectType,
} from "../lib/modrinth";
import type { Piko, Tofu } from "../models";
import { formatBytes } from "../lib/format";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getNexusGames, getNexusMods, type NexusGame, type NexusMod, type NexusModSort } from "../lib/nexus";

const sections: Array<{ type: ModrinthProjectType; title: string; description: string }> = [
  { type: "mod", title: "Most Popular Mods", description: "The most downloaded mods on Modrinth right now." },
  { type: "modpack", title: "Most Popular Modpacks", description: "Popular curated packs ready to add to a Tofu." },
  { type: "resourcepack", title: "Most Popular Resource Packs", description: "Popular resource packs, sorted by Modrinth downloads." },
  { type: "shader", title: "Most Popular Shaders", description: "Popular shaders, sorted by Modrinth downloads." },
];

function projectTypeLabel(type: ModrinthProjectType) {
  return type === "resourcepack" ? "Resource Pack" : type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDate(value?: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}


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

function findClosingParenthesis(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "(" && source[index - 1] !== "\\") depth += 1;
    if (source[index] === ")" && source[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findClosingBracket(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "[" && source[index - 1] !== "\\") depth += 1;
    if (source[index] === "]" && source[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseInlineElement(source: string, start: number): { node: ReactNode; end: number } | null {
  if (source.startsWith("![", start)) {
    const labelEnd = findClosingBracket(source, start + 1);
    if (labelEnd < 0 || source[labelEnd + 1] !== "(") return null;
    const urlEnd = findClosingParenthesis(source, labelEnd + 1);
    if (urlEnd < 0) return null;
    const alt = source.slice(start + 2, labelEnd);
    const url = source.slice(labelEnd + 2, urlEnd).trim();
    return { node: <img className="project-markdown-image" src={url} alt={alt} loading="lazy" />, end: urlEnd + 1 };
  }

  if (source[start] === "[") {
    const labelEnd = findClosingBracket(source, start);
    if (labelEnd < 0 || source[labelEnd + 1] !== "(") return null;
    const urlEnd = findClosingParenthesis(source, labelEnd + 1);
    if (urlEnd < 0) return null;
    const label = source.slice(start + 1, labelEnd);
    const url = source.slice(labelEnd + 2, urlEnd).trim();
    return {
      node: <a href={url} target="_blank" rel="noreferrer noopener" onClick={(event) => { event.preventDefault(); void invoke("open_external_url", { url }); }}>{renderInline(label)}</a>,
      end: urlEnd + 1,
    };
  }

  const marker = source.slice(start, start + 2);
  if (marker === "**" || marker === "__" || marker === "~~") {
    const end = findClosingDelimiter(source, start + 2, marker);
    if (end >= 0) {
      const inner = renderInline(source.slice(start + 2, end));
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
    if (end > start + 1) return { node: <em>{renderInline(source.slice(start + 1, end))}</em>, end: end + 1 };
  }

  return null;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  const flushPlain = () => {
    if (plain) {
      nodes.push(<span key={nodes.length}>{plain}</span>);
      plain = "";
    }
  };

  for (let index = 0; index < text.length;) {
    const candidate = parseInlineElement(text, index);
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

function Markdown({ source }: { source: string }) {
  const lines = normalizeMarkdown(source).split(/\n/);
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

function getPrimaryCreator(project: ModrinthProjectDetails) {
  const member = project.members?.find(item => item.accepted !== false) ?? project.members?.[0];
  return {
    name: project.author || member?.user.name || member?.user.username || "",
    avatar: member?.user.avatar_url || "",
  };
}

function MinecraftIcon() {
  return <span className="minecraft-discovery-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="#91b85b" d="m12 1.5 10 4v12.8l-10 4.2-10-4.2V5.5z"/><path fill="#a8d16b" d="m2 5.5 10 4 10-4-10-4z"/><path fill="#5b4128" d="m2 5.5 10 4v13l-10-4.2z"/><path fill="#755536" d="m12 9.5 10-4v12.8l-10 4.2z"/></svg></span>;
}

function DiscoveryImage({ src, className, alt, label }: { src: string; className: string; alt: string; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <span className={`${className} fallback`} aria-label={label}>{label.trim().slice(0, 1).toUpperCase() || <PackageOpen size={18}/>}</span>;
  return <img src={src} className={className} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}


type MinecraftTab = ModrinthProjectType;
type DiscoveryTab = { kind: "all" } | { kind: "minecraft"; category: MinecraftTab } | { kind: "nexus"; game: NexusGame };

const minecraftTabs: Array<{ id: MinecraftTab; label: string }> = [
  { id: "mod", label: "Mods" },
  { id: "modpack", label: "Modpacks" },
  { id: "resourcepack", label: "Resource Packs" },
  { id: "shader", label: "Shaders" },
];

const defaultNexusGames: Array<{ domainName: string; search: string }> = [
  { domainName: "satisfactory", search: "Satisfactory" },
  { domainName: "fnafsecuritybreach", search: "Five Nights at Freddy's Security Breach" },
  { domainName: "subnautica", search: "Subnautica" },
  { domainName: "subnautica2", search: "Subnautica 2" },
  { domainName: "subnauticabelowzero", search: "Subnautica: Below Zero" },
  { domainName: "stardewvalley", search: "Stardew Valley" },
];

const defaultNexusGame = ({ domainName, search }: typeof defaultNexusGames[number]): NexusGame => ({
  id: "",
  domainName,
  name: search,
});

type Props = {
  tofu: Tofu;
  pikos: Piko[];
  playtime?: Array<{ gameId: string; name: string; seconds: number; lastPlayed: number }>;
  experimentalFeatures: boolean;
  nexusConfigured: boolean;
  supabase: SupabaseClient | null;
};

export function ModrinthDiscover({ tofu, pikos, playtime = [], experimentalFeatures, nexusConfigured, supabase }: Props) {
  const [projects, setProjects] = useState<Record<ModrinthProjectType, ModrinthProject[]>>({ mod: [], modpack: [], resourcepack: [], shader: [] });
  const [gameVersion, setGameVersion] = useState(tofu.version === "Local" ? "" : tofu.version);
  const [gameVersions, setGameVersions] = useState<string[]>([]);
  const [loader, setLoader] = useState("");
  const [projectSort, setProjectSort] = useState<"downloads" | "follows">("downloads");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<ModrinthProjectDetails | null>(null);
  const [nexusDetails, setNexusDetails] = useState<{ game: NexusGame; mod: NexusMod } | null>(null);
  const [tofuPicker, setTofuPicker] = useState<ModrinthProject | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [nexusGames, setNexusGames] = useState<NexusGame[]>([]);
  const [nexusModsByGame, setNexusModsByGame] = useState<Record<string, NexusMod[]>>({});
  const [nexusTotalByGame, setNexusTotalByGame] = useState<Record<string, number>>({});
  const [nexusSort, setNexusSort] = useState<NexusModSort>("catalog");
  const [nexusPageSize, setNexusPageSize] = useState(25);
  const [nexusLoading, setNexusLoading] = useState(false);
  const [nexusGameSearch, setNexusGameSearch] = useState("");
  const [nexusGameResults, setNexusGameResults] = useState<NexusGame[]>([]);
  const nexusSearchRequest = useRef(0);
  const nexusRequests = useRef(new Map<string, Promise<NexusMod[]>>());
  const [showNexusGamePicker, setShowNexusGamePicker] = useState(false);
  const [addedNexusDomains, setAddedNexusDomains] = useState<string[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem("mochi:nexus-discovery-games") || "[]") as string[];
    } catch {
      return [];
    }
  });
  const [tab, setTab] = useState<DiscoveryTab>({ kind: "all" });

  const nexusVisible = experimentalFeatures && nexusConfigured && Boolean(supabase);

  const refreshMinecraft = async (sort = projectSort) => {
    setLoading(true);
    setMessage("");
    try {
      const results = await Promise.allSettled(minecraftTabs.map(async ({ id }) => [id, await getPopularModrinth(id, gameVersion, sort)] as const));
      const values = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const available: Record<ModrinthProjectType, ModrinthProject[]> = { mod: [], modpack: [], resourcepack: [], shader: [] };
      setProjects(Object.assign(available, Object.fromEntries(values)));
      const failures = results.filter(result => result.status === "rejected").length;
      if (failures) setMessage(`${failures} Modrinth project category${failures === 1 ? "" : "ies"} could not load. Available categories are still shown.`);
    } finally {
      setLoading(false);
    }
  };

  const refreshNexusGames = async () => {
    if (!nexusVisible || !supabase) return;
    setNexusLoading(true);
    setMessage("");
    try {
      const catalog = await getNexusGames(supabase);
      const byDomain = new Map(catalog.map((game) => [game.domainName, game]));
      const seeded = defaultNexusGames.map((item) => byDomain.get(item.domainName) ?? defaultNexusGame(item));
      const custom = addedNexusDomains
        .map((domain) => byDomain.get(domain) ?? { id: "", name: domain, domainName: domain });
      setNexusGames([...seeded, ...custom.filter(game => !defaultNexusGames.some(item => item.domainName === game.domainName))]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods games.");
      setNexusGames([
        ...defaultNexusGames.map(defaultNexusGame),
        ...addedNexusDomains.map((domainName) => ({ id: "", name: domainName, domainName })),
      ]);
    } finally {
      setNexusLoading(false);
    }
  };

  const searchNexusGames = async (query = nexusGameSearch) => {
    if (!nexusVisible || !supabase) return;
    const requestId = ++nexusSearchRequest.current;
    setNexusLoading(true);
    setMessage("");
    try {
      const games = await getNexusGames(supabase, query);
      if (requestId === nexusSearchRequest.current) setNexusGameResults(games);
    } catch (error) {
      if (requestId === nexusSearchRequest.current) {
        setMessage(error instanceof Error ? error.message : "Unable to search Nexus Mods games.");
        setNexusGameResults([]);
      }
    } finally {
      if (requestId === nexusSearchRequest.current) setNexusLoading(false);
    }
  };

  const refreshNexusMods = async (game: NexusGame, sort = nexusSort, limit = nexusPageSize) => {
    if (!supabase) return;
    const domain = game.domainName;
    setNexusLoading(true);
    setMessage("");
    try {
      const page = await getNexusMods(supabase, domain, { sort, limit });
      setNexusModsByGame(current => ({ ...current, [domain]: page.mods }));
      setNexusTotalByGame(current => ({ ...current, [domain]: page.total }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods.");
      setNexusModsByGame(current => ({ ...current, [domain]: [] }));
    } finally {
      setNexusLoading(false);
    }
  };

  const loadNexusMods = async (game: NexusGame, limit = nexusPageSize) => {
    const cached = nexusModsByGame[game.domainName];
    if (cached && (cached.length >= limit || cached.length >= (nexusTotalByGame[game.domainName] ?? Infinity))) return cached;
    const pending = nexusRequests.current.get(game.domainName);
    if (pending) return pending;
    if (!supabase) return [];
    const offset = cached?.length ?? 0;
    const request = getNexusMods(supabase, game.domainName, { sort: nexusSort, offset, limit: Math.max(8, limit - offset) }).then(page => {
      setNexusTotalByGame(current => ({ ...current, [game.domainName]: page.total }));
      setNexusModsByGame(current => ({ ...current, [game.domainName]: [...(current[game.domainName] || []), ...page.mods] }));
      return page.mods;
    });
    nexusRequests.current.set(game.domainName, request);
    try {
      const mods = await request;
      return [...(cached || []), ...mods];
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Nexus Mods.");
      setNexusModsByGame(current => ({ ...current, [game.domainName]: [] }));
      return [];
    } finally {
      nexusRequests.current.delete(game.domainName);
    }
  };

  useEffect(() => {
    void getModrinthGameVersions().then(versions => {
      setGameVersions(versions);
      if (tofu.version !== "Local" && versions.includes(tofu.version)) setGameVersion(tofu.version);
    }).catch(() => setGameVersions(tofu.version === "Local" ? [] : [tofu.version]));
  }, [tofu.version]);

  useEffect(() => {
    if (nexusVisible) void refreshNexusGames();
    else {
      setNexusGames([]);
      setNexusGameResults([]);
      setNexusModsByGame({});
      if (tab.kind === "nexus") setTab({ kind: "all" });
    }
  }, [nexusVisible, addedNexusDomains.join("|")]);

  useEffect(() => {
    if (!showNexusGamePicker || !nexusVisible) return;
    const timer = window.setTimeout(() => void searchNexusGames(nexusGameSearch), nexusGameSearch.trim() ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [showNexusGamePicker, nexusVisible, nexusGameSearch]);

  useEffect(() => {
    if (!nexusVisible || tab.kind !== "nexus") return;
    setNexusModsByGame(current => {
      const next = { ...current };
      delete next[tab.game.domainName];
      return next;
    });
    void refreshNexusMods(tab.game, nexusSort, nexusPageSize);
  }, [nexusVisible, tab.kind === "nexus" ? tab.game.domainName : "", nexusSort, nexusPageSize]);

  useEffect(() => {
    if (nexusVisible && tab.kind === "all") {
      for (const game of nexusGames) void loadNexusMods(game, 8);
    }
  }, [nexusVisible, nexusGames.map(game => game.domainName).join("|"), tab.kind]);

  const loadMoreNexusMods = async (game: NexusGame) => {
    const current = nexusModsByGame[game.domainName] || [];
    if (!supabase || nexusSort === "trending" || current.length >= 200 || current.length >= (nexusTotalByGame[game.domainName] ?? Infinity) || moreLoading) return;
    setMoreLoading(true);
    setMessage("");
    try {
      const page = await getNexusMods(supabase, game.domainName, { sort: "catalog", offset: current.length, limit: Math.min(nexusPageSize, 200 - current.length) });
      setNexusModsByGame(previous => ({ ...previous, [game.domainName]: [...(previous[game.domainName] || []), ...page.mods] }));
      setNexusTotalByGame(previous => ({ ...previous, [game.domainName]: page.total }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load more Nexus Mods.");
    } finally {
      setMoreLoading(false);
    }
  };

  useEffect(() => { void refreshMinecraft(); }, [gameVersion, projectSort]);

  useEffect(() => {
    window.localStorage.setItem("mochi:nexus-discovery-games", JSON.stringify(addedNexusDomains));
  }, [addedNexusDomains]);

  const install = async (project: ModrinthProject, target: Tofu) => {
    if (!target.path) { setMessage("This Tofu does not have an install location yet."); return; }
    setBusyId(project.project_id);
    setMessage("");
    try {
      const versions = await getModrinthVersions(project.project_id, target.version === "Local" ? undefined : target.version, project.project_type === "mod" ? loader || undefined : undefined);
      const version = versions.find(item => item.files.length > 0);
      const file = version?.files.find(item => item.primary) ?? version?.files[0];
      if (!file || !version) throw new Error("No compatible Modrinth file was found for this Tofu.");
      await startModrinthDownload(file.url, target.path, target.id, target.name, project.title, file.filename);
      setMessage("Queued " + project.title + " for " + target.name + ".");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue this download.");
    } finally { setBusyId(""); }
  };

  const matches = (project: ModrinthProject) => {
    const value = query.trim().toLowerCase();
    return !value || project.title.toLowerCase().includes(value) || project.description.toLowerCase().includes(value);
  };
  const nexusMatches = (mod: NexusMod) => {
    const value = query.trim().toLowerCase();
    return !value || mod.name.toLowerCase().includes(value) || (mod.summary || "").toLowerCase().includes(value) || (mod.author || "").toLowerCase().includes(value);
  };

  const addNexusGame = (game: NexusGame) => {
    setNexusGames(current => current.some(item => item.domainName === game.domainName) ? current : [...current, game]);
    if (!defaultNexusGames.some(item => item.domainName === game.domainName)) {
      setAddedNexusDomains(current => current.includes(game.domainName) ? current : [...current, game.domainName]);
    }
    setShowNexusGamePicker(false);
    setNexusGameSearch("");
    setNexusGameResults([]);
    setQuery("");
    setTab({ kind: "nexus", game });
  };

  const gameTabs = nexusVisible ? nexusGames : [];
  const recentPlay = [...playtime].sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 3);
  const playedPikos = recentPlay.map(entry => pikos.find(piko => piko.id === entry.gameId)).filter((piko): piko is Piko => Boolean(piko));
  const playedCategories = [...new Set(playedPikos.flatMap(piko => piko.categories || []))].map(value => value.toLowerCase());
  const suggestedGames = [...gameTabs]
    .map(game => ({ game, score: playedCategories.filter(category => game.genre?.toLowerCase().includes(category)).length * 1000 + (game.modCount || 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(item => item.game);
  const loadMoreProjects = async () => {
    const category = tab.kind === "minecraft" ? tab.category : "mod";
    const current = projects[category];
    if (current.length >= 200 || moreLoading) return;
    setMoreLoading(true);
    setMessage("");
    try {
      const more = await getPopularModrinth(category, gameVersion, projectSort, current.length);
      setProjects(previous => ({ ...previous, [category]: [...previous[category], ...more] }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load more Modrinth projects.");
    } finally {
      setMoreLoading(false);
    }
  };

  const renderNexusMod = (game: NexusGame, mod: NexusMod, index: number) => <article className="discover-card" key={mod.id || mod.modPageUrl}>
    {mod.pictureUrl ? <DiscoveryImage src={mod.pictureUrl} alt="" className="discover-card-icon" label={mod.name}/> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}
    <div className="discover-card-copy"><div className="discover-card-title"><strong>{index + 1}. {mod.name}</strong><span>Nexus Mods</span></div><small>{game.name} · {mod.author || "Nexus Mods creator"}</small><p>{mod.summary || "No summary was provided by Nexus Mods."}</p><div className="discover-card-actions"><button type="button" className="secondary-button" onClick={() => setNexusDetails({ game, mod })}><Eye size={13}/> View</button><button type="button" className="secondary-button" onClick={() => void invoke("open_external_url", { url: mod.modPageUrl })}><ExternalLink size={13}/> Open on Nexus</button></div></div>
  </article>;

  return <>
    <section className="modrinth-discover">
      <div className="discover-header">
        <div><p className="eyebrow">Discovery</p><h2>Discover</h2><p>Browse community content from the platforms and games available to your Mochi setup.</p></div>
        <button className="secondary-button" onClick={() => tab.kind === "nexus" ? void refreshNexusMods(tab.game) : void refreshMinecraft()} disabled={loading || nexusLoading}>
          {(loading || nexusLoading) ? <RefreshCw size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
        </button>
      </div>

      <div className="discover-game-tabs" role="tablist" aria-label="Game discovery">
        <button className={tab.kind === "all" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "all"} onClick={() => { setQuery(""); setTab({ kind: "all" }); }}>All</button>
        <button className={tab.kind === "minecraft" ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-label="Minecraft" title="Minecraft" aria-selected={tab.kind === "minecraft"} onClick={() => { setQuery(""); setTab({ kind: "minecraft", category: "mod" }); }}>
          <MinecraftIcon /><span className="discover-game-name">Minecraft</span>
        </button>
        {gameTabs.map(game => <button key={game.domainName} className={tab.kind === "nexus" && tab.game.domainName === game.domainName ? "discover-game-tab active" : "discover-game-tab"} type="button" role="tab" aria-selected={tab.kind === "nexus" && tab.game.domainName === game.domainName} onClick={() => { setQuery(""); setTab({ kind: "nexus", game }); }}>
          {game.iconUrl ? <DiscoveryImage src={game.iconUrl} className="discover-game-icon" alt="" label={game.name} /> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}
          <span className="discover-game-name">{game.name}</span>
        </button>)}
        {nexusVisible && <button className="discover-game-add" type="button" title="Search and add a Nexus Mods game" aria-label="Search and add a Nexus Mods game" onClick={() => { setNexusGameSearch(""); setNexusGameResults([]); setMessage(""); setShowNexusGamePicker(true); }}><Plus size={17} /></button>}
      </div>

      {tab.kind === "all" ? <>
        {message && <p className="metadata-note" role="alert">{message}</p>}
        <section className="discover-section"><div className="discover-section-heading"><div><h3>Popular Minecraft mods</h3><p>The most downloaded Minecraft mods from Modrinth.</p></div><button className="text-button" type="button" onClick={() => setTab({ kind: "minecraft", category: "mod" })}>Browse Minecraft</button></div>
          {loading ? <div className="discover-loading"><RefreshCw size={18} className="spin"/><span>Loading Minecraft mods...</span></div> : <div className="discover-grid">{projects.mod.slice(0, 8).map((project, index) => <article className="discover-card" key={project.project_id}>{project.icon_url ? <DiscoveryImage src={project.icon_url} className="discover-card-icon" alt="" label={project.title}/> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}<div className="discover-card-copy"><div className="discover-card-title"><strong>{index + 1}. {project.title}</strong><span>Modrinth</span></div><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p><div className="discover-card-actions"><button className="secondary-button" onClick={() => void openDetails(project)}><Eye size={13}/> View</button><button className="secondary-button" onClick={() => setTofuPicker(project)}><Download size={13}/> Choose Tofu</button></div></div></article>)}</div>}
        </section>
        {nexusVisible && gameTabs.map(game => {
          const mods = nexusModsByGame[game.domainName] || [];
          return <section className="discover-section all-game-section" key={game.domainName}><div className="discover-section-heading"><div><h3>{game.name}</h3><p>Game catalog · showing {Math.min(mods.length, 8)} of {(nexusTotalByGame[game.domainName] || mods.length).toLocaleString()} mods{game.genre ? ` · ${game.genre}` : ""}</p></div><button className="text-button" type="button" onClick={() => setTab({ kind: "nexus", game })}>Browse</button></div>
            {!Object.prototype.hasOwnProperty.call(nexusModsByGame, game.domainName) ? <div className="discover-loading"><RefreshCw size={16} className="spin"/><span>Loading {game.name}...</span></div> : mods.length ? <div className="discover-grid">{mods.slice(0, 8).map((mod, index) => renderNexusMod(game, mod, index))}</div> : <div className="discover-empty">Nexus Mods did not return mods for {game.name}.</div>}
          </section>;
        })}
        {nexusVisible && <section className="discover-section suggested-games"><div className="discover-section-heading"><div><h3>Suggested games</h3><p>{playedPikos.length ? `Based on ${playedPikos[0].name} and your ${playedCategories[0] || "recent play"} interests.` : "Popular games to explore on Nexus Mods."}</p></div></div><div className="suggested-game-list">{suggestedGames.map(game => <button type="button" className="suggested-game-card" key={game.domainName} onClick={() => { setQuery(""); setTab({ kind: "nexus", game }); }}>{game.iconUrl ? <DiscoveryImage src={game.iconUrl} className="discover-game-icon" alt="" label={game.name}/> : <span className="discover-game-icon fallback">{game.name.slice(0, 1)}</span>}<span><strong>{game.name}</strong><small>{game.genre || `${(game.modCount || 0).toLocaleString()} mods on Nexus`}</small></span><span className="text-button">Browse</span></button>)}</div></section>}
      </> : tab.kind === "minecraft" ? <>
        <div className="discover-tabs" role="tablist" aria-label="Minecraft content categories">
          {minecraftTabs.map(item => <button key={item.id} className={tab.category === item.id ? "active" : ""} type="button" role="tab" aria-selected={tab.category === item.id} onClick={() => setTab({ kind: "minecraft", category: item.id })}>{item.label}</button>)}
        </div>
        <div className="discover-controls">
          <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + (minecraftTabs.find(item => item.id === tab.category)?.label || "content").toLowerCase() + "..."} /></label>
          <label className="discover-select-wrap"><span>Minecraft</span><select className="discover-select" value={gameVersion} onChange={event => setGameVersion(event.target.value)}><option value="">All versions</option>{gameVersions.map(version => <option key={version} value={version}>{version}</option>)}</select></label>
          {tab.category === "mod" && <label className="discover-select-wrap"><span>Loader</span><select className="discover-select" value={loader} onChange={event => setLoader(event.target.value)}><option value="">Any loader</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option><option value="quilt">Quilt</option></select></label>}
          <label className="discover-select-wrap"><span>Sort</span><select className="discover-select" value={projectSort} onChange={event => setProjectSort(event.target.value as "downloads" | "follows")}><option value="downloads">Most downloaded</option><option value="follows">Most followed</option></select></label>
        </div>
        {message && <p className="metadata-note">{message}</p>}
        {loading ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>Loading popular Minecraft content from Modrinth...</span></div> : (() => {
          const section = sections.find(item => item.type === tab.category)!;
          const visible = projects[tab.category].filter(matches);
          return <div className="discover-sections"><section className="discover-section">
            <div className="discover-section-heading"><div><h3>{section.title}</h3><p>{section.description}</p></div><span>{visible.length} projects</span></div>
            <div className="discover-grid">{visible.map((project,index) => <article className="discover-card" key={project.project_id}>{project.icon_url ? <DiscoveryImage src={project.icon_url} alt="" className="discover-card-icon" label={project.title}/> : <div className="discover-card-icon fallback"><PackageOpen size={20}/></div>}<div className="discover-card-copy"><div className="discover-card-title"><strong>{index+1}. {project.title}</strong><span>{projectTypeLabel(project.project_type)}</span></div><small>{project.author || "Modrinth creator"} · {project.downloads.toLocaleString()} downloads</small><p>{project.description}</p><div className="discover-card-actions"><button className="secondary-button" onClick={() => void openDetails(project)}><Eye size={13}/> View</button><button className="secondary-button" onClick={() => setTofuPicker(project)} disabled={busyId !== ""}><Download size={13}/> Choose Tofu instance</button></div></div></article>)}</div>
            {projects[tab.category].length >= 100 && projects[tab.category].length < 200 && <div className="discover-load-more"><button className="secondary-button" type="button" onClick={() => void loadMoreProjects()} disabled={moreLoading}>{moreLoading ? <RefreshCw size={14} className="spin"/> : <Plus size={14}/>} {moreLoading ? "Loading more..." : "Load 100 more"}</button></div>}
            {!visible.length && <div className="discover-empty">No popular {projectTypeLabel(tab.category)} projects match this filter.</div>}
          </section></div>;
        })()}
      </> : <>
        <div className="discover-controls nexus-discover-controls">
          <label className="search-box"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={"Search " + tab.game.name + " mods..."} /></label>
          <label className="discover-select-wrap"><span>Sort</span><select className="discover-select" value={nexusSort} onChange={event => { setNexusModsByGame({}); setNexusTotalByGame({}); setNexusSort(event.target.value as NexusModSort); }}><option value="catalog">All mods</option><option value="trending">Trending popularity</option></select></label>
          {nexusSort === "catalog" && <label className="discover-select-wrap"><span>Show</span><select className="discover-select" value={nexusPageSize} onChange={event => { setNexusModsByGame({}); setNexusTotalByGame({}); setNexusPageSize(Number(event.target.value)); }}><option value={8}>8 per page</option><option value={25}>25 per page</option><option value={50}>50 per page</option><option value={100}>100 per page</option></select></label>}
        </div>
        {message && <p className="metadata-note">{message}</p>}
        {nexusLoading || !Object.prototype.hasOwnProperty.call(nexusModsByGame, tab.game.domainName) ? <div className="discover-loading"><RefreshCw size={20} className="spin" /><span>{nexusSort === "trending" ? "Loading trending mods from Nexus Mods..." : "Loading the Nexus Mods game catalog..."}</span></div> : (() => {
          const visible = (nexusModsByGame[tab.game.domainName] || []).filter(nexusMatches);
          const total = nexusTotalByGame[tab.game.domainName] ?? visible.length;
          return <div className="discover-sections"><section className="discover-section">
            <div className="discover-section-heading"><div><h3>{tab.game.name} Mods</h3><p>{nexusSort === "trending" ? "Nexus trending feed, ranked by endorsements (top 5)." : `Game catalog · showing up to 200 of ${total.toLocaleString()} mods.`}</p></div><span>{visible.length} shown</span></div>
            <div className="discover-grid">{visible.map((mod,index) => renderNexusMod(tab.game, mod, index))}</div>
            {nexusSort === "catalog" && (nexusModsByGame[tab.game.domainName]?.length || 0) < Math.min(200, total) && <div className="discover-load-more"><button className="secondary-button" type="button" onClick={() => void loadMoreNexusMods(tab.game)} disabled={moreLoading}>{moreLoading ? <RefreshCw size={14} className="spin"/> : <Plus size={14}/>} {moreLoading ? "Loading more..." : `Load ${Math.min(nexusPageSize, 200 - (nexusModsByGame[tab.game.domainName]?.length || 0))} more`}</button></div>}
            {!visible.length && <div className="discover-empty">No mods match this filter.</div>}
          </section></div>;
        })()}
      </>}
    </section>
    {details && <ProjectDetails project={details} gameVersion={gameVersion} onClose={() => setDetails(null)} />}
    {nexusDetails && <NexusModDetails game={nexusDetails.game} mod={nexusDetails.mod} onClose={() => setNexusDetails(null)} />}
    {tofuPicker && <TofuPicker project={tofuPicker} pikos={pikos} onClose={() => setTofuPicker(null)} onInstall={(target) => { setTofuPicker(null); void install(tofuPicker, target); }} />}
    {showNexusGamePicker && <NexusGamePicker games={nexusGameResults} search={nexusGameSearch} setSearch={setNexusGameSearch} onClose={() => { setShowNexusGamePicker(false); setNexusGameSearch(""); }} onChoose={addNexusGame} loading={nexusLoading} error={message} />}
  </>;

  async function openDetails(project: ModrinthProject) {
    setMessage("");
    try {
      const detail = await getModrinthProject(project.project_id);
      setDetails({ ...project, ...detail, author: project.author || detail.author });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load project details."); }
  }
}

function NexusGamePicker({ games, search, setSearch, onClose, onChoose, loading, error }: { games: NexusGame[]; search: string; setSearch: (value: string) => void; onClose: () => void; onChoose: (game: NexusGame) => void; loading: boolean; error: string }) {
  const value = search.trim().toLowerCase();
  const visible = games.filter(game => !value || game.name.toLowerCase().includes(value) || game.domainName.toLowerCase().includes(value));
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window nexus-game-picker-window" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div><p className="eyebrow">Nexus Mods</p><h2>Add a game</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div>
    <p className="modal-description">Search the Nexus Mods game catalog and add a game as a permanent Discovery tab.</p>
    <label className="search-box nexus-game-search"><Search size={15}/><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder="Search Nexus games..." /></label>
    {error && <p className="metadata-note" role="alert">{error}</p>}
    {loading ? <div className="discover-loading"><RefreshCw size={18} className="spin" /><span>Loading games...</span></div> : <div className="nexus-game-picker-list">{visible.slice(0, 30).map(game => <button key={game.domainName} className="nexus-game-picker-row" type="button" onClick={() => onChoose(game)}>
      {game.iconUrl ? <img src={game.iconUrl} alt="" /> : <span>{game.name.slice(0, 1)}</span>}<div><strong>{game.name}</strong><small>{game.domainName}{game.modCount ? " · " + game.modCount.toLocaleString() + " mods" : ""}</small></div><Plus size={15}/>
    </button>)}{!visible.length && <div className="discover-empty">No Nexus Mods games match your search.</div>}</div>}
  </div></div>;
}

function ProjectDetails({ project, gameVersion, onClose }: { project: ModrinthProjectDetails; gameVersion: string; onClose: () => void }) {
  const [tab, setTab] = useState<"overview" | "versions">("overview");
  const [versions, setVersions] = useState<import("../lib/modrinth").ModrinthVersion[]>([]);
  useEffect(() => { void getModrinthVersions(project.project_id, gameVersion || undefined).then(setVersions).catch(() => setVersions([])); }, [project.project_id, gameVersion]);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window" onMouseDown={event => event.stopPropagation()}>
    <div className="project-details-header"><div>{project.icon_url ? <DiscoveryImage src={project.icon_url} alt="" className="discover-card-icon" label={project.title}/> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}<div><p className="eyebrow">{projectTypeLabel(project.project_type)}</p><h2>{project.title}</h2><p>{project.description}</p><small>Created by <strong>{getPrimaryCreator(project).name || "Unknown creator"}</strong> · {project.downloads.toLocaleString()} downloads</small></div></div><div className="project-details-header-actions"><button type="button" className="secondary-button" onClick={() => { const url = `https://modrinth.com/${project.project_type}/${project.slug}`; void invoke("open_external_url", { url }); }}><ExternalLink size={13}/> View on Modrinth</button><button className="icon-button" onClick={onClose} aria-label="Close project details"><X size={17}/></button></div></div>
    <div className="project-tabs"><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="versions"?"active":""} onClick={()=>setTab("versions")}>Versions</button></div>
    {tab==="overview" ? <div className="project-overview">
      <section className="project-creator-primary">
        <div className="project-creator-primary-avatar">
          {getPrimaryCreator(project).avatar
            ? <img src={getPrimaryCreator(project).avatar} alt="" />
            : <div className="project-creator-primary-fallback">{(getPrimaryCreator(project).name || "?").slice(0, 1).toUpperCase()}</div>}
        </div>
        <div><span>Created by</span><strong>{getPrimaryCreator(project).name || "Unknown creator"}</strong></div>
      </section>
      <div className="project-info-grid">
        <span><strong>Downloads</strong>{project.downloads.toLocaleString()}</span>
        <span><strong>Followers</strong>{(project.followers||0).toLocaleString()}</span>
        <span><strong>Project type</strong>{projectTypeLabel(project.project_type)}</span>
        <span><strong>Categories</strong>{project.categories?.join(", ")||"Not provided"}</span>
        <span><strong>License</strong>{project.license?.name||"Not provided"}</span>
        <span><strong>Members</strong>{project.members?.length ?? 0}</span>
      </div>
      <h3 className="project-overview-heading">Overview</h3>
      <Markdown source={project.body || project.description} />
      {project.members?.length ? <section className="project-creators">
        <div className="project-creators-heading"><div><h3>Creators & contributors</h3><p>{project.members.length} team member{project.members.length === 1 ? "" : "s"} credited on Modrinth.</p></div></div>
        <div className="project-creator-grid">{project.members.map(member => <div className="project-creator" key={member.user.id}>
          <img src={member.user.avatar_url} alt="" />
          <div><strong>{member.user.name || member.user.username}</strong><small>@{member.user.username} · {member.role}</small></div>
        </div>)}</div>
      </section> : null}
    </div> : <div className="project-version-list">{versions.length ? versions.map(version=><div className="project-version" key={version.id}><div><strong>{version.name || version.version_number}</strong><small><strong>{version.version_number}</strong> · {version.version_type || "release"} · Published {formatDate(version.date_published)}</small><small>Minecraft: {version.game_versions.join(", ") || "Unknown"} · Loaders: {version.loaders.join(", ") || "Unknown"} · {version.files.length} file{version.files.length === 1 ? "" : "s"} · {version.dependencies.length} dependenc{version.dependencies.length === 1 ? "y" : "ies"}</small>{version.changelog ? <details><summary>Changelog</summary><Markdown source={version.changelog} /></details> : null}<details><summary>Files</summary><div className="project-file-list">{version.files.map(file => <div key={file.filename}><span>{file.filename}</span><small>{formatBytes(file.size)}{file.primary ? " · Primary" : ""}</small></div>)}</div></details></div><span>{version.files.length} file{version.files.length===1?"":"s"}</span></div>) : <div className="discover-empty">No versions found for this Minecraft version.</div>}</div>}
  </div></div>;
}

function NexusModDetails({ game, mod, onClose }: { game: NexusGame; mod: NexusMod; onClose: () => void }) {
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="project-details-window nexus-mod-details" role="dialog" aria-modal="true" aria-label={`${mod.name} details`} onMouseDown={event => event.stopPropagation()}>
    <div className="project-details-header"><div>{mod.pictureUrl ? <DiscoveryImage src={mod.pictureUrl} alt="" className="discover-card-icon" label={mod.name}/> : <div className="discover-card-icon fallback"><PackageOpen size={26}/></div>}<div><p className="eyebrow">{game.name} · Nexus Mods</p><h2>{mod.name}</h2><p>{mod.summary || "No summary was provided by Nexus Mods."}</p><small>Created by <strong>{mod.author || "Unknown creator"}</strong></small></div></div><button className="icon-button" onClick={onClose} aria-label="Close mod details"><X size={17}/></button></div>
    <div className="project-overview"><h3>About this mod</h3><p className="nexus-mod-summary">{mod.summary || "Nexus Mods does not provide a description in its public trending feed."}</p><p className="metadata-note">Open the Nexus page for full description, files, requirements, and installation instructions.</p><button type="button" className="secondary-button" onClick={() => void invoke("open_external_url", { url: mod.modPageUrl })}><ExternalLink size={14}/> Open on Nexus</button></div>
  </div></div>;
}

function TofuPicker({ project, pikos, onClose, onInstall }: { project: ModrinthProject; pikos: Piko[]; onClose: () => void; onInstall: (tofu: Tofu) => void }) {
  const tofus = pikos.flatMap(piko => piko.tofus || []);
  return <div className="discover-modal-backdrop" onMouseDown={onClose}><div className="tofu-picker-window" onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><p className="eyebrow">Install {project.title}</p><h2>Choose Tofu instance</h2></div><button className="icon-button" onClick={onClose}><X size={17}/></button></div><p className="modal-description">Choose the Minecraft instance that should receive this download.</p>{tofus.length ? <div className="tofu-picker-list">{tofus.map(tofu=><div className="tofu-picker-row" key={tofu.id}><div><strong>{tofu.name}</strong><small>{tofu.version} · {tofu.runtime}{tofu.path ? "" : " · No install location"}</small></div><button className="secondary-button" title={"Download to " + tofu.name} disabled={!tofu.path} onClick={()=>onInstall(tofu)}><Plus size={15}/></button></div>)}</div> : <div className="discover-empty">No Minecraft instances were found.</div>}</div></div>;
}
