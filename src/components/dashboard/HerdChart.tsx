"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Icon } from "@/components/ui/NhomaIcons";
import {
  METRICS,
  RANGES,
  summarize,
  type MetricDef,
  type MetricKey,
  type Point,
} from "@/lib/chart/series";

const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink outline-none " +
  "data-[highlighted]:bg-sunken data-[state=checked]:bg-accent-soft data-[state=checked]:font-semibold";

const fmt = (n: number, decimals: number) =>
  n.toLocaleString("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Zoomed axis for slow-moving values, zero baseline for counts. */
function domainFor(def: MetricDef, points: Point[]): [number, number] {
  const values = points.map((p) => p.value).filter((v): v is number => v != null);
  if (!values.length) return [0, 1];
  const max = Math.max(...values);
  if (def.zeroBased) return [0, Math.max(max, 4)];
  const min = Math.min(...values);
  const pad = Math.max((max - min) * 0.25, 1);
  return [Math.floor(min - pad), Math.ceil(max + pad)];
}

export function HerdChart({ series }: { series: Record<MetricKey, Point[]> }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("herd");
  const [months, setMonths] = useState<number>(12);

  const def = METRICS.find((m) => m.key === metricKey)!;
  const range = RANGES.find((r) => r.months === months)!;
  const points = series[metricKey].slice(-months);
  const known = points.filter((p) => p.value != null);
  const { value, deltaPct } = summarize(def, points);
  const lastKnown = known[known.length - 1];
  // Gaps leave isolated points that a bare line would hide, so mark the dots.
  const hasGaps = known.length !== points.length;
  const unit = value === 1 ? def.unit.replace(/s$/, "") : def.unit; // "1 pig", "12 pigs", "57 kg"
  const flat = deltaPct != null && Math.abs(deltaPct) < 0.05;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col items-start gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="btn btn-secondary h-auto min-h-0 gap-2 py-1.5 pl-3.5 pr-2.5 font-display text-[17px] font-bold">
                {def.label}
                <Icon.ChevronDown className="text-ink-soft" size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="card z-50 min-w-60 p-1.5"
                style={{ boxShadow: "var(--shadow-lg)" }}
              >
                <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 font-tag text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Show
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={metricKey} onValueChange={(v) => setMetricKey(v as MetricKey)}>
                  {METRICS.map((m) => (
                    <DropdownMenu.RadioItem key={m.key} value={m.key} className={MENU_ITEM}>
                      <span className="flex w-4 justify-center text-accent">
                        <DropdownMenu.ItemIndicator>
                          <Icon.Check size={14} />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      {m.label}
                      <span className="ml-auto font-tag text-[11px] font-normal text-ink-faint">{m.unit}</span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded px-0.5 font-tag text-[11.5px] uppercase tracking-[0.14em] text-ink-soft hover:text-ink">
                {range.label}
                <Icon.ChevronDown size={12} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="card z-50 min-w-48 p-1.5"
                style={{ boxShadow: "var(--shadow-lg)" }}
              >
                <DropdownMenu.RadioGroup value={String(months)} onValueChange={(v) => setMonths(Number(v))}>
                  {RANGES.map((r) => (
                    <DropdownMenu.RadioItem key={r.months} value={String(r.months)} className={MENU_ITEM}>
                      <span className="flex w-4 justify-center text-accent">
                        <DropdownMenu.ItemIndicator>
                          <Icon.Check size={14} />
                        </DropdownMenu.ItemIndicator>
                      </span>
                      {r.label}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="text-right">
          <div className="flex items-center justify-end gap-2.5">
            <span className="font-display text-[26px] font-semibold leading-none">
              {value == null ? "—" : fmt(value, def.decimals)}
              <small className="ml-1.5 text-[15px] font-medium text-ink-soft">{value == null ? "" : unit}</small>
            </span>
            {deltaPct != null && (
              <span
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[13px] font-semibold ${
                  flat
                    ? "bg-sunken text-ink-soft"
                    : deltaPct > 0
                      ? "bg-ok-soft text-ok"
                      : "bg-overdue-soft text-overdue"
                }`}
              >
                {!flat && <span aria-hidden>{deltaPct > 0 ? "▲" : "▼"}</span>}
                {flat ? "No change" : `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(1)}%`}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">{def.caption}</p>
        </div>
      </div>

      <div className="mt-4 h-[190px] w-full sm:h-[230px]">
        {known.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg bg-sunken text-sm text-ink-faint">
            No {def.label.toLowerCase()} data for this period yet.
          </div>
        ) : (
          <ResponsiveContainer>
            <AreaChart data={points} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="herdfill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.24} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--rule-strong)" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                minTickGap={6}
                tick={{ fill: "var(--ink-soft)", fontSize: 12 }}
              />
              <YAxis
                width={34}
                tickLine={false}
                axisLine={false}
                tickCount={3}
                allowDecimals={def.decimals > 0}
                domain={domainFor(def, points)}
                tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--rule-strong)" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--rule-strong)",
                  borderRadius: 10,
                  fontSize: 13,
                  color: "var(--ink)",
                }}
                labelStyle={{ color: "var(--ink-soft)" }}
                formatter={(v) => [`${fmt(Number(v), def.decimals)} ${Number(v) === 1 ? def.unit.replace(/s$/, "") : def.unit}`, def.label]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--accent)"
                strokeWidth={2.4}
                fill="url(#herdfill)"
                connectNulls={false}
                dot={hasGaps ? { r: 3.5, fill: "var(--ground-raised)", stroke: "var(--accent)", strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: "var(--ground-raised)", stroke: "var(--accent)", strokeWidth: 2.5 }}
                isAnimationActive={false}
              />
              {lastKnown && (
                <ReferenceDot
                  x={lastKnown.month}
                  y={lastKnown.value as number}
                  r={5.5}
                  fill="var(--ground-raised)"
                  stroke="var(--accent)"
                  strokeWidth={2.5}
                  ifOverflow="visible"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
