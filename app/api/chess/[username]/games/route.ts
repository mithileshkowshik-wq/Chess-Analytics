import { NextRequest, NextResponse } from "next/server";
import { getArchives } from "@/lib/chess-api";
import { getCachedMonthlyGames } from "@/lib/cache";
import {
  processGames,
  getTimestampRangeForTimeRange,
  TimeRange,
} from "@/lib/data-processor";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const timeRange = (req.nextUrl.searchParams.get("timeRange") ?? "month") as TimeRange;

  if (!["day", "week", "month", "year"].includes(timeRange)) {
    return NextResponse.json({ error: "Invalid timeRange" }, { status: 400 });
  }

  try {
    const { from, to } = getTimestampRangeForTimeRange(timeRange);
    const archives = await getArchives(username);

    // Determine which months we need
    const monthsNeeded = new Set<string>();
    const now = new Date();
    const monthsBack = timeRange === "year" ? 13 : 3;
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsNeeded.add(
        `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }

    const relevantArchives = archives.filter((url) => {
      const parts = url.split("/");
      const month = parts[parts.length - 1];
      const year = parts[parts.length - 2];
      return monthsNeeded.has(`${year}/${month}`);
    });

    const allGames = [];
    for (const url of relevantArchives) {
      const parts = url.split("/");
      const month = parseInt(parts[parts.length - 1], 10);
      const year = parseInt(parts[parts.length - 2], 10);
      const games = await getCachedMonthlyGames(username, year, month);
      allGames.push(...games);
      if (relevantArchives.length > 1) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    const filtered = allGames.filter(
      (g) => g.end_time >= from && g.end_time <= to
    );

    const result = processGames(filtered, username, timeRange);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Player not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
