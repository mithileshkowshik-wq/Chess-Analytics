"use client";

import {
  BarChart,
  Bar,
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
  if (timeRange === "day") {
    return date.split("T")[1] ?? date;
  }
  if (timeRange === "year") {
    const [y, m] = date.split("-");
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleString("default", { month: "short", year: "2-digit" });
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
  const seconds = payload[0].value;
  const mins = Math.floor(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const display = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return (
    <div className="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-white">
      <p className="font-medium">{label}</p>
      <p className="text-emerald-400">{display}</p>
    </div>
  );
}

export function TimeSpentChart({ data, gameType, timeRange }: Props) {
  const chartData = data.map((b) => ({
    date: formatLabel(b.date, timeRange),
    seconds: b[gameType].seconds,
  }));

  if (chartData.every((d) => d.seconds === 0)) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
        No games in this time range
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "#475569" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => {
            const m = Math.round(v / 60);
            return m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`;
          }}
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          axisLine={{ stroke: "#475569" }}
          tickLine={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="seconds" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  );
}
