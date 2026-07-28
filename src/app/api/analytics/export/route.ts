import { NextResponse } from "next/server";
import Papa from "papaparse";
import { requireCtx } from "@/server/auth/auth";
import { exportAnalyticsSummary } from "@/server/services/stats.service";

export async function GET() {
  try {
    const ctx = await requireCtx();
    const rows = await exportAnalyticsSummary(ctx);
    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
