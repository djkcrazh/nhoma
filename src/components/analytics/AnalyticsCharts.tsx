"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { analyticsData } from "@/server/services/stats.service";

type Data = Awaited<ReturnType<typeof analyticsData>>;

const PALETTE = [
  "var(--accent)",
  "var(--breeding)",
  "var(--ok)",
  "var(--due)",
  "var(--ink-faint)",
  "var(--overdue)",
];

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--rule-strong)",
  borderRadius: 10,
  fontSize: 13,
  color: "var(--ink)",
};
const axisTick = { fill: "var(--ink-faint)", fontSize: 11 };

function Panel({
  title,
  children,
  wide,
  short,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  short?: boolean;
}) {
  return (
    <section className={`card p-4 sm:p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <h2 className="mb-4 font-display text-[17px] font-bold">{title}</h2>
      <div className={short ? "h-52" : "h-60"}>{children}</div>
    </section>
  );
}

export function AnalyticsCharts({ data }: { data: Data }) {
  const genderData = [
    { name: "Female", value: data.genderRatio.female },
    { name: "Male", value: data.genderRatio.male },
  ];
  const breedingData = [
    { name: "Farrowed", value: data.breedingCounts.farrowed },
    { name: "Active", value: data.breedingCounts.active },
    { name: "Failed", value: data.breedingCounts.failed },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Population growth — 12 months" wide>
        <ResponsiveContainer>
          <AreaChart data={data.growth} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="gfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--rule-strong)" />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" name="pigs" stroke="var(--accent)" strokeWidth={2.4} fill="url(#gfill)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Breed distribution">
        <ResponsiveContainer>
          <BarChart data={data.breedDistribution} layout="vertical" margin={{ top: 0, right: 12, left: 24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 5" stroke="var(--rule-strong)" horizontal={false} />
            <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="breed" tick={{ ...axisTick, fontSize: 12 }} tickLine={false} axisLine={false} width={90} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="pigs" radius={[0, 6, 6, 0]}>
              {data.breedDistribution.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Gender ratio">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={genderData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3} strokeWidth={0}>
              <Cell fill="var(--accent)" />
              <Cell fill="var(--breeding)" />
            </Pie>
            <Legend formatter={(v) => <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>{v}</span>} />
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Weight distribution (kg)">
        <ResponsiveContainer>
          <BarChart data={data.weightDistribution} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--rule-strong)" />
            <XAxis dataKey="range" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="pigs" fill="var(--accent)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Age distribution">
        <ResponsiveContainer>
          <BarChart data={data.ageDistribution} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--rule-strong)" />
            <XAxis dataKey="range" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="pigs" fill="var(--breeding)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Monthly births — 12 months">
        <ResponsiveContainer>
          <BarChart data={data.births} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--rule-strong)" />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="born" fill="var(--accent)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Average weight over time">
        <ResponsiveContainer>
          <LineChart data={data.avgWeightOverTime} margin={{ top: 5, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--rule-strong)" />
            <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} unit=" kg" />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="avg" name="avg kg" stroke="var(--accent)" strokeWidth={2.4} connectNulls dot={{ r: 3.5, fill: "var(--ground-raised)", stroke: "var(--accent)", strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Breeding outcomes" wide short>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={breedingData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={3} strokeWidth={0}>
              <Cell fill="var(--ok)" />
              <Cell fill="var(--breeding)" />
              <Cell fill="var(--overdue)" />
            </Pie>
            <Legend formatter={(v) => <span style={{ color: "var(--ink-soft)", fontSize: 13 }}>{v}</span>} />
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
