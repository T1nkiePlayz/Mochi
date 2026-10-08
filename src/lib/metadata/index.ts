import { igdbProvider } from "./igdbProvider";
import { steamProvider } from "./steam";
import { steamGridDbProvider } from "./steamgriddb";
import type { MetadataProvider, ProviderId } from "./types";

export const providers: Record<ProviderId, MetadataProvider> = { igdb: igdbProvider, steamgriddb: steamGridDbProvider, steam: steamProvider };
export * from "./types";
export * from "./merge";
