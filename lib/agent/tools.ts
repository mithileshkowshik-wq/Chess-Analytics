import { GameType } from "../data-processor";
import { GameFact } from "../game-facts";
import {
  ToolArgError,
  ToolContext,
  applyFilters,
  asEnum,
  asInt,
  asDateUtc,
  asOptionalString,
  averageOpponentRating,
  compactGame,
  dayKeyUtc,
  lastIndexAtOrBefore,
  matchesOpening,
  periodKeyUtc,
  readFilters,
  seriesFor,
  tally,
  DAY,
} from "./stats";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => unknown;
}

const TIME_CLASS_REQUIRED = {
  type: "string",
  enum: ["bullet", "blitz", "rapid"],
  description: "Which rating pool to read.",
};

const FILTER_PROPS = {
  time_class: {
    type: "string",
    enum: ["bullet", "blitz", "rapid", "all"],
    description: "Defaults to all.",
  },
  color: { type: "string", enum: ["white", "black", "any"] },
  from_date: { type: "string", description: "Inclusive UTC date, YYYY-MM-DD." },
  to_date: { type: "string", description: "Inclusive UTC date, YYYY-MM-DD." },
  last_n_days: {
    type: "integer",
    description: 'Rolling window ending today. Use 90 for "recently".',
  },
};

function obj(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

/** Peak/low of a rating list, first occurrence winning ties. */
function extremes(games: GameFact[]) {
  if (!games.length) return null;
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < games.length; i++) {
    if (games[i].myRating > games[hi].myRating) hi = i;
    if (games[i].myRating < games[lo].myRating) lo = i;
  }
  return {
    peak: {
      rating: games[hi].myRating,
      date: dayKeyUtc(games[hi].endTime),
      game_number: hi + 1,
    },
    low: {
      rating: games[lo].myRating,
      date: dayKeyUtc(games[lo].endTime),
      game_number: lo + 1,
    },
    current: {
      rating: games[games.length - 1].myRating,
      date: dayKeyUtc(games[games.length - 1].endTime),
    },
  };
}

