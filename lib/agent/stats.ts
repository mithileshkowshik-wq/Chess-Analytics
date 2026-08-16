import { GameFact, GameFactsResult, Outcome } from "../game-facts";
import { GameType } from "../data-processor";
import { normalizeOpeningPhrase } from "../pgn";

export interface ToolContext {
  facts: GameFactsResult;
  /** Unix ms. Injected so tool behavior is deterministic under test. */
  now: number;
}

/**
 * Thrown by the coercion helpers. The tool wrapper turns it into an ordinary
 * `{error, hint}` result so the model can correct itself instead of the whole
 * request failing.
 */
export class ToolArgError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = "ToolArgError";
    this.hint = hint;
  }
}

// ---------------------------------------------------------------- dates (UTC)

export const DAY = 86_400;

export function dayKeyUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function startOfDayUtc(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d, 0, 0, 0) / 1000);
}

const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;

/** Start-of-day unix seconds, UTC. Lenient: models phrase dates many ways. */
export function asDateUtc(value: unknown, field: string): number {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new ToolArgError(`Missing "${field}".`, "Provide a date as YYYY-MM-DD.");
  }

  const iso = raw.match(ISO_DATE);
  if (iso) {
    return startOfDayUtc(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // "September 14, 2025" and friends parse as local midnight; the calendar
  // fields are what we want, so rebuild them in UTC.
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return startOfDayUtc(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate()
    );
  }

  throw new ToolArgError(
    `Could not read "${raw}" as a date for "${field}".`,
    "Use YYYY-MM-DD, e.g. 2025-09-14."
  );
}

export function isoWeekKeyUtc(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - day + 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week =
    1 +
    Math.round(
      (thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000)
    );
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function periodKeyUtc(
  unixSeconds: number,
  granularity: "day" | "week" | "month" | "year"
): string {
  const key = dayKeyUtc(unixSeconds);
  if (granularity === "day") return key;
  if (granularity === "month") return key.slice(0, 7);
  if (granularity === "year") return key.slice(0, 4);
  return isoWeekKeyUtc(unixSeconds);
}

// ----------------------------------------------------------------- coercion

export function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fallback?: T
): T {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new ToolArgError(
      `Missing "${field}".`,
      `Provide one of: ${allowed.join(", ")}.`
    );
  }
  const v = String(value).toLowerCase() as T;
  if (!allowed.includes(v)) {
    throw new ToolArgError(
      `"${value}" is not valid for "${field}".`,
      `Provide one of: ${allowed.join(", ")}.`
    );
  }
  return v;
}

