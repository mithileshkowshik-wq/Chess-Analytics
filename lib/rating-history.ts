import {
  ChessGame,
  getArchives,
  getMonthlyGames,
  parseArchiveUrl,
} from "./chess-api";
import { getCachedMonthlyGames } from "./cache";
import { GameType } from "./data-processor";

/**
 * Parallel arrays describing one time class, oldest game first.
 * Index `i` is rated game number `i + 1`.
 *
 * `ratings[i]` is the rating Chess.com attaches to that game. The API does not
 * document whether it is the pre- or post-game figure, so treat it as "the
 * rating at that game" rather than "the rating after that game" — worst case
 * the answer is one game's rating change off.
 */
export interface RatingSeries {
  ratings: number[];
  endTimes: number[];
}

export interface RatingHistoryResponse {
  username: string;
  generatedAt: number;
  archiveCount: number;
  /** Rated, standard-chess games only. All three keys are always present. */
  series: Record<GameType, RatingSeries>;
}

const GAME_TYPES: GameType[] = ["bullet", "blitz", "rapid"];

/**
 * Chess.com throttles parallel bursts, so keep this modest. At 4, a 60-archive
 * account takes ~5s versus ~20s serially. Drop to 2-3 if 429s start appearing.
 */
const CONCURRENCY = 4;

/** Beyond this, the fetch cannot finish inside `maxDuration` anyway. */
const MAX_ARCHIVES = 250;

const HISTORY_TTL = 10 * 60 * 1000;
const HISTORY_MAX_ENTRIES = 25;

interface RatedGamePoint {
  endTime: number;
  rating: number;
  url: string;
  type: GameType;
}

/**
 * Caches the *derived* series only — tens of KB each. The raw monthly games
 * (PGN text included) are deliberately not retained; see fetchRatingHistory.
 */
const historyCache = new Map<
  string,
  { data: RatingHistoryResponse; cachedAt: number }
>();

function isCurrentMonth(year: number, month: number) {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() + 1 === month;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i]);
      }
    }
  );

  await Promise.all(workers);
  return out;
}

/**
 * Reduces a month of raw games to the few numbers we need, so the caller can
 * drop the (much larger) ChessGame objects immediately.
 */
function extractPoints(
  games: ChessGame[],
  lowerUsername: string
): RatedGamePoint[] {
  const points: RatedGamePoint[] = [];

  for (const game of games) {
    if (!game.rated) continue;
    // Chess960 and other variants also report time_class "rapid" but are rated
    // in a separate pool — mixing them in would corrupt the series.
    if (game.rules !== "chess") continue;
    if (!GAME_TYPES.includes(game.time_class as GameType)) continue;

    const isWhite = game.white?.username?.toLowerCase() === lowerUsername;
    const isBlack = game.black?.username?.toLowerCase() === lowerUsername;
    // Neither side matches (renamed account, malformed row) — skipping beats
    // silently recording the opponent's rating.
    if (!isWhite && !isBlack) continue;

    const rating = isWhite ? game.white.rating : game.black.rating;
    if (typeof rating !== "number" || rating <= 0) continue;
    if (typeof game.end_time !== "number") continue;

    points.push({
      endTime: game.end_time,
      rating,
      url: game.url ?? "",
      type: game.time_class as GameType,
    });
  }

  return points;
}

export async function fetchRatingHistory(
  username: string
): Promise<RatingHistoryResponse> {
  const key = username.toLowerCase();

  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.cachedAt < HISTORY_TTL) {
    return cached.data;
  }

  const archives = await getArchives(username);
  if (archives.length > MAX_ARCHIVES) {
    throw new Error(
      `This account has ${archives.length} months of history, which is more than this tool can analyse in one request.`
    );
  }

  const months = archives.map(parseArchiveUrl);

  // Any month that fails rejects the whole request. A silently dropped archive
  // would shift every later game number, turning a missing month into a
  // confidently wrong answer.
  const perMonth = await mapWithConcurrency(
    months,
    CONCURRENCY,
    async ({ year, month }) => {
      // Only the current month is worth caching raw: it is the one that keeps
      // changing, and the /games route wants it too. Caching every past month
      // would pin an entire career of PGN text in memory for the life of the
      // process.
      const games = isCurrentMonth(year, month)
        ? await getCachedMonthlyGames(username, year, month)
        : await getMonthlyGames(username, year, month);
      return extractPoints(games, key);
    }
  );

  const points = perMonth.flat();
  // Two games can end in the same second; tie-break on url so the ordering is
  // deterministic across requests.
  points.sort((a, b) => a.endTime - b.endTime || a.url.localeCompare(b.url));

  const series: Record<GameType, RatingSeries> = {
    bullet: { ratings: [], endTimes: [] },
    blitz: { ratings: [], endTimes: [] },
    rapid: { ratings: [], endTimes: [] },
  };

  for (const point of points) {
    series[point.type].ratings.push(point.rating);
    series[point.type].endTimes.push(point.endTime);
  }

  const data: RatingHistoryResponse = {
    username,
    generatedAt: Math.floor(Date.now() / 1000),
    archiveCount: months.length,
    series,
  };

  // Re-insert so the key moves to the end of the iteration order.
  historyCache.delete(key);
  historyCache.set(key, { data, cachedAt: Date.now() });
  if (historyCache.size > HISTORY_MAX_ENTRIES) {
    const oldest = historyCache.keys().next().value;
    if (oldest !== undefined) historyCache.delete(oldest);
  }

  return data;
}
