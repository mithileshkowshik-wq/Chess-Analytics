import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GameTypeSummary } from "@/lib/data-processor";

function formatHours(seconds: number) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.round(seconds / 60)}m`;
  return `${h.toFixed(1)}h`;
}

function RatingDelta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const sign = value >= 0 ? "+" : "";
  const color = value > 0 ? "text-emerald-400" : value < 0 ? "text-red-400" : "text-slate-400";
  return <span className={color}>{sign}{value}</span>;
}

export function StatsCards({ summary }: { summary: GameTypeSummary }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm text-slate-400 font-medium">Time Played</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-white">
            {summary.gamesPlayed === 0 ? "—" : formatHours(summary.totalSeconds)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {summary.totalSeconds > 0 ? `${Math.round(summary.totalSeconds / 60)} minutes` : "No games"}
          </p>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm text-slate-400 font-medium">Games Played</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-white">{summary.gamesPlayed}</p>
          <p className="text-xs text-slate-500 mt-1">
            {summary.gamesPlayed === 0 ? "No games in range" : "games found"}
          </p>
        </CardContent>
      </Card>

      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm text-slate-400 font-medium">Rating Change</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            <RatingDelta value={summary.ratingChange} />
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {summary.ratingEnd !== null ? `Current: ${summary.ratingEnd}` : "No data"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
