"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCards } from "./stats-cards";
import { TimeSpentChart } from "./time-spent-chart";
import { RatingChart } from "./rating-chart";
import { RatingAtGame } from "./rating-at-game";
import { DashboardSkeleton } from "./loading-skeleton";
import { AnalyticsResponse, GameType, TimeRange } from "@/lib/data-processor";

const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: "bullet", label: "Bullet" },
  { value: "blitz", label: "Blitz" },
  { value: "rapid", label: "Rapid" },
];

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  color,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  color: "emerald" | "violet";
}) {
  const activeClass =
    color === "emerald"
      ? "bg-emerald-600 text-white"
      : "bg-violet-600 text-white";
  return (
    <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === opt.value
              ? activeClass
              : "text-slate-400 hover:text-white hover:bg-slate-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Dashboard({ username }: { username: string }) {
  const [gameType, setGameType] = useState<GameType>("blitz");
  const [timeRange, setTimeRange] = useState<TimeRange>("month");

  const { data, isLoading, isError, error } = useQuery<AnalyticsResponse>({
    queryKey: ["games", username, timeRange],
    queryFn: async () => {
      const res = await fetch(
        `/api/chess/${encodeURIComponent(username)}/games?timeRange=${timeRange}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }
      return res.json();
    },
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          options={GAME_TYPES}
          value={gameType}
          onChange={setGameType}
          color="emerald"
        />
        <div className="flex-1" />
        <ToggleGroup
          options={TIME_RANGES}
          value={timeRange}
          onChange={setTimeRange}
          color="violet"
        />
      </div>

      {isLoading && <DashboardSkeleton />}

      {isError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error instanceof Error ? error.message : "Failed to load data"}
        </div>
      )}

      {data && <StatsCards summary={data.summary[gameType]} />}

      {/* Owns its own query, so it stays usable while the time-range data
          above is loading or has failed. */}
      <RatingAtGame username={username} gameType={gameType} />

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 font-medium">
                Hours Played Over Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TimeSpentChart
                data={data.timeSeries}
                gameType={gameType}
                timeRange={timeRange}
              />
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300 font-medium">
                Rating Over Time
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RatingChart
                data={data.timeSeries}
                gameType={gameType}
                timeRange={timeRange}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
