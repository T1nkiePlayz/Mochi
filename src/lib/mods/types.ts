import type { EcosystemRef } from "./gameSupport";

export type ModSourceId = "modrinth" | "curseforge" | "nexus";

export const sourceLabels: Record<ModSourceId, string> = { modrinth: "Modrinth", curseforge: "CurseForge", nexus: "Nexus Mods" };

/** One mod (or pack, shader...) in a list. `native` carries the provider's own record for the other calls. */
export type ModItem = {
  source: ModSourceId;
  id: string;
  name: string;
  summary: string;
  author?: string;
  iconUrl?: string;
  downloads?: number;
  /** The mod's page on the provider's site. */
  pageUrl: string;
  /** Provider label such as "Mods" or "Shaders". */
  kind?: string;
  /** The game the mod belongs to, set in lists that mix several games (Discover > All). */
  game?: string;
  /** Which Tofus fit this item when it differs from the list's own game (mixed lists). */
  ecosystem?: EcosystemRef;
  native: unknown;
};

export type ModSort = { value: string; label: string };
export type ModCategory = { id: string; name: string; parentId?: string };

export type ModSearchOptions = {
  query: string;
  offset: number;
  limit: number;
  sort: string;
  categoryId?: string;
  gameVersion?: string;
  loader?: string;
};

export type ModPage = { items: ModItem[]; total: number; nextOffset: number; hasMore: boolean };

export type ModDependency = {
  id: string; name?: string; url: string; required: boolean;
  /** A specific version of the dependency the author pinned (Modrinth). */
  versionId?: string;
  /** Not a mod of this source (Nexus requirement on another site or game): only a link, never installed. */
  external?: boolean;
  /** Which game's domain the dependency lives in (Nexus); absent means the source's own game. */
  gameDomain?: string;
};

export type ModFile = {
  id: string;
  name: string;
  fileName: string;
  version?: string;
  channel?: "release" | "beta" | "alpha";
  size?: number;
  date?: string;
  gameVersions?: string[];
  /** Mod loaders the file was built for, when the source says (Modrinth). CurseForge mixes them into `gameVersions`; use `metaFromModFile`. */
  loaders?: string[];
  /** Required dependencies. */
  dependencies?: ModDependency[];
  /** Mods the author marked as incompatible with this file. */
  incompatibles?: ModDependency[];
  primary?: boolean;
  native: unknown;
};

export type ModDetails = {
  body: { kind: "html" | "markdown"; text: string } | null;
  facts: Array<{ label: string; value: string }>;
};

export type ResolvedDownload = {
  url?: string;
  fileName: string;
  sha1?: string;
  size?: number;
  /** The author disabled downloads outside the provider's site. */
  restricted?: boolean;
  /** Direct download needs a Nexus Premium membership (or an nxm:// link). */
  needsPremium?: boolean;
  reason?: string;
  /** Where the user can get the file by hand. */
  pageUrl: string;
};

/** Common face of Modrinth, CurseForge and Nexus Mods, already scoped to one game or project type. */
export interface ModSource {
  readonly id: ModSourceId;
  readonly label: string;
  readonly siteUrl: string;
  readonly sorts: ModSort[];
  readonly defaultSort: string;
  /** False when the provider cannot search by text, so the query only filters what was already loaded. */
  readonly searchesServerSide: boolean;
  /** True once the list also holds mods from other sites (auto-extend), so cards show which site each came from. */
  readonly mixed?: boolean;
  categories(): Promise<ModCategory[]>;
  search(options: ModSearchOptions): Promise<ModPage>;
  details(item: ModItem): Promise<ModDetails>;
  files(item: ModItem, filter?: { gameVersion?: string; loader?: string }): Promise<ModFile[]>;
  resolveDownload(item: ModItem, file: ModFile): Promise<ResolvedDownload>;
  /** Requirements that belong to the whole mod rather than to a file (Nexus). Optional. */
  requirements?(item: ModItem): Promise<{ required: ModDependency[]; incompatible?: ModDependency[] }>;
  /** The listed mod behind a dependency, so its files can be looked up and installed. Optional; without it dependencies are only links. */
  dependencyItem?(dependency: ModDependency): Promise<ModItem | null>;
}
