"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function WeightChart({
  data,
}: {
  data: { weightKg: number; measuredAt: string }[];
}) {
  const series = [...data]
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .map((d) => ({
      date: new Date(d.measuredAt).toLocaleDateString("en", { month: "short", day: "numeric" }),
      kg: d.weightKg,
    }));

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer>
        <AreaChart data={series} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="wfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--rule)" />
          <XAxis dataKey="date" tick={{ fill: "var(--ink-faint)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--rule-strong)" }} />
          <YAxis tick={{ fill: "var(--ink-faint)", fontSize: 11 }} tickLine={false} axisLine={false} unit=" kg" />
          <Tooltip
            contentStyle={{
              background: "var(--ground-raised)",
              border: "1px solid var(--rule-strong)",
              borderRadius: 10,
              fontSize: 13,
              color: "var(--ink)",
            }}
          />
          <Area type="monotone" dataKey="kg" stroke="var(--accent)" strokeWidth={2.4} fill="url(#wfill)" dot={{ r: 3.5, fill: "var(--ground-raised)", stroke: "var(--accent)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
