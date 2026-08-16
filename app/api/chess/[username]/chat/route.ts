import { NextRequest, NextResponse } from "next/server";
import { fetchGameFacts } from "@/lib/game-facts";
import { AgentTurn, runAgent } from "@/lib/agent/loop";
import {
  LlmError,
  LlmNotConfiguredError,
  getModel,
  isConfigured,
} from "@/lib/agent/openrouter";
import { dayKeyUtc } from "@/lib/agent/stats";

// The archive walk dominates, same as /history.
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_TURNS = 8;
const MAX_TURN_CHARS = 2000;
/** Leaves headroom under maxDuration for the final tool-free call. */
const AGENT_BUDGET_MS = 55_000;

function readHistory(raw: unknown): AgentTurn[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;

  const turns: AgentTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;
    turns.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const startedAt = Date.now();

  // Cheap validation first, before any outbound request.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body as { message?: unknown })?.message;
  if (typeof message !== "string" || message.trim() === "") {
    return NextResponse.json({ error: "A message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Questions are limited to ${MAX_MESSAGE_CHARS} characters` },
      { status: 400 }
    );
  }

  const history = readHistory((body as { history?: unknown })?.history);
  if (history === null) {
    return NextResponse.json({ error: "Invalid history" }, { status: 400 });
  }

  // Fail before hammering Chess.com for data we could not use anyway.
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "The assistant is not configured." },
      { status: 503 }
    );
  }

  try {
    const facts = await fetchGameFacts(username);

    const result = await runAgent({
      facts,
      history,
      question: message.trim(),
      deadline: startedAt + AGENT_BUDGET_MS,
    });

    return NextResponse.json(
      {
        answer: result.answer,
        toolCalls: result.toolCalls.map((t) => ({ name: t.name, ok: t.ok })),
        meta: {
          model: getModel(),
          iterations: result.iterations,
          truncated: result.truncated,
          gamesAnalyzed: facts.games.length,
          coverage: {
            from: facts.firstGameTime ? dayKeyUtc(facts.firstGameTime) : null,
            to: facts.lastGameTime ? dayKeyUtc(facts.lastGameTime) : null,
          },
          usage: result.usage,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: unknown) {
    if (err instanceof LlmNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    // Sanitized: never echo the key or a raw provider payload.
    if (err instanceof LlmError) {
      console.error("[chat] provider error", err);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }

    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    const status = errorMessage === "Player not found" ? 404 : 500;
    return NextResponse.json({ error: errorMessage }, { status });
  }
}