export function asInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; fallback?: number } = {}
): number {
  if (value === undefined || value === null || value === "") {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new ToolArgError(`Missing "${field}".`, "Provide a whole number.");
  }
  // Models routinely send "800" rather than 800.
  const n = typeof value === "number" ? value : Number(String(value).replace(/[\s,]/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ToolArgError(
      `"${value}" is not a whole number for "${field}".`,
      "Provide an integer, e.g. 800."
    );
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new ToolArgError(
      `"${field}" must be at least ${opts.min}.`,
      `You sent ${n}.`
    );
  }
  if (opts.max !== undefined && n > opts.max) return opts.max;
  return n;
}

export function asOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

// ------------------------------------------------------------------ filters

export interface Filters {
  time_class?: GameType | "all";
  color?: "white" | "black" | "any";
  from_date?: string;
  to_date?: string;
  last_n_days?: number;
  opening?: string;
  outcome?: Outcome;
}

export interface ResolvedWindow {
  from: string;
  to: string;
  days: number | null;
}

export function readFilters(args: Record<string, unknown>): Filters {
  return {
    time_class: asEnum(
      args.time_class,
      ["bullet", "blitz", "rapid", "all"] as const,
      "time_class",
      "all"
    ),
    color: asEnum(
      args.color,
      ["white", "black", "any"] as const,
      "color",
      "any"
    ),
    from_date: asOptionalString(args.from_date),
    to_date: asOptionalString(args.to_date),
    last_n_days:
      args.last_n_days === undefined || args.last_n_days === null
        ? undefined
        : asInt(args.last_n_days, "last_n_days", { min: 1, max: 3650 }),
    opening: asOptionalString(args.opening),
    outcome: args.outcome
      ? asEnum(args.outcome, ["win", "loss", "draw"] as const, "outcome")
      : undefined,
  };
}

/**
 * Explicit dates win over `last_n_days`. With neither, the window is all time
 * (null) — there are no hidden defaults; the system prompt makes the model
 * state the window it asked for.
 */
export function resolveWindow(
  f: Filters,
  now: number
): { fromTs: number | null; toTs: number | null; window: ResolvedWindow | null } {
  const nowSec = Math.floor(now / 1000);

  if (f.from_date || f.to_date) {
    const fromTs = f.from_date ? asDateUtc(f.from_date, "from_date") : null;
    const toTs = f.to_date ? asDateUtc(f.to_date, "to_date") + DAY - 1 : null;
    return {
      fromTs,
      toTs,
      window: {
        from: fromTs === null ? "account start" : dayKeyUtc(fromTs),
        to: toTs === null ? dayKeyUtc(nowSec) : dayKeyUtc(toTs),
        days: null,
      },
    };
  }

  if (f.last_n_days) {
    const fromTs = nowSec - f.last_n_days * DAY;
    return {
      fromTs,
      toTs: nowSec,
      window: {
        from: dayKeyUtc(fromTs),
        to: dayKeyUtc(nowSec),
        days: f.last_n_days,
      },
    };
  }

  return { fromTs: null, toTs: null, window: null };
}

export function matchesOpening(game: GameFact, query: string): boolean {
  const q = normalizeOpeningPhrase(query).replace(/^(the|a|an)\s+/, "");
  if (!q) return true;
  if (/^[a-e]\d{2}$/.test(q)) return (game.eco ?? "").toLowerCase() === q;
  return (
    game.openingKey.includes(q) ||
    normalizeOpeningPhrase(game.openingFamily).includes(q)
  );
}

export function applyFilters(
  games: GameFact[],
  f: Filters,
  now: number
): { games: GameFact[]; window: ResolvedWindow | null } {
  const { fromTs, toTs, window } = resolveWindow(f, now);

  const out = games.filter((g) => {
    if (fromTs !== null && g.endTime < fromTs) return false;
    if (toTs !== null && g.endTime > toTs) return false;
    if (f.time_class && f.time_class !== "all" && g.timeClass !== f.time_class)
      return false;
    if (f.color && f.color !== "any" && g.color !== f.color) return false;
    if (f.outcome && g.outcome !== f.outcome) return false;
    if (f.opening && !matchesOpening(g, f.opening)) return false;
    return true;
  });

  return { games: out, window };
}

// -------------------------------------------------------------------- tally

export interface Tally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  score_rate: number | null;
}

function pct(n: number, total: number): number {
  return Math.round((n / total) * 1000) / 10;
}

export function tally(games: GameFact[]): Tally {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const g of games) {
    if (g.outcome === "win") wins++;
    else if (g.outcome === "loss") losses++;
    else draws++;
  }
  const total = games.length;
  return {
    games: total,
    wins,
    losses,
    draws,
    win_rate: total ? pct(wins, total) : null,
    score_rate: total ? pct(wins + 0.5 * draws, total) : null,
  };
}

export function averageOpponentRating(games: GameFact[]): number | null {
  const rated = games.filter((g) => typeof g.oppRating === "number");
  if (!rated.length) return null;
  return Math.round(
    rated.reduce((sum, g) => sum + (g.oppRating as number), 0) / rated.length
  );
}

/** Last index whose value is <= target, or -1. Assumes ascending order. */
export function lastIndexAtOrBefore(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function seriesFor(
  ctx: ToolContext,
  timeClass: GameType
): { games: GameFact[]; endTimes: number[] } {
  const idx = ctx.facts.byType[timeClass];
  const games = idx.map((i) => ctx.facts.games[i]);
  return { games, endTimes: games.map((g) => g.endTime) };
}

export function compactGame(g: GameFact) {
  return {
    date: dayKeyUtc(g.endTime),
    time_class: g.timeClass,
    color: g.color,
    my_rating: g.myRating,
    opponent: g.oppUsername,
    opponent_rating: g.oppRating,
    outcome: g.outcome,
    termination: g.termination,
    opening: g.openingName ?? g.openingFamily,
    url: g.url,
  };
}
