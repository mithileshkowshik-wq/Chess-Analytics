import { NextRequest, NextResponse } from "next/server";
import { fetchRatingHistory } from "@/lib/rating-history";

// Walking every monthly archive takes far longer than the other routes.
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  try {
    const result = await fetchRatingHistory(username);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = message === "Player not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
