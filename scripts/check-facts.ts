/**
 * Offline checks for the game-facts store and the rating-history projection.
 * Run with: node scripts/check-facts.ts
 *
 * Node 22 strips TypeScript types natively, and lib/ uses relative imports, so
 * this exercises the real modules with no test runner and no network.
 */
import assert from "node:assert";
import { parseOpening, parsePgnHeaders } from "../lib/pgn";
import { fetchGameFacts } from "../lib/game-facts";
import { fetchRatingHistory } from "../lib/rating-history";
import type { ChessGame } from "../lib/chess-api";
import type { GameType } from "../lib/data-processor";

const ME = "TestPlayer";
const ME_LOWER = ME.toLowerCase();

function pgn(opts: { eco?: string; ecoUrl?: string; date: string }) {
  const lines = [
    `[Event "Live Chess"]`,
    `[Site "Chess.com"]`,
    `[UTCDate "${opts.date}"]`,
    `[StartTime "12:00:00"]`,
    `[EndDate "${opts.date}"]`,
    `[EndTime "12:08:00"]`,
  ];
  if (opts.eco) lines.push(`[ECO "${opts.eco}"]`);
  if (opts.ecoUrl) lines.push(`[ECOUrl "${opts.ecoUrl}"]`);
  return lines.join("\n") + "\n\n1. e4 c5 2. Nf3 d6 1-0";
}

let seq = 0;
function game(o: {
  t: number;
  tc?: string;
  rules?: string;
  rated?: boolean;
  meWhite?: boolean;
  myRating?: number;
  myResult: string;
  oppResult: string;
  eco?: string;
  ecoUrl?: string;
  meName?: string;
  url?: string;
}): ChessGame {
  const meSide = {
    username: o.meName ?? ME,
    rating: o.myRating ?? 1500,
    result: o.myResult,
  };
  const oppSide = { username: "Rival", rating: 1490, result: o.oppResult };
  const white = o.meWhite === false ? oppSide : meSide;
  const black = o.meWhite === false ? meSide : oppSide;
  return {
    url: o.url ?? `g${String(++seq).padStart(3, "0")}`,
    pgn: pgn({ eco: o.eco, ecoUrl: o.ecoUrl, date: "2025.09.14" }),
    time_control: "600",
    end_time: o.t,
    start_time: o.t - 600,
    rated: o.rated !== false,
    time_class: (o.tc ?? "rapid") as ChessGame["time_class"],
    rules: o.rules ?? "chess",
    white,
    black,
  };
}

const NAJDORF =
  "https://www.chess.com/openings/B90-Sicilian-Defense-Najdorf-Variation-6.Be3";
const LONDON = "https://www.chess.com/openings/A45-London-System";

const ARCHIVES: Record<string, ChessGame[]> = {
  "2025/09": [
    // Every outcome / termination branch.
    game({ t: 1000, myResult: "win", oppResult: "checkmated", myRating: 1500, ecoUrl: NAJDORF, eco: "B90" }),
    game({ t: 1100, myResult: "resigned", oppResult: "win", myRating: 1490, ecoUrl: NAJDORF, eco: "B90" }),
    game({ t: 1200, myResult: "repetition", oppResult: "repetition", myRating: 1492, ecoUrl: LONDON, eco: "A45" }),
    game({ t: 1300, myResult: "timevsinsufficient", oppResult: "timevsinsufficient", myRating: 1493, ecoUrl: LONDON }),
    game({ t: 1400, myResult: "win", oppResult: "timeout", myRating: 1505, ecoUrl: NAJDORF, eco: "B90" }),
    game({ t: 1500, myResult: "bananaed", oppResult: "win", myRating: 1495, eco: "C20" }),
    game({ t: 1600, tc: "blitz", myResult: "win", oppResult: "resigned", myRating: 900, ecoUrl: LONDON }),
    // Each of these must be dropped.
    game({ t: 1700, rated: false, myResult: "win", oppResult: "resigned", myRating: 9999 }),
    game({ t: 1800, rules: "chess960", myResult: "win", oppResult: "resigned", myRating: 8888 }),
    game({ t: 1900, tc: "daily", myResult: "win", oppResult: "resigned", myRating: 7777 }),
    game({ t: 2000, meName: "SomeoneElse", myResult: "win", oppResult: "resigned", myRating: 6666 }),
  ],
  "2025/10": [
    // Deliberately earlier than September's games: tests the global re-sort.
    game({ t: 900, myResult: "win", oppResult: "resigned", myRating: 1480, ecoUrl: NAJDORF, eco: "B90" }),
    // Identical end_time: deterministic tie-break on url.
    game({ t: 2100, myResult: "win", oppResult: "resigned", myRating: 1510, url: "zzz" }),
    game({ t: 2100, myResult: "resigned", oppResult: "win", myRating: 1509, url: "aaa" }),
  ],
};

