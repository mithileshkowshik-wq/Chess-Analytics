import { fetchGameFacts } from "./game-facts";
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

const HISTORY_TTL = 10 * 60 * 1000;
const HISTORY_MAX_ENTRIES = 25;

const historyCache = new Map<
  string,
  { data: RatingHistoryResponse; cachedAt: number }
>();

/**
 * A projection of the shared game-facts store. Both live on the same
 * dashboard, so deriving here means one walk of the archives instead of two.
 */
export async function fetchRatingHistory(
  username: string
): Promise<RatingHistoryResponse> {
  const key = username.toLowerCase();

  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.cachedAt < HISTORY_TTL) {
    return cached.data;
  }

  const facts = await fetchGameFacts(username);

  const series: Record<GameType, RatingSeries> = {
    bullet: { ratings: [], endTimes: [] },
    blitz: { ratings: [], endTimes: [] },
    rapid: { ratings: [], endTimes: [] },
  };

  for (const game of facts.games) {
    series[game.timeClass].ratings.push(game.myRating);
    series[game.timeClass].endTimes.push(game.endTime);
  }

  const data: RatingHistoryResponse = {
    username,
    generatedAt: facts.generatedAt,
    archiveCount: facts.archiveCount,
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
