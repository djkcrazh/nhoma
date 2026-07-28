import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { getSettings } from "./settings.service";
import {
  ageDays,
  ageLabel,
  computeWarnings,
  gestation,
  isMarketReady,
  resolveStatus,
} from "@/lib/domain/compute";
import { DomainPig, FarmSettings, PigStatus, Sex } from "@/lib/domain/types";
import { PigCreateInput, PigUpdateInput } from "@/lib/validations/pig";
import type { Prisma } from "@prisma/client";

export class ServiceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

// ---------- shared includes & mapping ----------

const pigInclude = {
  mother: { select: { id: true, tagId: true, breed: true, deletedAt: true } },
  father: { select: { id: true, tagId: true, breed: true, deletedAt: true } },
  weightRecords: { orderBy: { measuredAt: "desc" as const }, take: 1 },
  breedingsAsSow: {
    where: { status: "ACTIVE" },
    orderBy: { crossingDate: "desc" as const },
    take: 1,
  },
};

type PigRow = Prisma.PigGetPayload<{ include: typeof pigInclude }>;

export function toDomainPig(pig: PigRow): DomainPig {
  const latest = pig.weightRecords[0] ?? null;
  const active = pig.breedingsAsSow[0] ?? null;
  return {
    id: pig.id,
    sex: pig.sex as Sex,
    dateOfBirth: pig.dateOfBirth,
    status: pig.status as PigStatus,
    readyForCrossing: pig.readyForCrossing,
    breedingStock: pig.breedingStock,
    castrated: pig.castrated,
    soldAt: pig.soldAt,
    diedAt: pig.diedAt,
    currentWeightKg: latest?.weightKg ?? null,
    lastWeighedAt: latest?.measuredAt ?? null,
    motherId: pig.motherId,
    fatherId: pig.fatherId,
    activeBreeding: active ? { crossingDate: active.crossingDate } : null,
  };
}

/** UI-facing pig with all derived fields attached. */
export function enrichPig(pig: PigRow, settings: FarmSettings, now = new Date()) {
  const d = toDomainPig(pig);
  const g = d.activeBreeding ? gestation(d.activeBreeding.crossingDate, settings, now) : null;
  return {
    id: pig.id,
    tagId: pig.tagId,
    breed: pig.breed,
    sex: d.sex,
    dateOfBirth: pig.dateOfBirth.toISOString(),
    ageDays: ageDays(pig.dateOfBirth, now),
    ageLabel: ageLabel(pig.dateOfBirth, now),
    status: resolveStatus(d, settings, now),
    weightKg: d.currentWeightKg,
    lastWeighedAt: d.lastWeighedAt?.toISOString() ?? null,
    mother: pig.mother ? { id: pig.mother.id, tagId: pig.mother.tagId, breed: pig.mother.breed, removed: !!pig.mother.deletedAt } : null,
    father: pig.father ? { id: pig.father.id, tagId: pig.father.tagId, breed: pig.father.breed, removed: !!pig.father.deletedAt } : null,
    readyForCrossing: pig.readyForCrossing,
    breedingStock: pig.breedingStock,
    castrated: pig.castrated,
    marketReady: isMarketReady(d, settings, now) && !pig.breedingStock,
    gestation: g
      ? {
          daysPregnant: g.daysPregnant,
          daysRemaining: g.daysRemaining,
          expectedFarrowingDate: g.expectedFarrowingDate.toISOString(),
          isOverdue: g.isOverdue,
          overdueDays: g.overdueDays,
        }
      : null,
    warnings: computeWarnings(d, settings, now),
    soldAt: pig.soldAt?.toISOString() ?? null,
    diedAt: pig.diedAt?.toISOString() ?? null,
    createdAt: pig.createdAt.toISOString(),
    updatedAt: pig.updatedAt.toISOString(),
  };
}

export type EnrichedPig = ReturnType<typeof enrichPig>;

