import {
  ChessGame,
  getArchives,
  getMonthlyGames,
  parseArchiveUrl,
} from "./chess-api";
import { getCachedMonthlyGames } from "./cache";
import { GameType, getGameDuration } from "./data-processor";
import { parseOpening, parsePgnHeaders } from "./pgn";

export type Outcome = "win" | "loss" | "draw";
export type Color = "white" | "black";

export type Termination =
  | "checkmate"
  | "resignation"
  | "timeout"
  | "abandonment"
  | "agreement"
  | "repetition"
  | "stalemate"
  | "insufficient_material"
  | "timeout_vs_insufficient"
  | "fifty_move"
  | "other";

/**
 * One rated, standard-chess game in bullet/blitz/rapid where this player was
 * one of the two sides. Those filters are an invariant of the array this lives
 * in, which is why `rated` and `rules` are not fields.
 *
 * `myRating` is the rating Chess.com attaches to the game. The API does not
 * document whether it is the pre- or post-game figure, so treat it as "the
 * rating at that game" — worst case one game's rating change off.
 */
export interface GameFact {
  endTime: number;
  timeClass: GameType;
  color: Color;
  myRating: number;
  oppRating: number | null;
  oppUsername: string;
  outcome: Outcome;
  termination: Termination;
  terminationRaw: string;
  eco: string | null;
  openingName: string | null;
  openingKey: string;
  openingFamily: string;
  timeControl: string;
  durationSeconds: number;
  url: string;
}

export interface GameFactsResult {
  username: string;
  generatedAt: number;
  archiveCount: number;
  firstGameTime: number | null;
  lastGameTime: number | null;
  /** Ascending by endTime, tie-broken by url. */
  games: GameFact[];
  /** Indices into `games`. `byType.rapid[799]` is rated rapid game #800. */
  byType: Record<GameType, number[]>;
}

const GAME_TYPES: GameType[] = ["bullet", "blitz", "rapid"];

const CONCURRENCY = 4;
const MAX_ARCHIVES = 250;
const FACTS_TTL = 10 * 60 * 1000;

/**
 * Far lower than the derived rating-history cache: a full-career GameFact[] is
 * on the order of a megabyte, versus tens of KB for the ratings arrays.
 */
const FACTS_MAX_ENTRIES = 5;

const factsCache = new Map<
  string,
  { data: GameFactsResult; cachedAt: number }
>();

/** Draw reasons appear identically on both players' `result` fields. */
const DRAW_RESULTS = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

const TERMINATION_BY_RAW: Record<string, Termination> = {
  checkmated: "checkmate",
  resigned: "resignation",
  timeout: "timeout",
  abandoned: "abandonment",
  agreed: "agreement",
  repetition: "repetition",
  stalemate: "stalemate",
  insufficient: "insufficient_material",
  timevsinsufficient: "timeout_vs_insufficient",
  "50move": "fifty_move",
};

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
 * Collapses repeated strings onto shared references. Opening names, time
 * controls, termination reasons and opponent names come from a small
 * vocabulary, so this is the difference between ~800 and ~250 bytes per game.
 */
function makeInterner() {
  const pool = new Map<string, string>();
  return (value: string): string => {
    const hit = pool.get(value);
    if (hit !== undefined) return hit;
    pool.set(value, value);
    return value;
  };
}

function extractFacts(
  games: ChessGame[],
  lowerUsername: string,
  intern: (s: string) => string
): GameFact[] {
  const facts: GameFact[] = [];

  for (const game of games) {
    // These five filters must stay identical to the ones the rating series
    // depends on — any drift shifts every game number.
    if (!game.rated) continue;
    if (game.rules !== "chess") continue;
    if (!GAME_TYPES.includes(game.time_class as GameType)) continue;

    const isWhite = game.white?.username?.toLowerCase() === lowerUsername;
    const isBlack = game.black?.username?.toLowerCase() === lowerUsername;
    if (!isWhite && !isBlack) continue;

    const me = isWhite ? game.white : game.black;
    const opp = isWhite ? game.black : game.white;

    if (typeof me.rating !== "number" || me.rating <= 0) continue;
    if (typeof game.end_time !== "number") continue;

    const myRaw = (me.result ?? "").toLowerCase();
    const oppRaw = (opp?.result ?? "").toLowerCase();

    const outcome: Outcome =
      myRaw === "win" ? "win" : DRAW_RESULTS.has(myRaw) ? "draw" : "loss";
    // The reason always lives on the side that did not win.
    const reasonRaw = outcome === "win" ? oppRaw : myRaw;

    const opening = parseOpening(parsePgnHeaders(game.pgn ?? ""));

    facts.push({
      endTime: game.end_time,
      timeClass: game.time_class as GameType,
      color: isWhite ? "white" : "black",
      myRating: me.rating,
      oppRating: typeof opp?.rating === "number" ? opp.rating : null,
      oppUsername: intern(opp?.username ?? "unknown"),
      outcome,
      termination: TERMINATION_BY_RAW[reasonRaw] ?? "other",
      terminationRaw: intern(reasonRaw || "unknown"),
      eco: opening.eco ? intern(opening.eco) : null,
      openingName: opening.name ? intern(opening.name) : null,
      openingKey: intern(opening.key),
      openingFamily: intern(opening.family),
      timeControl: intern(game.time_control ?? ""),
      durationSeconds: getGameDuration(game),
      url: game.url ?? "",
    });
  }

  return facts;
}

export async function fetchGameFacts(
  username: string
): Promise<GameFactsResult> {
  const key = username.toLowerCase();

  const cached = factsCache.get(key);
  if (cached && Date.now() - cached.cachedAt < FACTS_TTL) {
    return cached.data;
  }

  const archives = await getArchives(username);
  if (archives.length > MAX_ARCHIVES) {
    throw new Error(
      `This account has ${archives.length} months of history, which is more than this tool can analyse in one request.`
    );
  }

  const months = archives.map(parseArchiveUrl);
  const intern = makeInterner();

  // Any month that fails rejects the whole request. A silently dropped archive
  // would shift every later game number, turning missing data into a
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
      return extractFacts(games, key, intern);
    }
  );

  const games = perMonth.flat();
  games.sort((a, b) => a.endTime - b.endTime || a.url.localeCompare(b.url));

  const byType: Record<GameType, number[]> = {
    bullet: [],
    blitz: [],
    rapid: [],
  };
  for (let i = 0; i < games.length; i++) {
    byType[games[i].timeClass].push(i);
  }

  const data: GameFactsResult = {
    username,
    generatedAt: Math.floor(Date.now() / 1000),
    archiveCount: months.length,
    firstGameTime: games.length ? games[0].endTime : null,
    lastGameTime: games.length ? games[games.length - 1].endTime : null,
    games,
    byType,
  };

  factsCache.delete(key);
  factsCache.set(key, { data, cachedAt: Date.now() });
  if (factsCache.size > FACTS_MAX_ENTRIES) {
    const oldest = factsCache.keys().next().value;
    if (oldest !== undefined) factsCache.delete(oldest);
  }

  return data;
}
