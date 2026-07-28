import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { getSettings } from "./settings.service";
import { computeWarnings, resolveStatus } from "@/lib/domain/compute";
import { toDomainPig } from "./pig.service";

const SEVERITY_BY_TYPE: Record<string, string> = {
  OVERDUE_PREGNANCY: "critical",
  PREGNANCY_ENDING_SOON: "warning",
  STALE_WEIGHT: "warning",
  MARKET_READY: "success",
  BREEDING_READY: "info",
  MISSING_PARENTS: "info",
};

/**
 * Daily reconciliation: recompute every open pig's status and materialize
 * warning-notifications with dedupe keys. Runs from a cron route and lazily
 * (throttled) from dashboard loads so statuses stay correct without traffic.
 */
export async function reconcileFarm(farmId: string) {
  const settings = await getSettings(farmId);
  const pigs = await db.pig.findMany({
    where: { farmId, deletedAt: null, status: { notIn: ["SOLD", "DEAD", "INACTIVE"] } },
    include: {
      weightRecords: { orderBy: { measuredAt: "desc" }, take: 1 },
      breedingsAsSow: { where: { status: "ACTIVE" }, take: 1 },
      mother: { select: { id: true, tagId: true, breed: true, deletedAt: true } },
      father: { select: { id: true, tagId: true, breed: true, deletedAt: true } },
    },
  });

  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  let statusChanges = 0;

  for (const pig of pigs) {
    const d = toDomainPig(pig);
    const next = resolveStatus(d, settings, now);
    if (next !== pig.status) {
      await db.pig.update({ where: { id: pig.id }, data: { status: next } });
      statusChanges++;
    }

    for (const w of computeWarnings(d, settings, now)) {
      // Weekly dedupe for nags, daily for critical
      const window = w.severity === "critical" ? dateKey : dateKey.slice(0, 7);
      const dedupeKey = `${w.type}:${pig.id}:${window}`;
      await db.notification.upsert({
        where: { farmId_dedupeKey: { farmId, dedupeKey } },
        create: {
          farmId,
          pigId: pig.id,
          type: w.type,
          severity: SEVERITY_BY_TYPE[w.type] ?? "info",
          message: `${pig.tagId}: ${w.message}`,
          dedupeKey,
        },
        update: { message: `${pig.tagId}: ${w.message}` },
      });
    }
  }

  await db.setting.upsert({
    where: { farmId_key: { farmId, key: "system.lastReconcileAt" } },
    create: { farmId, key: "system.lastReconcileAt", value: JSON.stringify(now.toISOString()) },
    update: { value: JSON.stringify(now.toISOString()) },
  });
  return { pigs: pigs.length, statusChanges };
}

/** Run reconcile at most once per 6h from page loads. */
export async function maybeReconcile(farmId: string) {
  const row = await db.setting.findUnique({
    where: { farmId_key: { farmId, key: "system.lastReconcileAt" } },
  });
  const last = row ? new Date(JSON.parse(row.value)) : null;
  if (!last || Date.now() - last.getTime() > 6 * 3600_000) {
    await reconcileFarm(farmId);
  }
}

export async function listNotifications(ctx: Ctx, opts?: { unreadOnly?: boolean; limit?: number }) {
  const rows = await db.notification.findMany({
    where: {
      farmId: ctx.farmId,
      resolvedAt: null,
      ...(opts?.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: opts?.limit ?? 50,
    include: { pig: { select: { tagId: true } } },
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    severity: n.severity,
    message: n.message,
    pigTag: n.pig?.tagId ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function unreadCount(ctx: Ctx) {
  return db.notification.count({
    where: { farmId: ctx.farmId, readAt: null, resolvedAt: null },
  });
}

export async function markRead(ctx: Ctx, id: string) {
  await db.notification.updateMany({
    where: { id, farmId: ctx.farmId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(ctx: Ctx) {
  await db.notification.updateMany({
    where: { farmId: ctx.farmId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function dismiss(ctx: Ctx, id: string) {
  await db.notification.updateMany({
    where: { id, farmId: ctx.farmId },
    data: { resolvedAt: new Date(), readAt: new Date() },
  });
}
