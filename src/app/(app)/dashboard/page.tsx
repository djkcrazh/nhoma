import Link from "next/link";
import { requireCtx } from "@/server/auth/auth";
import { dashboardStats, analyticsData } from "@/server/services/stats.service";
import { listNotifications } from "@/server/services/notification.service";
import { recentActivity } from "@/server/services/audit.service";
import { recentWeightUpdates } from "@/server/services/weight.service";
import { StatCard } from "@/components/dashboard/StatCard";
import { HerdChart } from "@/components/dashboard/HerdChart";
import { buildAllSeries } from "@/lib/chart/series";
import { EarTag } from "@/components/ui/EarTag";

export const dynamic = "force-dynamic";

const VERB_COLOR: Record<string, string> = {
  CREATE: "var(--ok)",
  UPDATE: "var(--breeding)",
  WEIGHT: "var(--due)",
  BREEDING: "var(--breeding)",
  FARROW: "var(--ok)",
  DELETE: "var(--overdue)",
  STATUS_CHANGE: "var(--accent)",
  IMPORT: "var(--breeding)",
  NOTE: "var(--ink-faint)",
};

function relTime(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** Most urgent first; within a severity, newest first. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2, success: 3 };
const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--overdue)",
  warning: "var(--due)",
  info: "var(--breeding)",
  success: "var(--ok)",
};
const ATTENTION_ROWS = 3;

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const [stats, analytics, alerts, activity, weightUpdates] = await Promise.all([
    dashboardStats(ctx),
    analyticsData(ctx),
    listNotifications(ctx, { limit: 30 }),
    recentActivity(ctx.farmId, 10),
    recentWeightUpdates(ctx.farmId, 6),
  ]);

  const growthSpark = analytics.growth.map((g) => g.count);
  const weightSpark = analytics.avgWeightOverTime.map((w) => w.avg);

  const attention = [...alerts]
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        b.createdAt.localeCompare(a.createdAt)
    )
    .slice(0, ATTENTION_ROWS);
  const moreAlerts = alerts.length - attention.length;

  const series = buildAllSeries(analytics, stats.total);

  const cards = [
    { label: "Total pigs", value: stats.total, href: "/pigs", spark: growthSpark, accent: true },
    { label: "Pregnant sows", value: stats.pregnant, href: "/breeding", sparkColor: "var(--breeding)" },
    { label: "Ready to farrow", value: stats.readyToFarrow, href: "/breeding" },
    {
      label: "Avg weight",
      value: stats.avgWeightKg != null ? `${stats.avgWeightKg.toFixed(1)} kg` : "—",
      href: "/analytics",
      spark: weightSpark,
      sparkColor: "var(--due)",
    },
  ];

  return (
    <div className="space-y-4 fade-up">
      <div>
        <h1 className="font-display text-2xl font-bold">Farm overview</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          {new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })} —{" "}
          {stats.total} pigs on the ledger
        </p>
      </div>

      {/* The few things that need a person today. The full list lives in Alerts. */}
      <section className="card px-4 py-1 sm:px-5">
        <div className="flex items-center justify-between py-3">
          <h2 className="font-display text-base font-bold">Needs attention</h2>
          <Link href="/notifications" className="-my-1 py-1 text-xs font-semibold text-accent hover:underline">
            {moreAlerts > 0 ? `All alerts (+${moreAlerts})` : "All alerts"} →
          </Link>
        </div>
        {attention.length === 0 ? (
          <p className="mb-4 rounded-lg bg-sunken px-4 py-6 text-center text-sm text-ink-faint">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul>
            {attention.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 border-t border-dashed border-rule py-3"
              >
                <span
                  aria-hidden
                  className="h-9 w-1 flex-none rounded-full"
                  style={{ background: SEVERITY_COLOR[a.severity] ?? "var(--rule-strong)" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{a.message}</p>
                  <p className="font-tag text-[10px] uppercase tracking-wider text-ink-faint">
                    {a.type.replaceAll("_", " ").toLowerCase()} · {relTime(a.createdAt)}
                  </p>
                </div>
                {a.pigTag && <span className="hidden sm:block"><EarTag tagId={a.pigTag} /></span>}
                <Link
                  href={a.pigTag ? `/pigs/${encodeURIComponent(a.pigTag)}` : "/notifications"}
                  className="btn btn-secondary btn-sm flex-none"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 min-[700px]:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      <HerdChart series={series} />

      {/* Below the fold: the ledger and recent weigh-ins */}
      <div className="grid gap-4 pt-2 xl:grid-cols-2">
        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-bold">Recent activity</h2>
            <span className="font-tag text-[10px] uppercase tracking-widest text-ink-faint">
              audit ledger
            </span>
          </div>
          {activity.length === 0 ? (
            <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-ink-faint">
              No entries yet — add your first pig to start the ledger.
            </p>
          ) : (
            <div>
              {activity.map((a, i) => (
                <div key={a.id} className="ledger-row">
                  <span className="ledger-num">{String(activity.length - i).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{a.summary}</p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {a.user?.name ?? "System"} · {relTime(a.createdAt)}
                    </p>
                  </div>
                  <span className="verb-stamp self-start" style={{ color: VERB_COLOR[a.action] ?? "var(--ink-faint)" }}>
                    {a.action}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-display text-base font-bold">Recent weight updates</h2>
          {weightUpdates.length === 0 ? (
            <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-ink-faint">
              No weights recorded yet.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {weightUpdates.map((w) => (
                <div key={w.id} className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2">
                  <EarTag tagId={w.pigTag} />
                  <span className="font-tag text-sm font-semibold">{w.weightKg} kg</span>
                  <span className="ml-auto text-[11px] text-ink-faint">{relTime(w.measuredAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
