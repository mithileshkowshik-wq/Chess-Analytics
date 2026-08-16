/* eslint-disable @typescript-eslint/no-explicit-any -- check harness inspects loosely-typed JSON payloads */
/**
 * Offline checks for the agent's tool implementations.
 * Compile with the other lib files and run the emitted JS.
 */
import assert from "node:assert";
import { TOOLS_BY_NAME, TOOL_DEFS } from "../lib/agent/tools";
import type { ToolContext } from "../lib/agent/stats";
import type { GameFact, GameFactsResult, Outcome } from "../lib/game-facts";
import type { GameType } from "../lib/data-processor";

const DAY = 86400;
// 2025-09-14T00:00:00Z
const SEP14 = Math.floor(Date.UTC(2025, 8, 14) / 1000);
const NOW_MS = Date.UTC(2025, 8, 30) ;

let n = 0;
function fact(o: Partial<GameFact> & { endTime: number }): GameFact {
  n++;
  return {
    timeClass: "rapid",
    color: n % 2 ? "white" : "black",
    myRating: 1500,
    oppRating: 1490,
    oppUsername: "Rival",
    outcome: "win" as Outcome,
    termination: "resignation",
    terminationRaw: "resigned",
    eco: "B90",
    openingName: "Sicilian Defense Najdorf Variation",
    openingKey: "sicilian defense najdorf variation",
    openingFamily: "Sicilian Defense",
    timeControl: "600",
    durationSeconds: 600,
    url: `u${n}`,
    ...o,
  } as GameFact;
}

const games: GameFact[] = [];
// 10 rapid Sicilians on consecutive days ending Sep 10: 6W 2L 2D
const sicilianOutcomes: Outcome[] = ["win","win","win","win","win","win","loss","loss","draw","draw"];
sicilianOutcomes.forEach((outcome, i) => {
  games.push(fact({ endTime: SEP14 - (12 - i) * DAY, myRating: 1400 + i * 10, outcome }));
});
// 10 rapid London games: 2W 8L  (a clearly worse opening)
const londonOutcomes: Outcome[] = ["win","win","loss","loss","loss","loss","loss","loss","loss","loss"];
londonOutcomes.forEach((outcome, i) => {
  games.push(
    fact({
      endTime: SEP14 - (2 - 0) * DAY + i * 60,
      myRating: 1520 + i,
      outcome,
      eco: "A45",
      openingName: "London System",
      openingKey: "london system",
      openingFamily: "London System",
    })
  );
});
// 2 rapid games ON Sep 14 itself
games.push(fact({ endTime: SEP14 + 3600, myRating: 1600, outcome: "win" }));
games.push(fact({ endTime: SEP14 + 7200, myRating: 1610, outcome: "win" }));
// 3 blitz games, later
games.push(fact({ endTime: SEP14 + 5 * DAY, timeClass: "blitz", myRating: 900, outcome: "loss" }));
games.push(fact({ endTime: SEP14 + 6 * DAY, timeClass: "blitz", myRating: 890, outcome: "win" }));
games.push(fact({ endTime: SEP14 + 7 * DAY, timeClass: "blitz", myRating: 905, outcome: "draw" }));

games.sort((a, b) => a.endTime - b.endTime || a.url.localeCompare(b.url));

const byType: Record<GameType, number[]> = { bullet: [], blitz: [], rapid: [] };
games.forEach((g, i) => byType[g.timeClass].push(i));

const facts: GameFactsResult = {
  username: "TestPlayer",
  generatedAt: 0,
  archiveCount: 2,
  firstGameTime: games[0].endTime,
  lastGameTime: games[games.length - 1].endTime,
  games,
  byType,
};

const ctx: ToolContext = { facts, now: NOW_MS };
const call = (name: string, args: Record<string, unknown> = {}) =>
  TOOLS_BY_NAME.get(name)!.run(args, ctx) as Record<string, any>;

