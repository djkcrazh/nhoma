import { requireCtx } from "@/server/auth/auth";
import { analyticsData } from "@/server/services/stats.service";
import { AnalyticsCharts } from "@/components/analytics/AnalyticsCharts";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const ctx = await requireCtx();
  const data = await analyticsData(ctx);
  return (
    <div className="fade-up">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Analytics</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {data.totalOpen} active pigs · breeding success{" "}
            {data.breedingSuccessRate != null ? `${data.breedingSuccessRate}%` : "n/a"}
          </p>
        </div>
        <a className="btn btn-secondary btn-sm" href="/api/analytics/export" download>
          Export CSV
        </a>
      </div>
      <AnalyticsCharts data={data} />
    </div>
  );
}
