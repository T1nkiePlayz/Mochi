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

export type ModDependency = { id: string; name?: string; url: string; required: boolean };

export type ModFile = {
  id: string;
  name: string;
  fileName: string;
  version?: string;
  channel?: "release" | "beta" | "alpha";
  size?: number;
  date?: string;
  gameVersions?: string[];
  dependencies?: ModDependency[];
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
  categories(): Promise<ModCategory[]>;
  search(options: ModSearchOptions): Promise<ModPage>;
  details(item: ModItem): Promise<ModDetails>;
  files(item: ModItem, filter?: { gameVersion?: string; loader?: string }): Promise<ModFile[]>;
  resolveDownload(item: ModItem, file: ModFile): Promise<ResolvedDownload>;
}