const RAPID_TOTAL = byType.rapid.length;

// ------------------------------------------------- get_rating_at_game_number
{
  const first = call("get_rating_at_game_number", { time_class: "rapid", game_number: 1 });
  assert.strictEqual(first.found, true);
  assert.strictEqual(first.rating, games[byType.rapid[0]].myRating);
  assert.strictEqual(first.delta_from_first, 0);

  const last = call("get_rating_at_game_number", { time_class: "rapid", game_number: RAPID_TOTAL });
  assert.strictEqual(last.rating, games[byType.rapid[RAPID_TOTAL - 1]].myRating);

  const over = call("get_rating_at_game_number", { time_class: "rapid", game_number: RAPID_TOTAL + 1 });
  assert.strictEqual(over.found, false);
  assert.strictEqual(over.reason, "out_of_range");
  assert.strictEqual(over.total_games, RAPID_TOTAL);

  const zero = call("get_rating_at_game_number", { time_class: "rapid", game_number: 0 });
  assert.strictEqual(zero.error, "invalid_arguments", "0 must be rejected, not thrown");

  // Models send strings for integers constantly.
  const coerced = call("get_rating_at_game_number", { time_class: "rapid", game_number: "1" });
  assert.strictEqual(coerced.rating, first.rating, '"1" must coerce to 1');
  console.log("✓ get_rating_at_game_number: n=1/total/total+1/0, string coercion");
}

// -------------------------------------------------------- get_rating_on_date
{
  const onDay = call("get_rating_on_date", { time_class: "rapid", date: "2025-09-14" });
  assert.strictEqual(onDay.found, true);
  assert.strictEqual(onDay.exact_day_match, true);
  assert.strictEqual(onDay.games_that_day, 2);
  assert.strictEqual(onDay.rating, 1610, "last game of that UTC day");
  assert.strictEqual(onDay.as_of_game_date, "2025-09-14");

  // A day with no rapid games: must fall back and say so.
  const quiet = call("get_rating_on_date", { time_class: "rapid", date: "2025-09-20" });
  assert.strictEqual(quiet.found, true);
  assert.strictEqual(quiet.exact_day_match, false);
  assert.strictEqual(quiet.games_that_day, 0);
  assert.strictEqual(quiet.as_of_game_date, "2025-09-14");

  const early = call("get_rating_on_date", { time_class: "rapid", date: "2020-01-01" });
  assert.strictEqual(early.found, false);
  assert.strictEqual(early.reason, "before_first_game");

  const prose = call("get_rating_on_date", { time_class: "rapid", date: "September 14, 2025" });
  assert.strictEqual(prose.rating, 1610, "prose dates must parse");

  const bad = call("get_rating_on_date", { time_class: "rapid", date: "banana" });
  assert.strictEqual(bad.error, "invalid_arguments");
  assert.ok(bad.hint, "must carry a hint the model can act on");
  console.log("✓ get_rating_on_date: exact day, quiet day fallback, pre-history, prose, banana");
}

