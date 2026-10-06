export type IgdbSettings = {
  clientId: string;
  token: string;
  apiKey?: string;
};

export type IgdbGame = {
  id?: number;
  name: string;
  summary?: string;
  cover?: { url?: string };
  artworks?: Array<{ url?: string }>;
  genres?: Array<{ name: string }>;
  first_release_date?: number;
};

const endpoint = "https://api.igdb.com/v4/games";

async function searchIgdbGames(name: string, settings: IgdbSettings, limit: number): Promise<IgdbGame[]> {
  const credential = settings.token || settings.apiKey;
  if (!name.trim() || !settings.clientId.trim() || !credential?.trim()) return [];
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Client-ID": settings.clientId.trim(),
      Authorization: settings.token ? `Bearer ${settings.token.trim()}` : settings.apiKey!.trim(),
      "Content-Type": "text/plain",
    },
    body: `search "${name.replace(/"/g, '\\"')}"; fields name,summary,cover.url,artworks.url,genres.name,first_release_date; limit ${Math.max(1, Math.min(limit, 10))};`,
  });
  if (!response.ok) throw new Error(`IGDB metadata request failed (${response.status})`);
  return (await response.json()) as IgdbGame[];
}

export async function lookupIgdbGames(name: string, settings: IgdbSettings): Promise<IgdbGame[]> {
  return searchIgdbGames(name, settings, 6);
}

export async function lookupIgdbGame(name: string, settings: IgdbSettings): Promise<IgdbGame | null> {
  const games = await searchIgdbGames(name, settings, 1);
  return games[0] ?? null;
}
