import type { analyticsData } from "@/server/services/stats.service";

type Analytics = Awaited<ReturnType<typeof analyticsData>>;

export type MetricKey = "herd" | "weight" | "births" | "sold";

/** One chart point. `value` is null for a month with nothing to measure. */
export interface Point {
  month: string;
  value: number | null;
}

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  /** Counts that start at zero read honestly from a zero baseline; herd size
   *  and weight move in a narrow band, so they get a zoomed axis instead. */
  zeroBased: boolean;
  /** "last": the headline is the latest value. "sum": total over the range. */
  headline: "last" | "sum";
  caption: string;
  decimals: number;
}

export const METRICS: MetricDef[] = [
  { key: "herd", label: "Herd size", unit: "pigs", zeroBased: false, headline: "last", caption: "Pigs on the ledger today", decimals: 0 },
  { key: "weight", label: "Average weight", unit: "kg", zeroBased: false, headline: "last", caption: "Average weight, latest month", decimals: 1 },
  { key: "births", label: "Births", unit: "piglets", zeroBased: true, headline: "sum", caption: "Piglets born in this period", decimals: 0 },
  { key: "sold", label: "Pigs sold", unit: "pigs", zeroBased: true, headline: "sum", caption: "Pigs sold in this period", decimals: 0 },
];

export const RANGES = [
  { months: 3, label: "Last 3 months" },
  { months: 6, label: "Last 6 months" },
  { months: 12, label: "Last 12 months" },
] as const;

/**
 * Average weight has no value for a month with no weigh-ins, so the series
 * arrives with nulls in it. Policy: draw a point only where there is a real
 * measurement. A gap stays a gap (a break in the line), and we never carry a
 * value forward or interpolate one, because that would claim a weight nobody
 * recorded.
 *
 * "Real" means a finite number, so a NaN from an upstream division can't slip
 * through as a point. Order is untouched: `analyticsData` already returns the
 * months oldest-first, and `month` is a display label ("Dec", "Jan"), so
 * sorting by it would scramble the timeline.
 */
export function handleGaps(points: Point[]): Point[] {
  return points.map((p) => ({
    ...p,
    value: p.value != null && Number.isFinite(p.value) ? p.value : null,
  }));
}

/** Build every metric's 12-month series on the server; the client only slices. */
export function buildAllSeries(a: Analytics, currentHerdSize: number): Record<MetricKey, Point[]> {
  const herd: Point[] = a.herdSize.map((h) => ({ month: h.month, value: h.count }));
  // The last point is "now": pin it to the dashboard's own total so the chart
  // headline can never disagree with the stat card beside it.
  if (herd.length) herd[herd.length - 1] = { ...herd[herd.length - 1], value: currentHerdSize };

  return {
    herd,
    weight: handleGaps(a.avgWeightOverTime.map((w) => ({ month: w.month, value: w.avg }))),
    births: a.births.map((b) => ({ month: b.month, value: b.count })),
    sold: a.sold.map((s) => ({ month: s.month, value: s.count })),
  };
}

export interface Summary {
  value: number | null;
  /** % change shown in the pill; null when there is no meaningful baseline. */
  deltaPct: number | null;
}

const sum = (pts: Point[]) => pts.reduce((t, p) => t + (p.value ?? 0), 0);

export function summarize(def: MetricDef, points: Point[]): Summary {
  const known = points.filter((p): p is { month: string; value: number } => p.value != null);
  if (!known.length) return { value: null, deltaPct: null };

  if (def.headline === "last") {
    const first = known[0].value;
    const last = known[known.length - 1].value;
    return { value: last, deltaPct: first && known.length > 1 ? ((last - first) / first) * 100 : null };
  }

  // "sum": compare the later half of the range with the earlier half.
  const half = Math.floor(points.length / 2);
  const before = sum(points.slice(0, half));
  const after = sum(points.slice(points.length - half));
  return { value: sum(points), deltaPct: half && before ? ((after - before) / before) * 100 : null };
}
