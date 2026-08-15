"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GameType } from "@/lib/data-processor";
import { RatingHistoryResponse } from "@/lib/rating-history";

// Pinned locale so the rendered date is deterministic.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(unixSeconds: number) {
  return dateFormatter.format(new Date(unixSeconds * 1000));
}

type Lookup =
  | { kind: "invalid" }
  | { kind: "empty" }
  | { kind: "out-of-range"; total: number; lastRating: number; lastEndTime: number }
  | {
      kind: "hit";
      n: number;
      total: number;
      rating: number;
      endTime: number;
      delta: number;
    };

export function RatingAtGame({
  username,
  gameType,
}: {
  username: string;
  gameType: GameType;
}) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  // The full-archive fetch is expensive and most visitors never use this box,
  // so hold off until someone actually reaches for it.
  const [armed, setArmed] = useState(false);

  const { data, isLoading, isError, error } = useQuery<RatingHistoryResponse>({
    queryKey: ["history", username],
    queryFn: async () => {
      const res = await fetch(
        `/api/chess/${encodeURIComponent(username)}/history`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      return res.json();
    },
    enabled: armed,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    // A failed request here already cost the user 20s; don't spend another 20s.
    retry: false,
  });

  // Keyed on gameType so flipping the dashboard toggle re-answers the same
  // question instantly, with no refetch.
  const lookup = useMemo<Lookup | null>(() => {
    if (submitted === null || !data) return null;

    const cleaned = submitted.replace(/[\s,]/g, "");
    if (!/^\d+$/.test(cleaned)) return { kind: "invalid" };

    const n = Number.parseInt(cleaned, 10);
    if (n < 1) return { kind: "invalid" };

    const series = data.series[gameType];
    const total = series.ratings.length;
    if (total === 0) return { kind: "empty" };

    if (n > total) {
      return {
        kind: "out-of-range",
        total,
        lastRating: series.ratings[total - 1],
        lastEndTime: series.endTimes[total - 1],
      };
    }

    return {
      kind: "hit",
      n,
      total,
      rating: series.ratings[n - 1],
      endTime: series.endTimes[n - 1],
      delta: series.ratings[n - 1] - series.ratings[0],
    };
  }, [submitted, data, gameType]);

  const total = data ? data.series[gameType].ratings.length : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setArmed(true);
    setSubmitted(trimmed);
  }

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 font-medium">
          Rating at Game Number
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            inputMode="numeric"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setArmed(true)}
            placeholder={total ? `1–${total.toLocaleString()}` : "e.g. 800"}
            aria-label={`Game number to look up your ${gameType} rating at`}
            className="w-full sm:max-w-[220px] rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="submit"
            disabled={!input.trim()}
            className="h-[42px] bg-violet-600 hover:bg-violet-500 text-white px-6"
          >
            Look up
          </Button>
        </form>

        {armed && isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-40 bg-slate-700" />
            <p className="text-xs text-slate-500">
              Loading your full game history…
            </p>
          </div>
        )}

        {armed && isError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error instanceof Error ? error.message : "Failed to load history"}
          </div>
        )}

        {data && (
          <>
            {lookup?.kind === "hit" && (
              <div>
                <p className="text-3xl font-bold text-white">{lookup.rating}</p>
                <p className="text-sm text-slate-400 mt-1">
                  {formatDate(lookup.endTime)}
                  {lookup.n > 1 && (
                    <>
                      {" · "}
                      <span
                        className={
                          lookup.delta > 0
                            ? "text-emerald-400"
                            : lookup.delta < 0
                              ? "text-red-400"
                              : "text-slate-400"
                        }
                      >
                        {lookup.delta >= 0 ? "+" : ""}
                        {lookup.delta}
                      </span>{" "}
                      since game 1
                    </>
                  )}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {lookup.n === 1
                    ? `Your first rated ${gameType} game`
                    : `Your ${gameType} rating at rated game #${lookup.n.toLocaleString()}`}
                </p>
              </div>
            )}

            {lookup?.kind === "invalid" && (
              <p className="text-sm text-amber-400">
                Enter a whole number of 1 or more.
              </p>
            )}

            {lookup?.kind === "out-of-range" && (
              <p className="text-sm text-slate-400">
                You&apos;ve only played {lookup.total.toLocaleString()} rated{" "}
                {gameType} games. Your latest is{" "}
                <span className="text-white font-medium">
                  {lookup.lastRating}
                </span>{" "}
                ({formatDate(lookup.lastEndTime)}).
              </p>
            )}

            {(lookup?.kind === "empty" || total === 0) && (
              <p className="text-sm text-slate-400">
                No rated {gameType} games found for @{username}.
              </p>
            )}

            {total !== null && total > 0 && (
              <p className="text-xs text-slate-500">
                You&apos;ve played {total.toLocaleString()} rated {gameType}{" "}
                games.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