/** Recompute + persist materialized status. Call inside every mutation. */
export async function syncStatus(pigId: string, settings: FarmSettings) {
  const pig = await db.pig.findUnique({ where: { id: pigId }, include: pigInclude });
  if (!pig) return;
  const next = resolveStatus(toDomainPig(pig), settings);
  if (next !== pig.status) {
    await db.pig.update({ where: { id: pigId }, data: { status: next } });
  }
  return next;
}

// ---------- validation helpers ----------

async function validateParents(
  farmId: string,
  pigId: string | null,
  motherId?: string | null,
  fatherId?: string | null,
  childDob?: Date
) {
  for (const [parentId, expectedSex, label] of [
    [motherId, "FEMALE", "Mother"],
    [fatherId, "MALE", "Father"],
  ] as const) {
    if (!parentId) continue;
    if (pigId && parentId === pigId)
      throw new ServiceError("INVALID_PARENT", "A pig cannot be its own parent");
    const parent = await db.pig.findFirst({ where: { id: parentId, farmId } });
    if (!parent) throw new ServiceError("INVALID_PARENT", `${label} not found`);
    if (parent.sex !== expectedSex)
      throw new ServiceError("INVALID_PARENT", `${label} must be ${expectedSex === "FEMALE" ? "female" : "male"}`);
    if (childDob && parent.dateOfBirth >= childDob)
      throw new ServiceError("INVALID_PARENT", `${label} must be born before the pig`);
    // Cycle detection: walk this parent's ancestors; the pig must not appear.
    if (pigId) {
      const seen = new Set<string>();
      let frontier = [parentId];
      while (frontier.length) {
        const rows = await db.pig.findMany({
          where: { id: { in: frontier } },
          select: { motherId: true, fatherId: true },
        });
        frontier = [];
        for (const r of rows) {
          for (const anc of [r.motherId, r.fatherId]) {
            if (!anc || seen.has(anc)) continue;
            if (anc === pigId)
              throw new ServiceError("INVALID_PARENT", "Lineage cycle detected");
            seen.add(anc);
            frontier.push(anc);
          }
        }
      }
    }
  }
}

