import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { getSettings } from "./settings.service";
import { ServiceError, syncStatus } from "./pig.service";
import { gestation } from "@/lib/domain/compute";

export async function recordCrossing(
  ctx: Ctx,
  input: { sowId: string; boarId?: string | null; crossingDate: Date }
) {
  assertCan(ctx.role, "breeding:create");
  const settings = await getSettings(ctx.farmId);

  const sow = await db.pig.findFirst({
    where: { id: input.sowId, farmId: ctx.farmId, deletedAt: null },
  });
  if (!sow) throw new ServiceError("NOT_FOUND", "Sow not found");
  if (sow.sex !== "FEMALE")
    throw new ServiceError("INVALID_INPUT", "Only female pigs can have crossing records");
  if (sow.soldAt || sow.diedAt)
    throw new ServiceError("INVALID_INPUT", "Sow is no longer active on the farm");

  const active = await db.breeding.findFirst({
    where: { sowId: sow.id, status: "ACTIVE", farmId: ctx.farmId },
  });
  if (active)
    throw new ServiceError("INVALID_INPUT", `${sow.tagId} already has an active pregnancy`);

  if (input.boarId) {
    const boar = await db.pig.findFirst({
      where: { id: input.boarId, farmId: ctx.farmId, deletedAt: null },
    });
    if (!boar) throw new ServiceError("NOT_FOUND", "Boar not found");
    if (boar.sex !== "MALE") throw new ServiceError("INVALID_INPUT", "Boar must be male");
    if (boar.castrated) throw new ServiceError("INVALID_INPUT", "Boar is castrated");
  }

  const breeding = await db.breeding.create({
    data: {
      farmId: ctx.farmId,
      sowId: sow.id,
      boarId: input.boarId || null,
      crossingDate: input.crossingDate,
    },
  });

  await db.pig.update({ where: { id: sow.id }, data: { readyForCrossing: false } });
  await syncStatus(sow.id, settings);

  const g = gestation(input.crossingDate, settings);
  await logAudit(ctx, {
    action: "BREEDING",
    entityType: "Pig",
    entityId: sow.id,
    summary: `Crossed ${sow.tagId}; due ${g.expectedFarrowingDate.toISOString().slice(0, 10)}`,
    after: input,
  });
  return breeding;
}

export async function recordFarrowing(
  ctx: Ctx,
  input: { breedingId: string; farrowedAt: Date; bornAlive: number; stillborn: number }
) {
  assertCan(ctx.role, "breeding:update");
  const settings = await getSettings(ctx.farmId);
  const breeding = await db.breeding.findFirst({
    where: { id: input.breedingId, farmId: ctx.farmId },
    include: { sow: true, litter: true },
  });
  if (!breeding) throw new ServiceError("NOT_FOUND", "Breeding record not found");
  if (breeding.status !== "ACTIVE")
    throw new ServiceError("INVALID_INPUT", "Breeding is not active");
  if (breeding.litter) throw new ServiceError("INVALID_INPUT", "Litter already recorded");
  if (input.farrowedAt < breeding.crossingDate)
    throw new ServiceError("INVALID_INPUT", "Farrowing date is before crossing date");

  const litter = await db.litter.create({
    data: {
      farmId: ctx.farmId,
      breedingId: breeding.id,
      farrowedAt: input.farrowedAt,
      bornAlive: input.bornAlive,
      stillborn: input.stillborn,
    },
  });
  await db.breeding.update({ where: { id: breeding.id }, data: { status: "FARROWED" } });
  await syncStatus(breeding.sowId, settings);

  await logAudit(ctx, {
    action: "FARROW",
    entityType: "Pig",
    entityId: breeding.sowId,
    summary: `${breeding.sow.tagId} farrowed: ${input.bornAlive} alive, ${input.stillborn} stillborn`,
    after: input,
  });
  return { litter, sow: breeding.sow };
}

