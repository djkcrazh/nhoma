import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { getSettings } from "./settings.service";
import { enrichPig, syncStatus } from "./pig.service";
import { pigCreateSchema } from "@/lib/validations/pig";

export interface ImportRow {
  tagId: string;
  breed: string;
  sex: string;
  dateOfBirth: string;
  weightKg?: string;
  motherTagId?: string;
  fatherTagId?: string;
  castrated?: string;
  notes?: string;
}

export interface RowResult {
  row: number;
  tagId: string;
  ok: boolean;
  errors: string[];
}

/**
 * Two-pass CSV import: pass 1 creates pigs, pass 2 links parents by tagId,
 * so file order never matters. dryRun validates everything without writing.
 */
export async function importPigs(ctx: Ctx, rows: ImportRow[], dryRun: boolean) {
  assertCan(ctx.role, "data:import");
  const settings = await getSettings(ctx.farmId);

  const existing = await db.pig.findMany({
    where: { farmId: ctx.farmId },
    select: { tagId: true, sex: true, id: true },
  });
  const existingByTag = new Map(existing.map((p) => [p.tagId.toLowerCase(), p]));
  const fileTags = new Map<string, { sex: string; row: number }>();

  const results: RowResult[] = [];
  const valid: { row: number; data: ReturnType<typeof normalizeRow> }[] = [];

  function normalizeRow(r: ImportRow) {
    return {
      tagId: (r.tagId ?? "").trim(),
      breed: (r.breed ?? "").trim(),
      sex: (r.sex ?? "").trim().toUpperCase() === "M" ? "MALE" : (r.sex ?? "").trim().toUpperCase() === "F" ? "FEMALE" : (r.sex ?? "").trim().toUpperCase(),
      dateOfBirth: (r.dateOfBirth ?? "").trim(),
      weightKg: r.weightKg?.trim() || undefined,
      motherTagId: r.motherTagId?.trim() || undefined,
      fatherTagId: r.fatherTagId?.trim() || undefined,
      castrated: ["yes", "true", "1", "y"].includes((r.castrated ?? "").trim().toLowerCase()),
      notes: r.notes?.trim() || undefined,
    };
  }

  rows.forEach((raw, i) => {
    const rowNum = i + 2; // header is row 1
    const r = normalizeRow(raw);
    const errors: string[] = [];

    const parsed = pigCreateSchema.safeParse({
      tagId: r.tagId,
      breed: r.breed,
      sex: r.sex,
      dateOfBirth: r.dateOfBirth,
      weightKg: r.weightKg,
      castrated: r.sex === "MALE" ? r.castrated : undefined,
      notes: r.notes,
    });
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`));
    }
    if (r.tagId && existingByTag.has(r.tagId.toLowerCase()))
      errors.push(`Tag ID "${r.tagId}" already exists on the farm`);
    if (r.tagId && fileTags.has(r.tagId.toLowerCase()))
      errors.push(`Duplicate tag ID within file (also row ${fileTags.get(r.tagId.toLowerCase())!.row})`);

    // Parent references: must exist on farm or earlier in this file, correct sex
    for (const [ref, wantSex, label] of [
      [r.motherTagId, "FEMALE", "Mother"],
      [r.fatherTagId, "MALE", "Father"],
    ] as const) {
      if (!ref) continue;
      if (ref.toLowerCase() === r.tagId.toLowerCase()) {
        errors.push(`${label} cannot be the pig itself`);
        continue;
      }
      const onFarm = existingByTag.get(ref.toLowerCase());
      const inFile = fileTags.get(ref.toLowerCase());
      if (!onFarm && !inFile) errors.push(`${label} "${ref}" not found on farm or in file`);
      else if ((onFarm?.sex ?? inFile?.sex) !== wantSex)
        errors.push(`${label} "${ref}" is not ${wantSex === "FEMALE" ? "female" : "male"}`);
    }

    if (r.tagId) fileTags.set(r.tagId.toLowerCase(), { sex: r.sex, row: rowNum });
    results.push({ row: rowNum, tagId: r.tagId || "(blank)", ok: errors.length === 0, errors });
    if (errors.length === 0) valid.push({ row: rowNum, data: r });
  });

  const summary = {
    total: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    results,
    imported: 0,
  };
  if (dryRun || valid.length === 0) return summary;

  // Pass 1: create pigs (+ weights + notes)
  const createdByTag = new Map<string, string>();
  for (const { data: r } of valid) {
    const pig = await db.pig.create({
      data: {
        farmId: ctx.farmId,
        tagId: r.tagId,
        breed: r.breed,
        sex: r.sex,
        dateOfBirth: new Date(r.dateOfBirth),
        castrated: r.sex === "MALE" ? r.castrated : null,
      },
    });
    createdByTag.set(r.tagId.toLowerCase(), pig.id);
    if (r.weightKg) {
      const wr = await db.weightRecord.create({
        data: {
          farmId: ctx.farmId, pigId: pig.id, weightKg: Number(r.weightKg),
          measuredAt: new Date(), recordedById: ctx.userId,
        },
      });
      await db.pig.update({ where: { id: pig.id }, data: { currentWeightId: wr.id } });
    }
    if (r.notes) {
      await db.note.create({
        data: { farmId: ctx.farmId, pigId: pig.id, authorId: ctx.userId, body: r.notes },
      });
    }
    await db.breed.upsert({
      where: { farmId_name: { farmId: ctx.farmId, name: r.breed } },
      create: { farmId: ctx.farmId, name: r.breed },
      update: {},
    });
  }

  // Pass 2: link parents
  for (const { data: r } of valid) {
    if (!r.motherTagId && !r.fatherTagId) continue;
    const resolve = (tag?: string) =>
      tag
        ? createdByTag.get(tag.toLowerCase()) ?? existingByTag.get(tag.toLowerCase())?.id ?? null
        : null;
    await db.pig.update({
      where: { id: createdByTag.get(r.tagId.toLowerCase())! },
      data: { motherId: resolve(r.motherTagId), fatherId: resolve(r.fatherTagId) },
    });
  }

  for (const id of createdByTag.values()) await syncStatus(id, settings);

  await logAudit(ctx, {
    action: "IMPORT",
    entityType: "Pig",
    entityId: "bulk",
    summary: `Imported ${valid.length} pigs from CSV (${summary.invalid} rows skipped)`,
  });
  summary.imported = valid.length;
  return summary;
}

export async function exportPigs(ctx: Ctx) {
  assertCan(ctx.role, "data:export");
  const settings = await getSettings(ctx.farmId);
  const pigs = await db.pig.findMany({
    where: { farmId: ctx.farmId, deletedAt: null },
    include: {
      mother: { select: { id: true, tagId: true, breed: true, deletedAt: true } },
      father: { select: { id: true, tagId: true, breed: true, deletedAt: true } },
      weightRecords: { orderBy: { measuredAt: "desc" as const }, take: 1 },
      breedingsAsSow: { where: { status: "ACTIVE" }, orderBy: { crossingDate: "desc" as const }, take: 1 },
    },
    orderBy: { tagId: "asc" },
  });
  return pigs.map((p) => {
    const e = enrichPig(p, settings);
    return {
      tagId: e.tagId,
      breed: e.breed,
      sex: e.sex,
      dateOfBirth: e.dateOfBirth.slice(0, 10),
      ageDays: e.ageDays,
      weightKg: e.weightKg ?? "",
      lastWeighedAt: e.lastWeighedAt?.slice(0, 10) ?? "",
      motherTagId: e.mother?.tagId ?? "",
      fatherTagId: e.father?.tagId ?? "",
      status: e.status,
      castrated: e.castrated === null ? "" : e.castrated ? "yes" : "no",
      marketReady: e.marketReady ? "yes" : "no",
      daysPregnant: e.gestation?.daysPregnant ?? "",
      daysRemaining: e.gestation?.daysRemaining ?? "",
      expectedFarrowing: e.gestation?.expectedFarrowingDate.slice(0, 10) ?? "",
    };
  });
}
