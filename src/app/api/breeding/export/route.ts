import { NextResponse } from "next/server";
import Papa from "papaparse";
import { requireCtx } from "@/server/auth/auth";
import { exportBreedings } from "@/server/services/breeding.service";

export async function GET() {
  try {
    const ctx = await requireCtx();
    const rows = await exportBreedings(ctx);
    const csv = Papa.unparse(rows);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="breeding-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