async function assertUniqueTag(farmId: string, tagId: string, excludeId?: string) {
  const existing = await db.pig.findFirst({
    where: { farmId, tagId, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing)
    throw new ServiceError("DUPLICATE_TAG_ID", `Tag ID "${tagId}" already exists`);
}

// ---------- queries ----------

export interface PigListParams {
  search?: string;
  status?: string[];
  sex?: Sex;
  breed?: string;
  quick?: string; // named quick filters
  page?: number;
  pageSize?: number;
  sort?: string; // field:dir
  includeClosed?: boolean; // sold/dead/inactive
}

export async function listPigs(ctx: Ctx, params: PigListParams) {
  assertCan(ctx.role, "pig:view");
  const settings = await getSettings(ctx.farmId);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, params.pageSize ?? 25));

  const where: Prisma.PigWhereInput = { farmId: ctx.farmId, deletedAt: null };

  if (params.search) {
    const q = params.search.trim();
    where.OR = [
      { tagId: { contains: q } },
      { breed: { contains: q } },
      { mother: { tagId: { contains: q } } },
      { father: { tagId: { contains: q } } },
      { notes: { some: { body: { contains: q } } } },
      { status: { contains: q.toUpperCase().replace(/ /g, "_") } },
    ];
  }
  if (params.status?.length) where.status = { in: params.status };
  if (params.sex) where.sex = params.sex;
  if (params.breed) where.breed = params.breed;

  switch (params.quick) {
    case "male": where.sex = "MALE"; break;
    case "female": where.sex = "FEMALE"; break;
    case "piglets": where.status = "PIGLET"; break;
    case "pregnant": where.status = { in: ["PREGNANT", "READY_TO_FARROW"] }; break;
    case "crossing": where.status = "READY_FOR_CROSSING"; break;
    case "market": where.status = "READY_FOR_MARKET"; break;
    case "farrow": where.status = "READY_TO_FARROW"; break;
    case "castrated": where.castrated = true; break;
    case "recent": where.createdAt = { gte: new Date(Date.now() - 30 * 86_400_000) }; break;
    case "sold": where.status = "SOLD"; break;
    case "inactive": where.status = "INACTIVE"; break;
    case "adults": where.status = { notIn: ["PIGLET"] }; break;
  }
  // Hide closed pigs by default unless explicitly requested
  if (!params.includeClosed && !["sold", "inactive"].includes(params.quick ?? "") && !params.status?.some((s) => ["SOLD", "DEAD", "INACTIVE"].includes(s))) {
    where.AND = [{ status: { notIn: ["SOLD", "DEAD", "INACTIVE"] } }];
  }

  const [field, dir] = (params.sort ?? "tagId:asc").split(":");
  const dirTyped = dir === "desc" ? ("desc" as const) : ("asc" as const);
  const sortable: Record<string, Prisma.PigOrderByWithRelationInput> = {
    tagId: { tagId: dirTyped },
    breed: { breed: dirTyped },
    sex: { sex: dirTyped },
    age: { dateOfBirth: dir === "desc" ? "asc" : "desc" }, // older = greater age
    status: { status: dirTyped },
    createdAt: { createdAt: dirTyped },
  };

  const [total, rows] = await Promise.all([
    db.pig.count({ where }),
    db.pig.findMany({
      where,
      include: pigInclude,
      orderBy: sortable[field] ?? { tagId: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    pigs: rows.map((r) => enrichPig(r, settings)),
    total,
    page,
    pageSize,
    pageCount: Math.ceil(total / pageSize),
  };
}

export async function getPigByTag(ctx: Ctx, tagId: string) {
  assertCan(ctx.role, "pig:view");
  const settings = await getSettings(ctx.farmId);
  const pig = await db.pig.findFirst({
    where: { farmId: ctx.farmId, tagId },
    include: {
      ...pigInclude,
      weightRecords: { orderBy: { measuredAt: "desc" as const } },
      breedingsAsSow: { orderBy: { crossingDate: "desc" as const }, include: { litter: true, boar: { select: { tagId: true } } } },
      breedingsAsBoar: { orderBy: { crossingDate: "desc" as const }, include: { sow: { select: { tagId: true } } } },
      notes: { orderBy: { createdAt: "desc" as const }, include: { author: { select: { name: true } } } },
    },
  });
  if (!pig) return null;

  const [offspring, siblings, activity] = await Promise.all([
    db.pig.findMany({
      where: { farmId: ctx.farmId, deletedAt: null, OR: [{ motherId: pig.id }, { fatherId: pig.id }] },
      include: pigInclude,
      orderBy: { dateOfBirth: "desc" },
    }),
    pig.motherId || pig.fatherId
      ? db.pig.findMany({
          where: {
            farmId: ctx.farmId,
            deletedAt: null,
            id: { not: pig.id },
            OR: [
              ...(pig.motherId ? [{ motherId: pig.motherId }] : []),
              ...(pig.fatherId ? [{ fatherId: pig.fatherId }] : []),
            ],
          },
          include: pigInclude,
          orderBy: { dateOfBirth: "desc" },
        })
      : Promise.resolve([]),
    db.auditLog.findMany({
      where: { farmId: ctx.farmId, entityType: "Pig", entityId: pig.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const activeBreedingRow = pig.breedingsAsSow.find((b) => b.status === "ACTIVE") ?? null;
  return {
    ...enrichPig({ ...pig, breedingsAsSow: activeBreedingRow ? [activeBreedingRow] : [] } as PigRow, settings),
    deletedAt: pig.deletedAt?.toISOString() ?? null,
    weightHistory: pig.weightRecords.map((w) => ({
      id: w.id,
      weightKg: w.weightKg,
      measuredAt: w.measuredAt.toISOString(),
    })),
    breedingHistory: pig.breedingsAsSow.map((b) => ({
      id: b.id,
      crossingDate: b.crossingDate.toISOString(),
      boarTag: b.boar?.tagId ?? null,
      status: b.status,
      litter: b.litter
        ? { farrowedAt: b.litter.farrowedAt.toISOString(), bornAlive: b.litter.bornAlive, stillborn: b.litter.stillborn }
        : null,
    })),
    siredBreedings: pig.breedingsAsBoar.map((b) => ({
      id: b.id,
      crossingDate: b.crossingDate.toISOString(),
      sowTag: b.sow.tagId,
      status: b.status,
    })),
    offspring: offspring.map((o) => enrichPig(o, settings)),
    siblings: siblings.map((s) => enrichPig(s, settings)),
    notes: pig.notes.map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author?.name ?? "Unknown",
      createdAt: n.createdAt.toISOString(),
    })),
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      summary: a.summary,
      user: a.user?.name ?? "System",
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

const lineageSelect = {
  id: true,
  tagId: true,
  breed: true,
  sex: true,
  dateOfBirth: true,
  status: true,
  deletedAt: true,
};

type LineageRow = Prisma.PigGetPayload<{ select: typeof lineageSelect }>;

function toLineageNode(pig: LineageRow) {
  return {
    id: pig.id,
    tagId: pig.tagId,
    breed: pig.breed,
    sex: pig.sex as Sex,
    ageLabel: ageLabel(pig.dateOfBirth),
    status: pig.status as PigStatus,
    removed: !!pig.deletedAt,
  };
}

/** Lightweight parents + siblings lookup for the family tree explorer — re-fetched on every node click. */
export async function getPigLineage(ctx: Ctx, tagId: string) {
  assertCan(ctx.role, "pig:view");
  const pig = await db.pig.findFirst({
    where: { farmId: ctx.farmId, tagId },
    select: { ...lineageSelect, motherId: true, fatherId: true, mother: { select: lineageSelect }, father: { select: lineageSelect } },
  });
  if (!pig) return null;

  const [siblings, offspring] = await Promise.all([
    pig.motherId || pig.fatherId
      ? db.pig.findMany({
          where: {
            farmId: ctx.farmId,
            deletedAt: null,
            id: { not: pig.id },
            OR: [
              ...(pig.motherId ? [{ motherId: pig.motherId }] : []),
              ...(pig.fatherId ? [{ fatherId: pig.fatherId }] : []),
            ],
          },
          select: lineageSelect,
          orderBy: { dateOfBirth: "desc" as const },
        })
      : Promise.resolve([]),
    db.pig.findMany({
      where: { farmId: ctx.farmId, deletedAt: null, OR: [{ motherId: pig.id }, { fatherId: pig.id }] },
      select: lineageSelect,
      orderBy: { dateOfBirth: "desc" as const },
    }),
  ]);

  return {
    self: toLineageNode(pig),
    mother: pig.mother ? toLineageNode(pig.mother) : null,
    father: pig.father ? toLineageNode(pig.father) : null,
    siblings: siblings.map(toLineageNode),
    offspring: offspring.map(toLineageNode),
  };
}

/** Autocomplete for parent pickers etc. */
export async function searchPigOptions(ctx: Ctx, query: string, sex?: Sex) {
  assertCan(ctx.role, "pig:view");
  const rows = await db.pig.findMany({
    where: {
      farmId: ctx.farmId,
      deletedAt: null,
      diedAt: null,
      ...(sex ? { sex } : {}),
      ...(query ? { tagId: { contains: query } } : {}),
    },
    select: { id: true, tagId: true, breed: true, sex: true, status: true },
    orderBy: { tagId: "asc" },
    take: 12,
  });
  return rows;
}

export async function suggestNextTagId(ctx: Ctx): Promise<string> {
  const rows = await db.pig.findMany({
    where: { farmId: ctx.farmId },
    select: { tagId: true },
  });
  let max = 0;
  let prefix = "PIG-";
  for (const { tagId } of rows) {
    const m = tagId.match(/^([A-Za-z-]*)(\d+)$/);
    if (m) {
      const n = parseInt(m[2], 10);
      if (n > max) {
        max = n;
        prefix = m[1];
      }
    }
  }
  const width = Math.max(3, String(max + 1).length);
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

// ---------- mutations ----------

export async function createPig(ctx: Ctx, input: PigCreateInput) {
  assertCan(ctx.role, "pig:create");
  const settings = await getSettings(ctx.farmId);
  await assertUniqueTag(ctx.farmId, input.tagId);
  await validateParents(ctx.farmId, null, input.motherId, input.fatherId, input.dateOfBirth);

  const breed = input.breed;

  const pig = await db.pig.create({
    data: {
      farmId: ctx.farmId,
      tagId: input.tagId,
      breed,
      sex: input.sex,
      dateOfBirth: input.dateOfBirth,
      motherId: input.motherId || null,
      fatherId: input.fatherId || null,
      castrated: input.sex === "MALE" ? input.castrated ?? false : null,
      breedingStock: input.breedingStock ?? false,
    },
  });

  if (input.weightKg) {
    const wr = await db.weightRecord.create({
      data: {
        farmId: ctx.farmId,
        pigId: pig.id,
        weightKg: input.weightKg,
        measuredAt: new Date(),
        recordedById: ctx.userId,
      },
    });
    await db.pig.update({ where: { id: pig.id }, data: { currentWeightId: wr.id } });
  }
  if (input.notes?.trim()) {
    await db.note.create({
      data: { farmId: ctx.farmId, pigId: pig.id, authorId: ctx.userId, body: input.notes.trim() },
    });
  }

  // Ensure the breed exists in the lookup list for future autocomplete
  await db.breed.upsert({
    where: { farmId_name: { farmId: ctx.farmId, name: breed } },
    create: { farmId: ctx.farmId, name: breed },
    update: {},
  });

  await syncStatus(pig.id, settings);
  await logAudit(ctx, {
    action: "CREATE",
    entityType: "Pig",
    entityId: pig.id,
    summary: `Added pig ${pig.tagId} (${breed}, ${input.sex.toLowerCase()})`,
    after: { ...input, breed },
  });
  return pig;
}

export async function updatePig(ctx: Ctx, pigId: string, input: PigUpdateInput) {
  assertCan(ctx.role, "pig:update");
  const settings = await getSettings(ctx.farmId);
  const existing = await db.pig.findFirst({ where: { id: pigId, farmId: ctx.farmId } });
  if (!existing) throw new ServiceError("NOT_FOUND", "Pig not found");

  const sex = input.sex ?? (existing.sex as Sex);
  if (sex === "FEMALE" && input.castrated)
    throw new ServiceError("INVALID_INPUT", "Female pigs cannot be castrated");
  if (input.tagId && input.tagId !== existing.tagId)
    await assertUniqueTag(ctx.farmId, input.tagId, pigId);
  if (input.motherId !== undefined || input.fatherId !== undefined) {
    await validateParents(
      ctx.farmId,
      pigId,
      input.motherId === undefined ? existing.motherId : input.motherId,
      input.fatherId === undefined ? existing.fatherId : input.fatherId,
      input.dateOfBirth ?? existing.dateOfBirth
    );
  }
  if (input.sex && input.sex !== existing.sex) {
    const [asMother, asFather, asSow] = await Promise.all([
      db.pig.count({ where: { motherId: pigId } }),
      db.pig.count({ where: { fatherId: pigId } }),
      db.breeding.count({ where: { sowId: pigId } }),
    ]);
    if ((input.sex === "MALE" && (asMother > 0 || asSow > 0)) || (input.sex === "FEMALE" && asFather > 0))
      throw new ServiceError("INVALID_INPUT", "Cannot change sex: pig has lineage or breeding records as the other sex");
  }

  const updated = await db.pig.update({
    where: { id: pigId },
    data: {
      ...(input.tagId !== undefined ? { tagId: input.tagId } : {}),
      ...(input.breed !== undefined ? { breed: input.breed } : {}),
      ...(input.sex !== undefined ? { sex: input.sex } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.motherId !== undefined ? { motherId: input.motherId } : {}),
      ...(input.fatherId !== undefined ? { fatherId: input.fatherId } : {}),
      ...(input.castrated !== undefined ? { castrated: sex === "MALE" ? input.castrated : null } : {}),
      ...(input.readyForCrossing !== undefined ? { readyForCrossing: input.readyForCrossing } : {}),
      ...(input.breedingStock !== undefined ? { breedingStock: input.breedingStock } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  });

  await syncStatus(pigId, settings);
  await logAudit(ctx, {
    action: "UPDATE",
    entityType: "Pig",
    entityId: pigId,
    summary: `Updated pig ${updated.tagId}`,
    before: existing,
    after: input,
  });
  return updated;
}

export async function markSold(ctx: Ctx, pigId: string, soldAt: Date) {
  return closePig(ctx, pigId, { soldAt }, "SOLD");
}

export async function markDead(ctx: Ctx, pigId: string, diedAt: Date) {
  return closePig(ctx, pigId, { diedAt }, "DEAD");
}

async function closePig(
  ctx: Ctx,
  pigId: string,
  data: { soldAt?: Date; diedAt?: Date },
  status: "SOLD" | "DEAD"
) {
  assertCan(ctx.role, "pig:update");
  const pig = await db.pig.findFirst({ where: { id: pigId, farmId: ctx.farmId } });
  if (!pig) throw new ServiceError("NOT_FOUND", "Pig not found");

  // A pregnant sow being closed must have its active breeding resolved
  const active = await db.breeding.findFirst({ where: { sowId: pigId, status: "ACTIVE" } });
  if (active) {
    await db.breeding.update({ where: { id: active.id }, data: { status: "FAILED" } });
  }

  await db.pig.update({ where: { id: pigId }, data: { ...data, status } });
  await logAudit(ctx, {
    action: "STATUS_CHANGE",
    entityType: "Pig",
    entityId: pigId,
    summary: `Marked ${pig.tagId} as ${status.toLowerCase()}${active ? " (active breeding closed)" : ""}`,
    before: { status: pig.status },
    after: { status, ...data },
  });
}

export async function deletePig(ctx: Ctx, pigId: string) {
  assertCan(ctx.role, "pig:delete");
  const pig = await db.pig.findFirst({ where: { id: pigId, farmId: ctx.farmId } });
  if (!pig) throw new ServiceError("NOT_FOUND", "Pig not found");
  await db.pig.update({
    where: { id: pigId },
    data: { deletedAt: new Date(), status: "INACTIVE" },
  });
  await logAudit(ctx, {
    action: "DELETE",
    entityType: "Pig",
    entityId: pigId,
    summary: `Removed pig ${pig.tagId}`,
    before: pig,
  });
}

export async function bulkUpdateStatus(ctx: Ctx, pigIds: string[], action: "SOLD" | "INACTIVE" | "DELETE") {
  const results = { ok: 0, failed: 0 };
  for (const id of pigIds) {
    try {
      if (action === "SOLD") await markSold(ctx, id, new Date());
      else if (action === "DELETE") await deletePig(ctx, id);
      else {
        await updatePig(ctx, id, { status: "INACTIVE" });
      }
      results.ok++;
    } catch {
      results.failed++;
    }
  }
  return results;
}
