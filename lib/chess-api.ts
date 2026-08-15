const CHESS_API = "https://api.chess.com/pub";

const headers = {
  "User-Agent": "chess-analytics-app/1.0 (contact: mithileshkowshik@gmail.com)",
};

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers, next: { revalidate: 0 } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    return res;
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

export interface ChessGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  start_time: number;
  rated: boolean;
  time_class: "bullet" | "blitz" | "rapid" | "daily";
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

export interface PlayerStats {
  chess_bullet?: { last: { rating: number } };
  chess_blitz?: { last: { rating: number } };
  chess_rapid?: { last: { rating: number } };
}

export async function getPlayerProfile(username: string) {
  const res = await fetchWithRetry(`${CHESS_API}/player/${username}`);
  if (res.status === 404) throw new Error("Player not found");
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status}`);
  return res.json();
}

export async function getPlayerStats(username: string): Promise<PlayerStats> {
  const res = await fetchWithRetry(`${CHESS_API}/player/${username}/stats`);
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status}`);
  return res.json();
}

/** Pulls the year/month off a `.../games/YYYY/MM` archive URL. */
export function parseArchiveUrl(url: string): { year: number; month: number } {
  const parts = url.split("/");
  return {
    year: parseInt(parts[parts.length - 2], 10),
    month: parseInt(parts[parts.length - 1], 10),
  };
}

export async function getArchives(username: string): Promise<string[]> {
  const res = await fetchWithRetry(
    `${CHESS_API}/player/${username}/games/archives`
  );
  if (res.status === 404) throw new Error("Player not found");
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status}`);
  const data = await res.json();
  return data.archives ?? [];
}

export async function getMonthlyGames(
  username: string,
  year: number,
  month: number
): Promise<ChessGame[]> {
  const mm = String(month).padStart(2, "0");
  const res = await fetchWithRetry(
    `${CHESS_API}/player/${username}/games/${year}/${mm}`
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Chess.com API error: ${res.status}`);
  const data = await res.json();
  return data.games ?? [];
}

export async function getGamesForDateRange(
  username: string,
  archives: string[],
  fromTimestamp: number,
  toTimestamp: number
): Promise<ChessGame[]> {
  const relevantArchives = archives.filter((url) => {
    const parts = url.split("/");
    const month = parseInt(parts[parts.length - 1], 10);
    const year = parseInt(parts[parts.length - 2], 10);
    const archiveStart = new Date(year, month - 1, 1).getTime() / 1000;
    const archiveEnd = new Date(year, month, 0, 23, 59, 59).getTime() / 1000;
    return archiveEnd >= fromTimestamp && archiveStart <= toTimestamp;
  });

  const allGames: ChessGame[] = [];
  for (const url of relevantArchives) {
    const parts = url.split("/");
    const month = parseInt(parts[parts.length - 1], 10);
    const year = parseInt(parts[parts.length - 2], 10);
    const games = await getMonthlyGames(username, year, month);
    allGames.push(...games);
    if (relevantArchives.length > 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return allGames.filter(
    (g) => g.end_time >= fromTimestamp && g.end_time <= toTimestamp
  );
}