const SPECS: ToolSpec[] = [
  {
    name: "get_player_overview",
    description:
      "Totals, date coverage, current/peak/lowest rating and win-loss-draw record for each of bullet, blitz and rapid. Call this when you need orientation on what data exists.",
    parameters: obj({}),
    run: (_args, ctx) => {
      const out: Record<string, unknown> = {};
      for (const tc of ["bullet", "blitz", "rapid"] as GameType[]) {
        const { games } = seriesFor(ctx, tc);
        if (!games.length) {
          out[tc] = { total_games: 0 };
          continue;
        }
        out[tc] = {
          total_games: games.length,
          first_game_date: dayKeyUtc(games[0].endTime),
          last_game_date: dayKeyUtc(games[games.length - 1].endTime),
          ...extremes(games),
          ...tally(games),
        };
      }
      return { username: ctx.facts.username, by_time_class: out };
    },
  },

  {
    name: "get_rating_at_game_number",
    description:
      "The rating at the Nth rated game of a time class, counting from the oldest game. Use for questions like 'what was my rapid rating after 800 games'.",
    parameters: obj(
      {
        time_class: TIME_CLASS_REQUIRED,
        game_number: {
          type: "integer",
          minimum: 1,
          description: "1-based index among rated games of this time class.",
        },
      },
      ["time_class", "game_number"]
    ),
    run: (args, ctx) => {
      const tc = asEnum(
        args.time_class,
        ["bullet", "blitz", "rapid"] as const,
        "time_class"
      );
      const n = asInt(args.game_number, "game_number", { min: 1 });
      const { games } = seriesFor(ctx, tc);

      if (!games.length) return { found: false, time_class: tc, total_games: 0 };
      if (n > games.length) {
        const last = games[games.length - 1];
        return {
          found: false,
          reason: "out_of_range",
          time_class: tc,
          total_games: games.length,
          last_rating: last.myRating,
          last_date: dayKeyUtc(last.endTime),
        };
      }

      const g = games[n - 1];
      return {
        found: true,
        time_class: tc,
        game_number: n,
        total_games: games.length,
        rating: g.myRating,
        date: dayKeyUtc(g.endTime),
        delta_from_first: g.myRating - games[0].myRating,
        opponent: g.oppUsername,
        opponent_rating: g.oppRating,
        outcome: g.outcome,
        opening: g.openingName ?? g.openingFamily,
        url: g.url,
        caveat:
          "Chess.com does not state whether the rating attached to a game is before or after it, so this may be one game's rating change off.",
      };
    },
  },

  {
    name: "get_rating_on_date",
    description:
      "The rating held on a given UTC calendar date. If no game was played that day, returns the rating as of the most recent game before it.",
    parameters: obj(
      {
        time_class: TIME_CLASS_REQUIRED,
        date: { type: "string", description: "UTC calendar date, YYYY-MM-DD." },
      },
      ["time_class", "date"]
    ),
    run: (args, ctx) => {
      const tc = asEnum(
        args.time_class,
        ["bullet", "blitz", "rapid"] as const,
        "time_class"
      );
      const dayStart = asDateUtc(args.date, "date");
      const dayEnd = dayStart + DAY - 1;

      const { games, endTimes } = seriesFor(ctx, tc);
      if (!games.length) return { found: false, time_class: tc, total_games: 0 };

      const idx = lastIndexAtOrBefore(endTimes, dayEnd);
      if (idx === -1) {
        return {
          found: false,
          reason: "before_first_game",
          time_class: tc,
          date: dayKeyUtc(dayStart),
          first_game_date: dayKeyUtc(games[0].endTime),
        };
      }

      const before = lastIndexAtOrBefore(endTimes, dayStart - 1);
      const gamesThatDay = idx - before;
      const g = games[idx];

      return {
        found: true,
        time_class: tc,
        date: dayKeyUtc(dayStart),
        rating: g.myRating,
        as_of_game_date: dayKeyUtc(g.endTime),
        exact_day_match: gamesThatDay > 0,
        games_that_day: gamesThatDay,
        rating_change_that_day:
          gamesThatDay > 0 && before >= 0
            ? g.myRating - games[before].myRating
            : null,
        game_number: idx + 1,
        total_games: games.length,
      };
    },
  },

  {
    name: "get_rating_extremes",
    description:
      "Highest and lowest rating reached in a time class, with the dates, plus the current rating.",
    parameters: obj(
      {
        time_class: TIME_CLASS_REQUIRED,
        from_date: FILTER_PROPS.from_date,
        to_date: FILTER_PROPS.to_date,
        last_n_days: FILTER_PROPS.last_n_days,
      },
      ["time_class"]
    ),
    run: (args, ctx) => {
      const tc = asEnum(
        args.time_class,
        ["bullet", "blitz", "rapid"] as const,
        "time_class"
      );
      const f = readFilters({ ...args, time_class: tc });
      const { games, window } = applyFilters(
        seriesFor(ctx, tc).games,
        f,
        ctx.now
      );
      if (!games.length)
        return { found: false, time_class: tc, window, games_considered: 0 };
      return {
        found: true,
        time_class: tc,
        window,
        games_considered: games.length,
        ...extremes(games),
      };
    },
  },

  {
    name: "get_opening_performance",
    description:
      "Win rate by opening. Pass `opening` to focus on one (a substring like 'sicilian' or 'najdorf', or an ECO code like 'B90'), or omit it to rank all openings. Always compare the result against the returned `baseline` before calling a rate good or bad.",
    parameters: obj({
      opening: {
        type: "string",
        description:
          "Substring of an opening name, or an ECO code. Omit to rank all openings.",
      },
      ...FILTER_PROPS,
      group_by: {
        type: "string",
        enum: ["family", "variation"],
        description: "family groups all Sicilians together. Defaults to family.",
      },
      min_games: { type: "integer", description: "Defaults to 3." },
      limit: { type: "integer", description: "Defaults to 10, max 25." },
      sort_by: { type: "string", enum: ["games", "win_rate", "score_rate"] },
    }),
    run: (args, ctx) => {
      const f = readFilters(args);
      const groupBy = asEnum(
        args.group_by,
        ["family", "variation"] as const,
        "group_by",
        "family"
      );
      const minGames = asInt(args.min_games, "min_games", {
        min: 1,
        fallback: 3,
      });
      const limit = asInt(args.limit, "limit", { min: 1, max: 25, fallback: 10 });
      const sortBy = asEnum(
        args.sort_by,
        ["games", "win_rate", "score_rate"] as const,
        "sort_by",
        "games"
      );

      // Baseline is the same window with the opening filter removed, so the
      // model can say whether a rate is actually good for this player.
      const { games: windowGames, window } = applyFilters(
        ctx.facts.games,
        { ...f, opening: undefined },
        ctx.now
      );
      const matching = f.opening
        ? windowGames.filter((g) => matchesOpening(g, f.opening as string))
        : windowGames;

      if (!matching.length) {
        const counts = new Map<string, number>();
        for (const g of windowGames)
          counts.set(g.openingFamily, (counts.get(g.openingFamily) ?? 0) + 1);
        const suggestions = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([name, games]) => ({ opening: name, games }));
        return {
          total_matching_games: 0,
          window,
          filters_applied: f,
          suggestions,
          note: "No games matched. `suggestions` lists this player's most-played openings in the same window.",
        };
      }

      const groups = new Map<string, GameFact[]>();
      for (const g of matching) {
        const key =
          groupBy === "family" ? g.openingFamily : g.openingName ?? g.openingFamily;
        const bucket = groups.get(key);
        if (bucket) bucket.push(g);
        else groups.set(key, [g]);
      }

      const rows = [...groups.entries()]
        .filter(([, gs]) => gs.length >= minGames)
        .map(([opening, gs]) => ({
          opening,
          ...tally(gs),
          avg_opponent_rating: averageOpponentRating(gs),
        }))
        .sort((a, b) => {
          if (sortBy === "games") return b.games - a.games;
          const key = sortBy === "win_rate" ? "win_rate" : "score_rate";
          return (b[key] ?? 0) - (a[key] ?? 0);
        })
        .slice(0, limit);

      const matchedNames = [
        ...new Set(matching.map((g) => g.openingName ?? g.openingFamily)),
      ];

      return {
        window,
        filters_applied: f,
        total_matching_games: matching.length,
        matched_openings: matchedNames.slice(0, 10),
        matched_opening_count: matchedNames.length,
        overall: {
          ...tally(matching),
          avg_opponent_rating: averageOpponentRating(matching),
          as_white: tally(matching.filter((g) => g.color === "white")),
          as_black: tally(matching.filter((g) => g.color === "black")),
        },
        groups: rows,
        baseline: {
          ...tally(windowGames),
          note: "Same window, all openings. Compare `overall` against this.",
        },
      };
    },
  },

  {
    name: "get_results_breakdown",
    description:
      "Win/loss/draw totals, optionally split by colour, how games ended, or time class.",
    parameters: obj({
      ...FILTER_PROPS,
      opening: { type: "string" },
      split_by: {
        type: "string",
        enum: ["color", "termination", "time_class", "none"],
        description: "Defaults to color.",
      },
    }),
    run: (args, ctx) => {
      const f = readFilters(args);
      const splitBy = asEnum(
        args.split_by,
        ["color", "termination", "time_class", "none"] as const,
        "split_by",
        "color"
      );
      const { games, window } = applyFilters(ctx.facts.games, f, ctx.now);

      const splits: { key: string; [k: string]: unknown }[] = [];
      if (splitBy !== "none" && games.length) {
        const buckets = new Map<string, GameFact[]>();
        for (const g of games) {
          const key =
            splitBy === "color"
              ? g.color
              : splitBy === "time_class"
                ? g.timeClass
                : g.termination;
          const b = buckets.get(key);
          if (b) b.push(g);
          else buckets.set(key, [g]);
        }
        for (const [key, gs] of buckets) splits.push({ key, ...tally(gs) });
        splits.sort((a, b) => (b.games as number) - (a.games as number));
      }

      return {
        window,
        filters_applied: f,
        split_by: splitBy,
        overall: tally(games),
        splits,
      };
    },
  },

  {
    name: "get_recent_games",
    description: "The most recent games, newest first.",
    parameters: obj({
      ...FILTER_PROPS,
      opening: { type: "string" },
      outcome: { type: "string", enum: ["win", "loss", "draw"] },
      limit: { type: "integer", description: "Defaults to 10, max 25." },
    }),
    run: (args, ctx) => {
      const f = readFilters(args);
      const limit = asInt(args.limit, "limit", { min: 1, max: 25, fallback: 10 });
      const { games, window } = applyFilters(ctx.facts.games, f, ctx.now);
      return {
        window,
        total_matching: games.length,
        returned: games.slice(-limit).reverse().map(compactGame),
      };
    },
  },

  {
    name: "get_period_summary",
    description:
      "Activity and rating movement per day, week, month or year — games, results, rating change and hours played.",
    parameters: obj({
      granularity: {
        type: "string",
        enum: ["day", "week", "month", "year"],
        description: "Defaults to month.",
      },
      time_class: FILTER_PROPS.time_class,
      from_date: FILTER_PROPS.from_date,
      to_date: FILTER_PROPS.to_date,
      last_n_days: FILTER_PROPS.last_n_days,
      last_n_periods: { type: "integer", description: "Defaults to 6, max 24." },
    }),
    run: (args, ctx) => {
      const f = readFilters(args);
      const granularity = asEnum(
        args.granularity,
        ["day", "week", "month", "year"] as const,
        "granularity",
        "month"
      );
      const lastN = asInt(args.last_n_periods, "last_n_periods", {
        min: 1,
        max: 24,
        fallback: 6,
      });
      const { games, window } = applyFilters(ctx.facts.games, f, ctx.now);

      const buckets = new Map<string, GameFact[]>();
      for (const g of games) {
        const key = periodKeyUtc(g.endTime, granularity);
        const b = buckets.get(key);
        if (b) b.push(g);
        else buckets.set(key, [g]);
      }

      const periods = [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-lastN)
        .map(([period, gs]) => ({
          period,
          ...tally(gs),
          rating_start: gs[0].myRating,
          rating_end: gs[gs.length - 1].myRating,
          rating_change: gs[gs.length - 1].myRating - gs[0].myRating,
          hours_played:
            Math.round(
              (gs.reduce((s, g) => s + g.durationSeconds, 0) / 3600) * 10
            ) / 10,
        }));

      return { granularity, window, filters_applied: f, periods };
    },
  },

  {
    name: "search_games",
    description:
      "Find games matching arbitrary criteria — opponent, rating range, opening, result. Returns an exact match count plus a capped sample. Use when no other tool fits.",
    parameters: obj({
      ...FILTER_PROPS,
      opening: { type: "string" },
      outcome: { type: "string", enum: ["win", "loss", "draw"] },
      opponent: { type: "string", description: "Exact username, case-insensitive." },
      min_my_rating: { type: "integer" },
      max_my_rating: { type: "integer" },
      limit: { type: "integer", description: "Defaults to 10, max 25." },
      order: { type: "string", enum: ["newest", "oldest"] },
    }),
    run: (args, ctx) => {
      const f = readFilters(args);
      const opponent = asOptionalString(args.opponent)?.toLowerCase();
      const minR =
        args.min_my_rating === undefined
          ? null
          : asInt(args.min_my_rating, "min_my_rating");
      const maxR =
        args.max_my_rating === undefined
          ? null
          : asInt(args.max_my_rating, "max_my_rating");
      const limit = asInt(args.limit, "limit", { min: 1, max: 25, fallback: 10 });
      const order = asEnum(
        args.order,
        ["newest", "oldest"] as const,
        "order",
        "newest"
      );

      const { games, window } = applyFilters(ctx.facts.games, f, ctx.now);
      const matched = games.filter((g) => {
        if (opponent && g.oppUsername.toLowerCase() !== opponent) return false;
        if (minR !== null && g.myRating < minR) return false;
        if (maxR !== null && g.myRating > maxR) return false;
        return true;
      });

      const ordered = order === "newest" ? [...matched].reverse() : matched;
      return {
        window,
        filters_applied: { ...f, opponent, min_my_rating: minR, max_my_rating: maxR },
        total_matching: matched.length,
        summary: tally(matched),
        returned: ordered.slice(0, limit).map(compactGame),
      };
    },
  },
];

/**
 * Argument problems come back as ordinary results so the model can correct
 * itself on the next turn rather than the whole request failing.
 */
export const TOOLS: ToolSpec[] = SPECS.map((spec) => ({
  ...spec,
  run: (args, ctx) => {
    try {
      return spec.run(args, ctx);
    } catch (err) {
      if (err instanceof ToolArgError) {
        return { error: "invalid_arguments", message: err.message, hint: err.hint };
      }
      throw err;
    }
  },
}));

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export const TOOL_DEFS = TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

export const TOOL_LABELS: Record<string, string> = {
  get_player_overview: "account overview",
  get_rating_at_game_number: "rating at a game number",
  get_rating_on_date: "rating on a date",
  get_rating_extremes: "peak and low ratings",
  get_opening_performance: "opening performance",
  get_results_breakdown: "win/loss breakdown",
  get_recent_games: "recent games",
  get_period_summary: "activity by period",
  search_games: "game search",
};
