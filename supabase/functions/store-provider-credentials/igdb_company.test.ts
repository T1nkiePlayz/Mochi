import { assertEquals } from "jsr:@std/assert@1";
import { companyQuery, mapCompanies, parseCompanyRequest } from "./igdb_company.ts";

Deno.test("company requests are allow-listed", () => {
  assertEquals(parseCompanyRequest({ slugs: ["steam", "valve", "steam"], names: ["Valve"] }), { slugs: ["steam", "valve"], names: ["Valve"] });
  assertEquals(parseCompanyRequest({ slugs: ["gog-dot-com"] }), { slugs: ["gog-dot-com"], names: [] });
  for (const body of [
    {}, { slugs: [] }, { slugs: "steam" }, { slugs: ["Steam"] }, { slugs: ["a\"; fields *"] }, { slugs: ["-x"] },
    { slugs: Array.from({ length: 7 }, (_, i) => `s${i}`) }, { slugs: ["ok"], names: ["x\"; where id = 1"] }, { slugs: ["ok"], names: "Valve" },
    { slugs: ["ok"], names: ["a", "b", "c", "d", "e"] }, { slugs: ["ok"], names: [""] },
  ]) {
    assertEquals("error" in parseCompanyRequest(body as never), true, JSON.stringify(body));
  }
  assertEquals("error" in parseCompanyRequest({ slugs: ["ok"], names: ["GOG sp. z o.o.", "Blizzard Entertainment"] }), false);
});

Deno.test("company queries match slugs or exact names", () => {
  assertEquals(companyQuery({ slugs: ["steam", "valve"], names: ["Valve"] }), 'fields name,slug,logo.image_id,logo.width,logo.height; where slug = ("steam","valve") | name = ("Valve"); limit 4;');
  assertEquals(companyQuery({ slugs: ["jagex"], names: [] }), 'fields name,slug,logo.image_id,logo.width,logo.height; where slug = ("jagex"); limit 1;');
});

Deno.test("company responses are reduced to safe fields", () => {
  assertEquals(mapCompanies([
    { id: 1, name: "Valve", slug: "valve", logo: { id: 9, image_id: "cl1abc", width: 400, height: 200 }, websites: [1] },
    { name: "No logo", slug: "none" },
    { name: "Bad logo", slug: "bad", logo: { image_id: "../../x" } },
    { slug: "no-name" },
    "junk",
  ]), [
    { name: "Valve", slug: "valve", logo: { image_id: "cl1abc", width: 400, height: 200 } },
    { name: "No logo", slug: "none", logo: null },
    { name: "Bad logo", slug: "bad", logo: null },
  ]);
  assertEquals(mapCompanies({ message: "error" }), []);
});