export async function closeBreeding(ctx: Ctx, breedingId: string, status: "FAILED" | "ABORTED") {
  assertCan(ctx.role, "breeding:update");
  const settings = await getSettings(ctx.farmId);
  const breeding = await db.breeding.findFirst({
    where: { id: breedingId, farmId: ctx.farmId },
    include: { sow: true },
  });
  if (!breeding) throw new ServiceError("NOT_FOUND", "Breeding record not found");
  if (breeding.status !== "ACTIVE")
    throw new ServiceError("INVALID_INPUT", "Breeding is not active");

  await db.breeding.update({ where: { id: breedingId }, data: { status } });
  await syncStatus(breeding.sowId, settings);
  await logAudit(ctx, {
    action: "BREEDING",
    entityType: "Pig",
    entityId: breeding.sowId,
    summary: `Pregnancy for ${breeding.sow.tagId} marked ${status.toLowerCase()}`,
    before: { status: "ACTIVE" },
    after: { status },
  });
}

export async function listActivePregnancies(ctx: Ctx) {
  assertCan(ctx.role, "pig:view");
  const settings = await getSettings(ctx.farmId);
  const rows = await db.breeding.findMany({
    where: { farmId: ctx.farmId, status: "ACTIVE" },
    include: {
      sow: { select: { id: true, tagId: true, breed: true } },
      boar: { select: { tagId: true } },
    },
  });
  return rows
    .map((b) => {
      const g = gestation(b.crossingDate, settings);
      return {
        id: b.id,
        sowId: b.sow.id,
        sowTag: b.sow.tagId,
        sowBreed: b.sow.breed,
        boarId: b.boarId,
        boarTag: b.boar?.tagId ?? null,
        crossingDate: b.crossingDate.toISOString(),
        daysPregnant: g.daysPregnant,
        daysRemaining: g.daysRemaining,
        expectedFarrowingDate: g.expectedFarrowingDate.toISOString(),
        isOverdue: g.isOverdue,
        overdueDays: g.overdueDays,
        gestationDays: settings.gestationDays,
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export async function exportBreedings(ctx: Ctx) {
  assertCan(ctx.role, "data:export");
  const pregnancies = await listActivePregnancies(ctx);
  const litters = await listRecentLitters(ctx, 1000);
  const rows: Record<string, string | number>[] = [];
  for (const p of pregnancies) {
    rows.push({
      type: "PREGNANCY",
      sowTag: p.sowTag,
      boarTag: p.boarTag ?? "",
      crossingDate: p.crossingDate.slice(0, 10),
      status: p.isOverdue ? "OVERDUE" : "ACTIVE",
      daysPregnant: p.daysPregnant,
      daysRemaining: p.daysRemaining,
      expectedFarrowingDate: p.expectedFarrowingDate.slice(0, 10),
      bornAlive: "",
      stillborn: "",
    });
  }
  for (const l of litters) {
    rows.push({
      type: "LITTER",
      sowTag: l.sowTag,
      boarTag: "",
      crossingDate: "",
      status: "FARROWED",
      daysPregnant: "",
      daysRemaining: "",
      expectedFarrowingDate: l.farrowedAt.slice(0, 10),
      bornAlive: l.bornAlive,
      stillborn: l.stillborn,
    });
  }
  return rows;
}

export async function listRecentLitters(ctx: Ctx, limit = 10) {
  assertCan(ctx.role, "pig:view");
  const rows = await db.litter.findMany({
    where: { farmId: ctx.farmId },
    orderBy: { farrowedAt: "desc" },
    take: limit,
    include: { breeding: { include: { sow: { select: { tagId: true } } } } },
  });
  return rows.map((l) => ({
    id: l.id,
    sowTag: l.breeding.sow.tagId,
    farrowedAt: l.farrowedAt.toISOString(),
    bornAlive: l.bornAlive,
    stillborn: l.stillborn,
  }));
}