globalThis.fetch = (async (url: string) => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (String(url).endsWith("/games/archives")) {
    return ok({
      archives: Object.keys(ARCHIVES).map(
        (k) => `https://api.chess.com/pub/player/${ME}/games/${k}`
      ),
    });
  }
  const m = String(url).match(/\/games\/(\d{4})\/(\d{2})$/);
  if (m) return ok({ games: ARCHIVES[`${m[1]}/${m[2]}`] ?? [] });
  throw new Error("unexpected url " + url);
}) as unknown as typeof fetch;

// ---------------------------------------------------------------- opening
{
  const o = parseOpening(parsePgnHeaders(pgn({ eco: "B90", ecoUrl: NAJDORF, date: "2025.09.14" })));
  assert.strictEqual(o.name, "Sicilian Defense Najdorf Variation", "move suffix must be stripped");
  assert.strictEqual(o.family, "Sicilian Defense");
  assert.ok(o.key.includes("sicilian"), "key must be substring-matchable");
  assert.strictEqual(o.eco, "B90");

  const noUrl = parseOpening(parsePgnHeaders(pgn({ eco: "C20", date: "2025.09.14" })));
  assert.strictEqual(noUrl.name, null);
  assert.strictEqual(noUrl.family, "ECO C20");

  const bare = parseOpening(parsePgnHeaders(pgn({ date: "2025.09.14" })));
  assert.strictEqual(bare.family, "Unknown");

  const london = parseOpening(parsePgnHeaders(pgn({ ecoUrl: LONDON, date: "2025.09.14" })));
  assert.strictEqual(london.name, "London System");
  assert.strictEqual(london.family, "London System");
  console.log("✓ opening parsing: move-suffix strip, family, ECO fallback, bare");
}

