import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { getSettings } from "./settings.service";
import { enrichPig, syncStatus, pigInclude } from "./pig.service";
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

  const normalized = rows.map((raw, i) => ({ row: i + 2, data: normalizeRow(raw) })); // header is row 1

  // Build the file's tag index up front (first occurrence per tag wins) so a
  // parent listed AFTER its child in the file still resolves — file order
  // must not matter, since pass 1 creates every valid row before pass 2 links.
  const fileTags = new Map<string, { sex: string; row: number }>();
  for (const { row, data: r } of normalized) {
    if (r.tagId && !fileTags.has(r.tagId.toLowerCase())) {
      fileTags.set(r.tagId.toLowerCase(), { sex: r.sex, row });
    }
  }

  const results: RowResult[] = [];
  const resultByRow = new Map<number, RowResult>();

  for (const { row: rowNum, data: r } of normalized) {
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
    const firstOccurrence = r.tagId ? fileTags.get(r.tagId.toLowerCase()) : undefined;
    if (firstOccurrence && firstOccurrence.row !== rowNum)
      errors.push(`Duplicate tag ID within file (also row ${firstOccurrence.row})`);

    // Parent references: must exist on farm or anywhere else in this file, correct sex
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

    const result = { row: rowNum, tagId: r.tagId || "(blank)", ok: errors.length === 0, errors };
    results.push(result);
    resultByRow.set(rowNum, result);
  }

  // A row can only be created if every in-file parent it points to is ALSO
  // going to be created — otherwise pass 2 would silently fall back to a
  // null parent. Propagate invalidity to fixpoint (a bad grandparent should
  // sink its whole in-file lineage, not just its direct child).
  let changed = true;
  while (changed) {
    changed = false;
    for (const { row: rowNum, data: r } of normalized) {
      const result = resultByRow.get(rowNum)!;
      if (!result.ok) continue;
      for (const [ref, label] of [
        [r.motherTagId, "Mother"],
        [r.fatherTagId, "Father"],
      ] as const) {
        if (!ref || existingByTag.has(ref.toLowerCase())) continue;
        const parentRow = fileTags.get(ref.toLowerCase())?.row;
        const parentResult = parentRow ? resultByRow.get(parentRow) : undefined;
        if (parentResult && !parentResult.ok) {
          result.ok = false;
          result.errors.push(`${label} "${ref}" (row ${parentRow}) failed validation`);
          changed = true;
        }
      }
    }
  }

  const valid = normalized
    .filter(({ row }) => resultByRow.get(row)!.ok)
    .map(({ row, data }) => ({ row, data }));

  const summary = {
    total: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    results,
    imported: 0,
  };
  if (dryRun || valid.length === 0) return summary;

  // Pass 1 + 2 run in one transaction: a mid-import failure (bad connection,
  // constraint violation on a row we didn't anticipate) must roll back the
  // whole batch rather than leave a partially-imported, partially-linked herd.
  const createdByTag = new Map<string, string>();
  await db.$transaction(async (tx) => {
    // Pass 1: create pigs (+ weights + notes)
    for (const { data: r } of valid) {
      const pig = await tx.pig.create({
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
        const wr = await tx.weightRecord.create({
          data: {
            farmId: ctx.farmId, pigId: pig.id, weightKg: Number(r.weightKg),
            measuredAt: new Date(), recordedById: ctx.userId,
          },
        });
        await tx.pig.update({ where: { id: pig.id }, data: { currentWeightId: wr.id } });
      }
      if (r.notes) {
        await tx.note.create({
          data: { farmId: ctx.farmId, pigId: pig.id, authorId: ctx.userId, body: r.notes },
        });
      }
      await tx.breed.upsert({
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
      await tx.pig.update({
        where: { id: createdByTag.get(r.tagId.toLowerCase())! },
        data: { motherId: resolve(r.motherTagId), fatherId: resolve(r.fatherTagId) },
      });
    }
  });

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
    include: pigInclude,
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
