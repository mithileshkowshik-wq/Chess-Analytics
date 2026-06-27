import { ChessGame, getMonthlyGames } from "./chess-api";

interface CacheEntry {
  games: ChessGame[];
  cachedAt: number;
  isCurrentMonth: boolean;
}

// Module-level cache — survives across requests in a single server process
const cache = new Map<string, CacheEntry>();

const CURRENT_MONTH_TTL = 5 * 60 * 1000; // 5 minutes

function cacheKey(username: string, year: number, month: number) {
  return `${username.toLowerCase()}/${year}/${String(month).padStart(2, "0")}`;
}

function isCurrentMonth(year: number, month: number) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() + 1 === month;
}

export async function getCachedMonthlyGames(
  username: string,
  year: number,
  month: number
): Promise<ChessGame[]> {
  const key = cacheKey(username, year, month);
  const entry = cache.get(key);
  const current = isCurrentMonth(year, month);

  if (entry) {
    const expired = current && Date.now() - entry.cachedAt > CURRENT_MONTH_TTL;
    if (!expired) return entry.games;
  }

  const games = await getMonthlyGames(username, year, month);
  cache.set(key, { games, cachedAt: Date.now(), isCurrentMonth: current });
  return games;
}
