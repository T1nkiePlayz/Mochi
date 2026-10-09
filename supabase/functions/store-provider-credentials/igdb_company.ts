// `igdb-company`: a launcher's company profile (igdb.com/companies/<slug>) and its logo.
// Pure helpers so they are tested without a database or the network (igdb_company.test.ts).

export type CompanyRequest = { slugs: string[]; names: string[] };
export type Company = { name: string; slug: string; logo: { image_id: string; width?: number; height?: number } | null };

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME = /^[\p{L}\p{N} .,&'!:()-]{1,80}$/u;
const IMAGE_ID = /^[A-Za-z0-9]{1,64}$/;
const MAX_SLUGS = 6;
const MAX_NAMES = 4;

/** Validates the request body; returns an error message for anything outside the allow-list. */
export function parseCompanyRequest(body: { slugs?: unknown; names?: unknown }): CompanyRequest | { error: string } {
  const slugs = body.slugs;
  const names = body.names ?? [];
  if (!Array.isArray(slugs) || slugs.length < 1 || slugs.length > MAX_SLUGS || !slugs.every((slug) => typeof slug === "string" && SLUG.test(slug))) {
    return { error: "IGDB company slugs are invalid." };
  }
  if (!Array.isArray(names) || names.length > MAX_NAMES || !names.every((name) => typeof name === "string" && NAME.test(name))) {
    return { error: "IGDB company names are invalid." };
  }
  return { slugs: [...new Set(slugs as string[])], names: [...new Set(names as string[])] };
}

const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Apicalypse query for `POST /v4/companies`: every company matching one of the slugs or exact names. */
export function companyQuery({ slugs, names }: CompanyRequest): string {
  const conditions = [`slug = (${slugs.map(quote).join(",")})`];
  if (names.length) conditions.push(`name = (${names.map(quote).join(",")})`);
  return `fields name,slug,logo.image_id,logo.width,logo.height; where ${conditions.join(" | ")}; limit ${slugs.length + names.length * 2};`;
}

/** Keeps only the fields Mochi uses, with logo ids that are safe to put in an image URL. */
export function mapCompanies(raw: unknown): Company[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { name, slug, logo } = item as { name?: unknown; slug?: unknown; logo?: { image_id?: unknown; width?: unknown; height?: unknown } | null };
    if (typeof name !== "string" || typeof slug !== "string") return [];
    const imageId = logo && typeof logo.image_id === "string" && IMAGE_ID.test(logo.image_id) ? logo.image_id : null;
    const size = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
    return [{ name: name.slice(0, 120), slug: slug.slice(0, 64), logo: imageId ? { image_id: imageId, width: size(logo?.width), height: size(logo?.height) } : null }];
  });
}
