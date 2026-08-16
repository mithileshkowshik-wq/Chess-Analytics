import { ChessGame } from "./chess-api";
import { parsePgnHeader } from "./pgn";

function pgnTimeToSeconds(utcDate: string, time: string): number {
  return new Date(`${utcDate.replace(/\./g, "-")}T${time}Z`).getTime() / 1000;
}

export function getGameDuration(game: ChessGame): number {
  if (game.pgn) {
    const startDate = parsePgnHeader(game.pgn, "UTCDate");
    const startTime = parsePgnHeader(game.pgn, "StartTime");
    const endDate = parsePgnHeader(game.pgn, "EndDate");
    const endTime = parsePgnHeader(game.pgn, "EndTime");
    if (startDate && startTime && endDate && endTime) {
      const start = pgnTimeToSeconds(startDate, startTime);
      const end = pgnTimeToSeconds(endDate, endTime);
      const dur = end - start;
      if (dur > 0 && dur < 10800) return dur;
    }
  }
  // Fallback: estimate from time_control (e.g. "180" or "300+5")
  if (game.time_control) {
    const base = parseInt(game.time_control.split("+")[0], 10);
    if (!isNaN(base)) return Math.min(base * 2, 1800);
  }
  return 0;
}

export type TimeRange = "day" | "week" | "month" | "year";
export type GameType = "bullet" | "blitz" | "rapid";

export interface GameTypeSummary {
  totalSeconds: number;
  gamesPlayed: number;
  ratingStart: number | null;
  ratingEnd: number | null;
  ratingChange: number | null;
}

export interface TimeSeriesBucket {
  date: string;
  bullet: { seconds: number; rating: number | null };
  blitz: { seconds: number; rating: number | null };
  rapid: { seconds: number; rating: number | null };
}

export interface AnalyticsResponse {
  username: string;
  timeRange: TimeRange;
  summary: Record<GameType, GameTypeSummary>;
  timeSeries: TimeSeriesBucket[];
}

function getTimestampRange(timeRange: TimeRange): {
  from: number;
  to: number;
} {
  const now = new Date();
  const to = Math.floor(now.getTime() / 1000);
  let from: number;

  switch (timeRange) {
    case "day": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      from = Math.floor(start.getTime() / 1000);
      break;
    }
    case "week": {
      from = to - 7 * 24 * 3600;
      break;
    }
    case "month": {
      from = to - 30 * 24 * 3600;
      break;
    }
    case "year": {
      from = to - 365 * 24 * 3600;
      break;
    }
  }

  return { from, to };
}

function getArchivesNeeded(timeRange: TimeRange): { year: number; month: number }[] {
  const now = new Date();
  const result: { year: number; month: number }[] = [];
  const months = timeRange === "year" ? 12 : timeRange === "month" ? 2 : 2;

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return result;
}

export function getArchivesForTimeRange(timeRange: TimeRange): { year: number; month: number }[] {
  return getArchivesNeeded(timeRange);
}

export function getTimestampRangeForTimeRange(timeRange: TimeRange) {
  return getTimestampRange(timeRange);
}

function bucketDate(timestamp: number, timeRange: TimeRange): string {
  const d = new Date(timestamp * 1000);
  if (timeRange === "day") {
    // bucket by hour
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:00`;
  } else if (timeRange === "week" || timeRange === "month") {
    // bucket by day
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } else {
    // bucket by month
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
}

export function processGames(
  games: ChessGame[],
  username: string,
  timeRange: TimeRange
): AnalyticsResponse {
  const { from, to } = getTimestampRange(timeRange);
  const lowerUsername = username.toLowerCase();

  const filtered = games
    .filter(
      (g) =>
        g.end_time >= from &&
        g.end_time <= to &&
        ["bullet", "blitz", "rapid"].includes(g.time_class)
    )
    .sort((a, b) => a.end_time - b.end_time);

  const summaryMap: Record<GameType, {
    totalSeconds: number;
    gamesPlayed: number;
    ratings: number[];
  }> = {
    bullet: { totalSeconds: 0, gamesPlayed: 0, ratings: [] },
    blitz: { totalSeconds: 0, gamesPlayed: 0, ratings: [] },
    rapid: { totalSeconds: 0, gamesPlayed: 0, ratings: [] },
  };

  const bucketMap = new Map<string, Record<GameType, { seconds: number; ratings: number[] }>>();

  for (const game of filtered) {
    const type = game.time_class as GameType;
    const duration = getGameDuration(game);
    const isWhite = game.white.username.toLowerCase() === lowerUsername;
    const myRating = isWhite ? game.white.rating : game.black.rating;

    summaryMap[type].totalSeconds += duration;
    summaryMap[type].gamesPlayed += 1;
    summaryMap[type].ratings.push(myRating);

    const bucket = bucketDate(game.end_time, timeRange);
    if (!bucketMap.has(bucket)) {
      bucketMap.set(bucket, {
        bullet: { seconds: 0, ratings: [] },
        blitz: { seconds: 0, ratings: [] },
        rapid: { seconds: 0, ratings: [] },
      });
    }
    const b = bucketMap.get(bucket)!;
    b[type].seconds += duration;
    b[type].ratings.push(myRating);
  }

  const summary: Record<GameType, GameTypeSummary> = {} as Record<GameType, GameTypeSummary>;
  for (const type of ["bullet", "blitz", "rapid"] as GameType[]) {
    const s = summaryMap[type];
    const ratingStart = s.ratings.length > 0 ? s.ratings[0] : null;
    const ratingEnd = s.ratings.length > 0 ? s.ratings[s.ratings.length - 1] : null;
    summary[type] = {
      totalSeconds: s.totalSeconds,
      gamesPlayed: s.gamesPlayed,
      ratingStart,
      ratingEnd,
      ratingChange: ratingStart !== null && ratingEnd !== null ? ratingEnd - ratingStart : null,
    };
  }

  const sortedBuckets = Array.from(bucketMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const timeSeries: TimeSeriesBucket[] = sortedBuckets.map(([date, data]) => ({
    date,
    bullet: {
      seconds: data.bullet.seconds,
      rating: data.bullet.ratings.length > 0 ? data.bullet.ratings[data.bullet.ratings.length - 1] : null,
    },
    blitz: {
      seconds: data.blitz.seconds,
      rating: data.blitz.ratings.length > 0 ? data.blitz.ratings[data.blitz.ratings.length - 1] : null,
    },
    rapid: {
      seconds: data.rapid.seconds,
      rating: data.rapid.ratings.length > 0 ? data.rapid.ratings[data.rapid.ratings.length - 1] : null,
    },
  }));

  return { username, timeRange, summary, timeSeries };
}
