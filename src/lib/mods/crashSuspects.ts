// Reads a game log or crash report and names the installed mods it points at, so a crash can be answered with
// "switch this mod off" instead of a wall of stack trace. Pure: no Tauri, React or network. It only ever suggests;
// the user decides (the fix button is the same switch-off used by the pre-launch check, and it is reversible).
import type { CheckEntry, Issue } from "./conflicts";

export type Suspect = { entry: CheckEntry; name: string; confidence: "exact" | "likely"; evidence: string };

/** Ids that name the loader, the game or a library every modded game has, never a mod the user can blame. */
const NOT_MODS = new Set(["minecraft", "java", "fabric", "fabricloader", "fabric-loader", "fabricapi", "fabric-api", "quilt", "quilt_loader", "forge", "neoforge", "fml", "mixin", "mixinextras", "loom", "mod", "mods", "unknown", "lwjgl", "netty", "log4j", "guava", "gson", "jna", "sun", "oshi", "javafx"]);
const MAX_SCAN = 400_000;
const MAX_SUSPECTS = 5;

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const baseName = (name: string) => name.replace(/\.disabled$/i, "").replace(/\.jar$/i, "");
/** The leading word of a file name: "sodium-fabric-0.5.jar" gives "sodium". */
const firstToken = (name: string) => norm(baseName(name).split(/[-_ .+[\]()]/)[0] ?? "");

type Mention = { id: string; evidence: string; file?: boolean };

function mentions(log: string): Mention[] {
  const text = log.length > MAX_SCAN ? log.slice(-MAX_SCAN) : log;
  const lines = text.split(/\r?\n/);
  const out: Mention[] = [];
  const add = (id: string | undefined, line: string, file = false) => {
    const value = (id ?? "").trim();
    if (value.length < 2 || value.length > 80) return;
    if (!file && NOT_MODS.has(value.toLowerCase())) return;
    out.push({ id: value, evidence: line.trim().slice(0, 200), file });
  };
  let suspectedLines = 0;
  for (const line of lines) {
    // Forge / NeoForge crash reports list "Suspected Mods:" then one "Name (modid)" per line.
    if (/suspected mods?:/i.test(line)) suspectedLines = 6;
    else if (suspectedLines > 0) { suspectedLines = /^\s*$/.test(line) ? 0 : suspectedLines - 1; }
    if (suspectedLines > 0) for (const match of line.matchAll(/\(([a-z][a-z0-9_.-]{1,63})\)/g)) add(match[1], line);
    for (const match of line.matchAll(/Mod '[^']+' \(([a-z][a-z0-9_.-]*)\)/g)) add(match[1], line);
    for (const match of line.matchAll(/provided by '([a-z][a-z0-9_.-]*)'/g)) add(match[1], line);
    for (const match of line.matchAll(/\[([a-z][a-z0-9_.-]*)\.mixins?\.json[:\]]/gi)) add(match[1], line);
    for (const match of line.matchAll(/([a-z][a-z0-9_.-]*)\.mixins?\.json/gi)) if (/mixin/i.test(line) && /(fail|error|exception|crash|could not|unable)/i.test(line)) add(match[1], line);
    for (const match of line.matchAll(/from mod ([a-z][a-z0-9_.-]*)/gi)) add(match[1], line);
    // A jar the loader names while complaining about it ("Mod File: ...", "Failed to load ...jar").
    if (/(mod file|failed|error|exception|crash|caused by|invalid|duplicate|could not)/i.test(line)) {
      for (const match of line.matchAll(/([^\\/\s"'`:<>|]+\.jar)\b/g)) add(match[1], line, true);
    }
  }
  return out;
}

/** The installed, switched-on mods a log points at, strongest evidence first. */
export function crashSuspects(log: string | null | undefined, entries: readonly CheckEntry[]): Suspect[] {
  if (!log) return [];
  const candidates = entries.filter((entry) => !entry.foreign && entry.enabled && !entry.record?.extracted && /\.jar$/i.test(entry.filename));
  if (!candidates.length) return [];
  const found = new Map<CheckEntry, Suspect>();
  const remember = (entry: CheckEntry, confidence: Suspect["confidence"], evidence: string) => {
    const previous = found.get(entry);
    if (!previous || (previous.confidence === "likely" && confidence === "exact")) found.set(entry, { entry, name: entry.record?.title?.trim() || baseName(entry.filename), confidence, evidence });
  };
  for (const mention of mentions(log)) {
    if (mention.file) {
      const wanted = mention.id.toLowerCase();
      for (const entry of candidates) if (entry.filename.toLowerCase() === wanted) remember(entry, "exact", mention.evidence);
      continue;
    }
    const id = norm(mention.id);
    if (id.length < 3 || NOT_MODS.has(id)) continue;
    for (const entry of candidates) {
      const title = norm(entry.record?.title ?? "");
      const project = norm(entry.record?.projectId ?? "");
      const file = norm(baseName(entry.filename));
      const exact = title === id || project === id || firstToken(entry.filename) === id;
      const likely = id.length >= 5 && (file.startsWith(id) || title.startsWith(id));
      if (exact || likely) remember(entry, exact ? "exact" : "likely", mention.evidence);
    }
  }
  const rank = (suspect: Suspect) => (suspect.confidence === "exact" ? 0 : 1);
  return [...found.values()].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_SUSPECTS);
}

/** The suspects as rows for the conflict list, each with a switch-off button. */
export function suspectIssues(suspects: readonly Suspect[]): Issue[] {
  return suspects.map(({ entry, name, confidence, evidence }) => ({
    id: `crash-suspect:${entry.filename}`,
    kind: "crash-suspect" as const,
    severity: "warning" as const,
    title: `${name} is named in the log`,
    detail: `${confidence === "exact" ? "The log names this mod directly" : "The log mentions something that looks like this mod"}: “${evidence}”. Switching it off and launching again shows whether it is the cause.`,
    files: [entry.filename],
    actions: entry.path ? [{ kind: "disable" as const, label: `Disable ${name}`, paths: [entry.path] }] : [],
  }));
}