// ------------------------------------------------------------- game facts
async function main() {
const facts = await fetchGameFacts(ME);

assert.strictEqual(facts.games.length, 10, "4 games must be filtered out");
assert.deepStrictEqual(
  facts.games.map((g) => g.endTime),
  [900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 2100, 2100],
  "sorted across archive boundaries"
);
assert.deepStrictEqual(
  facts.games.slice(-2).map((g) => g.url),
  ["aaa", "zzz"],
  "equal endTime tie-broken by url"
);
console.log("✓ filters drop unrated/variant/daily/foreign; global sort + tie-break");

const byTime = new Map(facts.games.map((g) => [g.endTime, g]));
assert.strictEqual(byTime.get(1000)!.outcome, "win");
assert.strictEqual(byTime.get(1000)!.termination, "checkmate", "win reason comes from opponent");
assert.strictEqual(byTime.get(1100)!.outcome, "loss");
assert.strictEqual(byTime.get(1100)!.termination, "resignation");
assert.strictEqual(byTime.get(1200)!.outcome, "draw");
assert.strictEqual(byTime.get(1200)!.termination, "repetition");
assert.strictEqual(byTime.get(1300)!.outcome, "draw");
assert.strictEqual(byTime.get(1300)!.termination, "timeout_vs_insufficient");
assert.strictEqual(byTime.get(1400)!.termination, "timeout", "win by opponent timeout");
assert.strictEqual(byTime.get(1500)!.outcome, "loss");
assert.strictEqual(byTime.get(1500)!.termination, "other", "unknown result falls through");
assert.strictEqual(byTime.get(1500)!.terminationRaw, "bananaed");
console.log("✓ outcome/termination for every branch incl. unknown → other");

assert.strictEqual(byTime.get(1000)!.openingFamily, "Sicilian Defense");
assert.strictEqual(byTime.get(1000)!.color, "white");
assert.strictEqual(byTime.get(1000)!.oppUsername, "Rival");
assert.strictEqual(byTime.get(1000)!.oppRating, 1490);

// byType indexing is what "rating at game N" depends on.
assert.strictEqual(facts.byType.rapid.length, 9);
assert.strictEqual(facts.byType.blitz.length, 1);
assert.strictEqual(facts.byType.bullet.length, 0);
assert.strictEqual(facts.games[facts.byType.rapid[0]].myRating, 1480, "rapid game #1");
assert.strictEqual(facts.games[facts.byType.blitz[0]].myRating, 900, "blitz game #1");
console.log("✓ byType indexes the nth rated game of each class");

// Interning: repeated strings must be the same reference, not just equal.
const najdorfFacts = facts.games.filter((g) => g.openingFamily === "Sicilian Defense");
assert.ok(najdorfFacts.length >= 3);
assert.ok(
  najdorfFacts.every((g) => g.openingName === najdorfFacts[0].openingName),
  "equal opening names"
);
assert.ok(
  najdorfFacts[0].openingName === najdorfFacts[1].openingName &&
    Object.is(najdorfFacts[0].openingName, najdorfFacts[2].openingName),
  "opening names must be interned to one reference"
);
console.log("✓ string interning shares references");

// ------------------------------------- V3: the projection regression check
/**
 * The ORIGINAL extractPoints from lib/rating-history.ts, copied verbatim as a
 * reference implementation. The new projection must produce byte-identical
 * series or the shipped "rating at game N" feature silently breaks.
 */
function extractPointsOriginal(games: ChessGame[], lowerUsername: string) {
  const GAME_TYPES: GameType[] = ["bullet", "blitz", "rapid"];
  const points: { endTime: number; rating: number; url: string; type: GameType }[] = [];
  for (const g of games) {
    if (!g.rated) continue;
    if (g.rules !== "chess") continue;
    if (!GAME_TYPES.includes(g.time_class as GameType)) continue;
    const isWhite = g.white?.username?.toLowerCase() === lowerUsername;
    const isBlack = g.black?.username?.toLowerCase() === lowerUsername;
    if (!isWhite && !isBlack) continue;
    const rating = isWhite ? g.white.rating : g.black.rating;
    if (typeof rating !== "number" || rating <= 0) continue;
    if (typeof g.end_time !== "number") continue;
    points.push({ endTime: g.end_time, rating, url: g.url ?? "", type: g.time_class as GameType });
  }
  return points;
}

const allRaw = Object.values(ARCHIVES).flat();
const refPoints = extractPointsOriginal(allRaw, ME_LOWER);
refPoints.sort((a, b) => a.endTime - b.endTime || a.url.localeCompare(b.url));

const refSeries: Record<GameType, { ratings: number[]; endTimes: number[] }> = {
  bullet: { ratings: [], endTimes: [] },
  blitz: { ratings: [], endTimes: [] },
  rapid: { ratings: [], endTimes: [] },
};
for (const p of refPoints) {
  refSeries[p.type].ratings.push(p.rating);
  refSeries[p.type].endTimes.push(p.endTime);
}

const history = await fetchRatingHistory(ME);
for (const type of ["bullet", "blitz", "rapid"] as GameType[]) {
  assert.deepStrictEqual(
    history.series[type].ratings,
    refSeries[type].ratings,
    `${type} ratings must match the pre-refactor implementation exactly`
  );
  assert.deepStrictEqual(
    history.series[type].endTimes,
    refSeries[type].endTimes,
    `${type} endTimes must match the pre-refactor implementation exactly`
  );
}
console.log("✓ V3: projection is element-for-element identical to old extractPoints");
console.log("    rapid:", JSON.stringify(history.series.rapid.ratings));

// Cache: a second call must not refetch.
globalThis.fetch = (async () => {
  throw new Error("should not refetch within TTL");
}) as unknown as typeof fetch;
const again = await fetchGameFacts(ME.toLowerCase());
assert.strictEqual(again, facts, "expected cached instance");
console.log("✓ facts cache hit on second call");

console.log("\nALL FACTS CHECKS PASSED");
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
