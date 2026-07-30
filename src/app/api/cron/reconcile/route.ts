import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { reconcileFarm } from "@/server/services/notification.service";

/**
 * Daily reconciliation endpoint — point a scheduler (Vercel Cron, cron + curl)
 * here. Recomputes time-dependent statuses and materializes notifications for
 * every farm even when nobody has the app open.
 * Protect with CRON_SECRET in production.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
    }
  } else if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const farms = await db.farm.findMany({ select: { id: true } });
  const results = [];
  for (const farm of farms) {
    results.push({ farmId: farm.id, ...(await reconcileFarm(farm.id)) });
  }
  return NextResponse.json({ ok: true, results });
}
