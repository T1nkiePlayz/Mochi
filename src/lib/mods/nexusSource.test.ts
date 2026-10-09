import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickUpdate } from "./updates";

vi.mock("../nexus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../nexus")>()),
  // The edge function reports `uploadedAt` as unix seconds (0 when unknown), not as text.
  getNexusFiles: vi.fn(async () => [
    { fileId: 11, name: "Main", fileName: "main-2.zip", version: "2.0", category: "main", sizeKb: 10, uploadedAt: 1_740_000_000, primary: true },
    { fileId: 12, name: "Old", fileName: "old.zip", version: "0.1", category: "old", sizeKb: 1, uploadedAt: 0, primary: false },
  ]),
}));

const { createNexusSource } = await import("./nexusSource");

describe("Nexus file dates", () => {
  it("are ISO text, so records serialize and update checks can compare them", async () => {
    const source = createNexusSource({} as SupabaseClient, { domain: "skyrim", name: "Skyrim" });
    const files = await source.files({ source: "nexus", id: "5", name: "Mod", summary: "", pageUrl: "", native: {} });
    expect(files[0].date).toBe("2025-02-19T21:20:00.000Z");
    expect(typeof files[0].date).toBe("string");
    expect(files[1].date).toBeUndefined();
    // An installed older file (dated by the MD5 lookup) is offered the newer Nexus file.
    expect(pickUpdate({ fileId: "9", fileDate: "2024-01-01T00:00:00.000Z" }, files, {})?.id).toBe("11");
  });
});
