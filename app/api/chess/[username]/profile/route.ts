import { NextRequest, NextResponse } from "next/server";
import { getPlayerProfile, getPlayerStats } from "@/lib/chess-api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  try {
    const [profile, stats] = await Promise.all([
      getPlayerProfile(username),
      getPlayerStats(username),
    ]);
    return NextResponse.json({ profile, stats });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Player not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
