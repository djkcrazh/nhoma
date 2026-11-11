import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { getSettings } from "./settings.service";
import { enrichPig, syncStatus, pigInclude, ServiceError } from "./pig.service";
import { MAX_IMPORT_ROWS, importTxTimeoutMs } from "@/lib/import/columns";
import { applyMapping, needsDateOrderConfirmation, needsNumberFormatConfirmation, type ImportMapping } from "@/lib/import/mapping";
import { validateImportRows, type ExistingPig, type ImportRow, type RowResult } from "@/lib/import/validate";

export type { ImportRow, RowResult };

/**
 * Two-pass CSV import: pass 1 creates pigs, pass 2 links parents by tagId,
 * so file order never matters. dryRun validates everything without writing.
 *
 * `records` are the raw file rows keyed by the FARM'S headers; `mapping` says
 * how to read them. Translation (applyMapping) and validation
 * (validateImportRows) are pure and live in src/lib/import/.
 */
export async function importPigs(
  ctx: Ctx,
  records: Record<string, string | undefined>[],
  mapping: ImportMapping,
  dryRun: boolean,
) {
  assertCan(ctx.role, "data:import");
  if (records.length > MAX_IMPORT_ROWS)
    throw new ServiceError(
      "IMPORT_TOO_LARGE",
      `This file has ${records.length} rows. Import up to ${MAX_IMPORT_ROWS} rows at a time.`,
    );
  // A model or script may PROPOSE a day/month order, but writing pigs needs a
  // person's confirmation: a wrong order silently swaps day and month for every pig.
  // Dry runs stay free so the report can show what each reading would produce.
  if (!dryRun && needsDateOrderConfirmation(mapping))
    throw new ServiceError(
      "DATE_ORDER_UNCONFIRMED",
      "Confirm whether your dates are day-first or month-first before importing.",
    );
  // Same rule for numbers: "1,200" is 1200 in English and 1.2 in French.
  if (!dryRun && needsNumberFormatConfirmation(mapping, records))
    throw new ServiceError(
      "NUMBER_FORMAT_UNCONFIRMED",
      "Confirm how your weights are written (1,200 can mean 1200 or 1.2) before importing.",
    );
  const settings = await getSettings(ctx.farmId);

  // Includes soft-deleted pigs: they still occupy the (farmId, tagId) unique index.
  const existing = await db.pig.findMany({
    where: { farmId: ctx.farmId },
    select: { tagId: true, sex: true, id: true, deletedAt: true },
  });
  const existingByTag = new Map<string, ExistingPig>(
    existing.map((p) => [p.tagId.toLowerCase(), { id: p.id, sex: p.sex, deleted: p.deletedAt !== null }]),
  );

  const mapped = applyMapping(records, mapping);
  const { results, valid } = validateImportRows(mapped.rows, existingByTag, mapped.issues);

  const summary = {
    total: records.length,
    valid: valid.length,
    invalid: records.length - valid.length,
    results,
    imported: 0,
  };
  if (dryRun || valid.length === 0) return summary;

  // Pass 1 + 2 run in one transaction: a mid-import failure (bad connection,
  // constraint violation on a row we didn't anticipate) must roll back the
  // whole batch rather than leave a partially-imported, partially-linked herd.
  // Breeds and notes are batched into one query each so the cost per row is at
  // most three queries (create pig, create weight, link parents + weight).
  const createdByTag = new Map<string, string>();
  try {
    await db.$transaction(
      async (tx) => {
        const breedNames = [...new Set(valid.map(({ data }) => data.breed))];
        await tx.breed.createMany({
          data: breedNames.map((name) => ({ farmId: ctx.farmId, name })),
          skipDuplicates: true,
        });

        // Pass 1: create pigs (+ weights)
        const weightIdByTag = new Map<string, string>();
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
            weightIdByTag.set(r.tagId.toLowerCase(), wr.id);
          }
        }

        const notes = valid.filter(({ data }) => data.notes);
        if (notes.length > 0) {
          await tx.note.createMany({
            data: notes.map(({ data }) => ({
              farmId: ctx.farmId,
              pigId: createdByTag.get(data.tagId.toLowerCase())!,
              authorId: ctx.userId,
              body: data.notes!,
            })),
          });
        }

        // Pass 2: link parents and the current-weight pointer
        const resolve = (tag?: string) =>
          tag
            ? createdByTag.get(tag.toLowerCase()) ?? existingByTag.get(tag.toLowerCase())?.id ?? null
            : null;
        for (const { data: r } of valid) {
          const key = r.tagId.toLowerCase();
          const currentWeightId = weightIdByTag.get(key);
          if (!r.motherTagId && !r.fatherTagId && !currentWeightId) continue;
          await tx.pig.update({
            where: { id: createdByTag.get(key)! },
            data: { motherId: resolve(r.motherTagId), fatherId: resolve(r.fatherTagId), currentWeightId },
          });
        }
      },
      { timeout: importTxTimeoutMs(valid.length), maxWait: 10_000 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // Unique constraint: someone added one of these tags after the dry run.
      if (e.code === "P2002")
        throw new ServiceError(
          "IMPORT_CONFLICT",
          "A tag ID in this file was added to the farm while you were reviewing it. Nothing was imported — choose the file again to re-check it.",
        );
      // Interactive transaction expired or could not start in time.
      if (e.code === "P2028")
        throw new ServiceError(
          "IMPORT_TIMEOUT",
          "The import took too long and was rolled back. Nothing was imported — try a smaller file.",
        );
    }
    throw e;
  }

  for (const id of createdByTag.values()) await syncStatus(id, settings);

  await logAudit(ctx, {
    action: "IMPORT",
    entityType: "Pig",
    entityId: "bulk",
    summary:
      `Imported ${valid.length} pigs from CSV (${summary.invalid} rows skipped)` +
      (mapping.fields.dateOfBirth?.source ? `; dates read as ${mapping.transforms.dateFormat}` : "") +
      (mapping.fields.weightKg?.source ? `; numbers read as ${mapping.transforms.numberFormat === "en" ? "1,234.5" : "1.234,5"}` : ""),
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
