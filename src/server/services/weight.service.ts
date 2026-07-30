import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { getSettings } from "./settings.service";
import { ServiceError, syncStatus } from "./pig.service";

export async function recordWeight(
  ctx: Ctx,
  input: { pigId: string; weightKg: number; measuredAt: Date }
) {
  assertCan(ctx.role, "weight:create");
  const settings = await getSettings(ctx.farmId);
  const pig = await db.pig.findFirst({
    where: { id: input.pigId, farmId: ctx.farmId, deletedAt: null },
    include: { weightRecords: { orderBy: { measuredAt: "desc" }, take: 1 } },
  });
  if (!pig) throw new ServiceError("NOT_FOUND", "Pig not found");
  if (pig.diedAt) throw new ServiceError("INVALID_INPUT", "Cannot weigh a dead pig");

  const previous = pig.weightRecords[0] ?? null;
  const record = await db.weightRecord.create({
    data: {
      farmId: ctx.farmId,
      pigId: pig.id,
      weightKg: input.weightKg,
      measuredAt: input.measuredAt,
      recordedById: ctx.userId,
    },
  });

  // Keep the denormalized latest-weight pointer accurate
  const latest = await db.weightRecord.findFirst({
    where: { pigId: pig.id, farmId: ctx.farmId },
    orderBy: { measuredAt: "desc" },
  });
  await db.pig.update({
    where: { id: pig.id },
    data: { currentWeightId: latest?.id ?? record.id },
  });

  await syncStatus(pig.id, settings);

  const dropPct =
    previous && previous.weightKg > 0
      ? ((previous.weightKg - input.weightKg) / previous.weightKg) * 100
      : 0;
  await logAudit(ctx, {
    action: "WEIGHT",
    entityType: "Pig",
    entityId: pig.id,
    summary: `Weighed ${pig.tagId} at ${input.weightKg} kg${dropPct > 10 ? ` (▼${dropPct.toFixed(0)}% drop)` : ""}`,
    before: previous ? { weightKg: previous.weightKg } : undefined,
    after: { weightKg: input.weightKg },
  });

  return { record, weightDropPct: dropPct > 10 ? dropPct : null };
}

export async function recentWeightUpdates(farmId: string, limit = 8) {
  const rows = await db.weightRecord.findMany({
    where: { farmId },
    orderBy: { measuredAt: "desc" },
    take: limit,
    include: {
      pig: { select: { tagId: true } },
      recordedBy: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    pigTag: r.pig.tagId,
    weightKg: r.weightKg,
    measuredAt: r.measuredAt.toISOString(),
    by: r.recordedBy?.name ?? "—",
  }));
}
