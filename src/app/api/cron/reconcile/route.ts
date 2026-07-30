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
  try {
    const farms = await db.farm.findMany({ select: { id: true } });
    const results = [];
    // One bad farm (bad data, a constraint violation) must not stop the rest
    // from reconciling — this runs unattended, so a single failure shouldn't
    // silently starve every farm after it in the list.
    for (const farm of farms) {
      try {
        results.push({ farmId: farm.id, ok: true, ...(await reconcileFarm(farm.id)) });
      } catch (err) {
        console.error(`Reconcile failed for farm ${farm.id}:`, err);
        results.push({
          farmId: farm.id,
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("Cron reconcile failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