// -------------------------------------------------- get_opening_performance
{
  const sicilian = call("get_opening_performance", { opening: "sicilian", time_class: "rapid" });
  assert.strictEqual(sicilian.total_matching_games, 12, "10 + the 2 on Sep 14");
  assert.strictEqual(sicilian.overall.wins, 8);
  assert.strictEqual(sicilian.overall.losses, 2);
  assert.strictEqual(sicilian.overall.draws, 2);
  assert.strictEqual(sicilian.overall.win_rate, 66.7);
  assert.strictEqual(sicilian.overall.score_rate, 75);
  assert.ok(
    sicilian.matched_openings.includes("Sicilian Defense Najdorf Variation"),
    "must echo what it matched"
  );
  // baseline = all rapid+blitz openings in window; proves the Sicilian is above par
  assert.ok(sicilian.baseline.games > sicilian.total_matching_games);
  assert.ok(
    (sicilian.overall.win_rate as number) > (sicilian.baseline.win_rate as number),
    "Sicilian should beat the player's baseline in this fixture"
  );

  const byEco = call("get_opening_performance", { opening: "B90", time_class: "rapid" });
  assert.strictEqual(byEco.total_matching_games, 12, "ECO code path");

  const none = call("get_opening_performance", { opening: "budapest" });
  assert.strictEqual(none.total_matching_games, 0);
  assert.ok(Array.isArray(none.suggestions) && none.suggestions.length > 0);
  assert.strictEqual(none.suggestions[0].opening, "Sicilian Defense");

  const ranked = call("get_opening_performance", { time_class: "rapid", sort_by: "games" });
  assert.strictEqual(ranked.groups[0].opening, "Sicilian Defense");
  assert.strictEqual(ranked.groups[1].opening, "London System");
  console.log("✓ get_opening_performance: substring, ECO, zero-match suggestions, baseline, ranking");
}

// ------------------------------------------------------------- other tools
{
  const overview = call("get_player_overview");
  assert.strictEqual(overview.by_time_class.rapid.total_games, RAPID_TOTAL);
  assert.strictEqual(overview.by_time_class.bullet.total_games, 0);
  assert.ok(overview.by_time_class.blitz.peak.rating >= 905);

  const extremes = call("get_rating_extremes", { time_class: "rapid" });
  assert.strictEqual(extremes.peak.rating, 1610);

  const breakdown = call("get_results_breakdown", { split_by: "color" });
  assert.strictEqual(
    breakdown.splits.reduce((s: number, x: any) => s + x.games, 0),
    games.length
  );

  const recent = call("get_recent_games", { limit: 3 });
  assert.strictEqual(recent.returned.length, 3);
  assert.ok(recent.returned[0].date >= recent.returned[1].date, "newest first");

  const periods = call("get_period_summary", { granularity: "month" });
  assert.ok(periods.periods.length >= 1);
  assert.ok(periods.periods[0].period.match(/^\d{4}-\d{2}$/));

  const search = call("search_games", { opponent: "Rival", limit: 5 });
  assert.strictEqual(search.total_matching, games.length);
  assert.strictEqual(search.returned.length, 5);

  const noOpp = call("search_games", { opponent: "Nobody" });
  assert.strictEqual(noOpp.total_matching, 0);
  console.log("✓ overview, extremes, breakdown, recent, periods, search");
}

// ----------------------------------------------- window handling + payloads
{
  const windowed = call("get_results_breakdown", { last_n_days: 30 });
  assert.ok(windowed.window, "last_n_days must echo a window");
  assert.strictEqual(windowed.window.days, 30);

  const allTime = call("get_results_breakdown", {});
  assert.strictEqual(allTime.window, null, "no window args => all time, no hidden default");

  for (const [name, spec] of TOOLS_BY_NAME) {
    const out = spec.run(name === "get_rating_at_game_number" || name === "get_rating_on_date"
      ? { time_class: "rapid", game_number: 1, date: "2025-09-14" }
      : {}, ctx);
    const json = JSON.stringify(out);
    assert.ok(json, `${name} must serialize`);
    assert.ok(json.length < 20_000, `${name} payload ${json.length}B must stay under 20KB`);
  }
  console.log("✓ windows echoed, no hidden defaults, every payload serializable and <20KB");
}

// ---------------------------------------------------------------- schemas
{
  assert.strictEqual(TOOL_DEFS.length, 9);
  for (const d of TOOL_DEFS) {
    assert.strictEqual(d.type, "function");
    assert.ok(d.function.name && d.function.description);
    assert.strictEqual((d.function.parameters as any).additionalProperties, false);
    assert.ok(d.function.description.length < 400, `${d.function.name} description too long`);
  }
  console.log("✓ 9 tool schemas well-formed");
}

console.log("\nALL TOOL CHECKS PASSED");
