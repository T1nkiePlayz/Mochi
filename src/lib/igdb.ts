export type IgdbSettings = {
  clientId: string;
  token: string;
  apiKey?: string;
};

export type IgdbGame = {
  name: string;
  summary?: string;
  cover?: { url?: string };
  artworks?: Array<{ url?: string }>;
  genres?: Array<{ name: string }>;
};

const endpoint = "https://api.igdb.com/v4/games";

export async function lookupIgdbGame(name: string, settings: IgdbSettings): Promise<IgdbGame | null> {
  const credential = settings.token || settings.apiKey;
  if (!name.trim() || !settings.clientId.trim() || !credential?.trim()) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Client-ID": settings.clientId.trim(),
      Authorization: settings.token ? `Bearer ${settings.token.trim()}` : settings.apiKey!.trim(),
      "Content-Type": "text/plain",
    },
    body: `search "${name.replace(/"/g, '\\"')}"; fields name,summary,cover.url,artworks.url,genres.name; limit 1;`,
  });
  if (!response.ok) throw new Error(`IGDB metadata request failed (${response.status})`);
  const games = (await response.json()) as IgdbGame[];
  return games[0] ?? null;
}
