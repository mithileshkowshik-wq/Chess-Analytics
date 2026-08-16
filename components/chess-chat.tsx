"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

/**
 * Kept here rather than imported from lib/agent/tools so the client bundle
 * doesn't pull in the server-side data layer behind it.
 */
const TOOL_LABELS: Record<string, string> = {
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

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  error?: boolean;
}

interface ChatResponse {
  answer: string;
  toolCalls: { name: string; ok: boolean }[];
  meta: { truncated: boolean };
}

/**
 * The history is snapshotted at send time rather than read inside mutationFn:
 * TanStack keeps the latest render's closure, which would already contain the
 * question being asked and send it twice.
 */
interface AskInput {
  question: string;
  history: { role: "user" | "assistant"; content: string }[];
}

const SUGGESTIONS = [
  "What was my rapid rating after 800 games?",
  "How do I do with the Sicilian recently?",
  "What was my blitz rating on 2025-09-14?",
];

/** The first question pays for the archive walk, so say so rather than spin. */
const SLOW_AFTER_MS = 6000;

export function ChessChat({ username }: { username: string }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [slow, setSlow] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const ask = useMutation<ChatResponse, Error, AskInput>({
    mutationFn: async ({ question, history }) => {
      const res = await fetch(
        `/api/chess/${encodeURIComponent(username)}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question, history }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.answer ||
            "I could not work that out from your game history.",
          tools: [...new Set(data.toolCalls.filter((t) => t.ok).map((t) => t.name))],
        },
      ]);
    },
    onError: (err) => {
      const notConfigured = err.message
        .toLowerCase()
        .includes("not configured");
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          error: true,
          content: notConfigured
            ? "The assistant is not configured. Add an OPENROUTER_API_KEY to enable it."
            : err.message,
        },
      ]);
    },
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns, ask.isPending]);

  // Only schedules; `slow` is reset in send() so the effect never sets state
  // synchronously.
  useEffect(() => {
    if (!ask.isPending) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ask.isPending]);

  function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || ask.isPending) return;
    const history = turns
      .filter((t) => !t.error)
      .slice(-8)
      .map((t) => ({ role: t.role, content: t.content }));

    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setSlow(false);
    ask.mutate({ question: trimmed, history });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 font-medium flex items-center gap-2">
          <Sparkles className="size-4 text-violet-400" />
          Ask about your stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {turns.length === 0 && !ask.isPending && (
          <div className="space-y-2">
            <p className="text-sm text-slate-400">
              Ask anything about @{username}&apos;s rated bullet, blitz and rapid
              games.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-violet-600 hover:text-white transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {(turns.length > 0 || ask.isPending) && (
          <div
            ref={listRef}
            aria-live="polite"
            className="max-h-[420px] overflow-y-auto space-y-3 pr-1"
          >
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg border border-violet-700/40 bg-violet-600/20 px-3 py-2 text-sm text-white whitespace-pre-wrap">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex flex-col items-start gap-1">
                  <p
                    className={
                      turn.error
                        ? "max-w-[85%] rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300"
                        : "max-w-[85%] rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap"
                    }
                  >
                    {turn.content}
                  </p>
                  {turn.tools && turn.tools.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Checked:{" "}
                      {turn.tools
                        .map((t) => TOOL_LABELS[t] ?? t)
                        .join(", ")}
                    </p>
                  )}
                </div>
              )
            )}

            {ask.isPending && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-56 bg-slate-700" />
                <p className="text-xs text-slate-500">
                  {slow ? "Thinking…" : "Reading your game history…"}
                </p>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. What was my rapid rating after 800 games?"
            aria-label="Ask a question about your chess statistics"
            className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            spellCheck={false}
          />
          <Button
            type="submit"
            disabled={!input.trim() || ask.isPending}
            className="h-[42px] self-end bg-violet-600 hover:bg-violet-500 text-white px-6"
          >
            {ask.isPending ? "Asking…" : "Ask"}
          </Button>
        </form>

        <p className="text-xs text-slate-500">
          Answers are computed from your rated bullet, blitz and rapid games —
          daily, unrated and variant games are excluded.
        </p>
      </CardContent>
    </Card>
  );
}
