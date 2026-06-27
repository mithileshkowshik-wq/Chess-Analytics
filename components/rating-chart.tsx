"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TimeSeriesBucket, GameType, TimeRange } from "@/lib/data-processor";

interface Props {
  data: TimeSeriesBucket[];
  gameType: GameType;
  timeRange: TimeRange;
}

function formatLabel(date: string, timeRange: TimeRange) {
  if (timeRange === "day") return date.split("T")[1] ?? date;
  if (timeRange === "year") {
    const [y, m] = date.split("-");
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleString("default", {
      month: "short",
      year: "2-digit",
    });
  }
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("default", { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white">
      <p className="font-medium">{label}</p>
      <p className="text-violet-400">Rating: {payload[0].value}</p>
    </div>
  );
}

export function RatingChart({ data, gameType, timeRange }: Props) {
  const chartData = data
    .filter((b) => b[gameType].rating !== null)
    .map((b) => ({
      date: formatLabel(b.date, timeRange),
      rating: b[gameType].rating as number,
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        No rating data in this time range
      </div>
    );
  }

  const ratings = chartData.map((d) => d.rating);
  const minR = Math.min(...ratings) - 20;
  const maxR = Math.max(...ratings) + 20;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "#475569" }}
          tickLine={false}
        />
        <YAxis
          domain={[minR, maxR]}
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "#475569" }}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="rating"
          stroke="#8b5cf6"
          strokeWidth={2}
          dot={chartData.length < 20 ? { fill: "#8b5cf6", r: 3 } : false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
