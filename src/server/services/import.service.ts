// =============================================================================
// import.service.ts: the SERVER-SIDE import. This is the only place that writes
// imported pigs to the database.
//
// THE FLOW (read top to bottom in importPigs below)
//   1. check the caller may import and the file is not too big
//   2. REFUSE to write if a human has not confirmed the date order / number format
//   3. load the pigs already on the farm (needed to spot duplicates and check parents)
//   4. applyMapping  : farm's rows -> Nhoma's standard rows          (pure, see mapping.ts)
//   5. validateRows  : which standard rows are OK                    (pure, see validate.ts)
//   6. dry run?  -> return the report and STOP (nothing is written)
//   7. otherwise write everything in ONE database transaction (all-or-nothing)
//   8. recompute pig statuses, write an audit-log entry, return the summary
//
// FOR EVALUATIONS: steps 4-5 are pure functions you can call without this file or a database.
// This file is covered by the real-database check (`npm run test:db`, scripts/import-smoke.ts).
//
// Python analogies: `async/await` here is like Python's asyncio; `db` is an ORM client
// (Prisma, similar in spirit to SQLAlchemy); a "transaction" is `with session.begin():`.
// =============================================================================

import { Prisma } from "@prisma/client"; // Prisma = the database library (ORM)
import { db } from "@/server/db"; // the shared database connection
import { Ctx } from "@/server/auth/auth"; // "context": who is making this request (user id, farm id, role)
import { assertCan } from "@/server/auth/permissions"; // raises an error if the role may not do this
import { logAudit } from "./audit.service"; // writes a row to the audit log
import { getSettings } from "./settings.service";
import { enrichPig, syncStatus, pigInclude, ServiceError } from "./pig.service";
import { MAX_IMPORT_ROWS, importTxTimeoutMs } from "@/lib/import/columns";
import { applyMapping, needsDateOrderConfirmation, needsNumberFormatConfirmation, type ImportMapping } from "@/lib/import/mapping";
import { validateImportRows, type ExistingPig, type ImportRow, type RowResult } from "@/lib/import/validate";

// Re-export two types so other files can import them from here. (`export type { ... }` re-exports.)
export type { ImportRow, RowResult };

/**
 * Two-pass CSV import: pass 1 creates pigs, pass 2 links parents by tagId,
 * so file order never matters. dryRun validates everything without writing.
 *
 * `records` are the raw file rows keyed by the FARM'S headers; `mapping` says
 * how to read them. Translation (applyMapping) and validation
 * (validateImportRows) are pure and live in src/lib/import/.
 */
// ARGUMENTS
//   ctx     : who is calling and for which farm (comes from the login session, NOT from the browser)
//   records : the farm's rows, e.g. [{"Pig No": "GH-001", "Sex": "Sow", ...}, ...]
//   mapping : how to read them (see mapping.ts)
//   dryRun  : true  -> validate and report only (what the preview screen uses)
//             false -> actually write the valid rows
// RETURNS (a Promise, i.e. you `await` it, like an async Python function):
//   {total, valid, invalid, results (per-row verdicts), imported (0 for a dry run)}
export async function importPigs(
  ctx: Ctx,
  records: Record<string, string | undefined>[],
  mapping: ImportMapping,
  dryRun: boolean,
) {
  // Step 1: permission + size checks. `throw` = Python's `raise`.
  assertCan(ctx.role, "data:import");
  if (records.length > MAX_IMPORT_ROWS)
    throw new ServiceError(
      "IMPORT_TOO_LARGE",
      `This file has ${records.length} rows. Import up to ${MAX_IMPORT_ROWS} rows at a time.`,
    );
  // Step 2: HUMAN-IN-THE-LOOP GUARDS. A model or script may PROPOSE a day/month order, but writing
  // pigs needs a person's confirmation: a wrong order silently swaps day and month for every pig.
  // Dry runs stay free so the report can show what each reading would produce.
  // (`!dryRun` = `not dry_run`, so these only apply to REAL imports.)
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
  // Farm-level thresholds (e.g. when a pig counts as a piglet); needed later to compute each pig's status.
  const settings = await getSettings(ctx.farmId);

  // Step 3: load the pigs already on the farm. We only need a few columns of each.
  // Includes soft-deleted pigs: they still occupy the (farmId, tagId) unique index.
  // ("Soft-deleted" = marked removed but the row still exists, so its tag is still taken.)
  const existing = await db.pig.findMany({
    where: { farmId: ctx.farmId }, // ALWAYS filter by the caller's farm: farms must never see each other's data
    select: { tagId: true, sex: true, id: true, deletedAt: true },
  });
  // Turn that list into a dict keyed by lower-cased tag (for case-insensitive lookups).
  // Python: `{p.tagId.lower(): ExistingPig(id=p.id, sex=p.sex, deleted=p.deletedAt is not None) for p in existing}`
  const existingByTag = new Map<string, ExistingPig>(
    existing.map((p) => [p.tagId.toLowerCase(), { id: p.id, sex: p.sex, deleted: p.deletedAt !== null }]),
  );

  // Steps 4 and 5: the two PURE steps.
  const mapped = applyMapping(records, mapping);
  const { results, valid } = validateImportRows(mapped.rows, existingByTag, mapped.issues);

  // The report shown to the user.
  const summary = {
    total: records.length,
    valid: valid.length,
    invalid: records.length - valid.length,
    results,
    imported: 0,
  };
  // Step 6: a dry run, or nothing valid to write -> stop here.
  if (dryRun || valid.length === 0) return summary;

  // Step 7: the real write.
  // Pass 1 + 2 run in one transaction: a mid-import failure (bad connection,
  // constraint violation on a row we didn't anticipate) must roll back the
  // whole batch rather than leave a partially-imported, partially-linked herd.
  // Breeds and notes are batched into one query each so the cost per row is at
  // most three queries (create pig, create weight, link parents + weight).
  //
  // A TRANSACTION means "all or nothing": if anything fails midway, the database undoes everything,
  // so we never end up with half an import. (Python/SQLAlchemy: `with session.begin(): ...`.)
  const createdByTag = new Map<string, string>(); // lower-cased tag -> new database id
  try {
    await db.$transaction(
      // `async (tx) => { ... }` is the body of the transaction; `tx` is the transaction's connection.
      async (tx) => {
        // Make sure each breed name exists in the farm's breed list, in ONE query.
        // `[...new Set(list)]` = `list(set(list))`; `skipDuplicates` ignores breeds that already exist.
        const breedNames = [...new Set(valid.map(({ data }) => data.breed))];
        await tx.breed.createMany({
          data: breedNames.map((name) => ({ farmId: ctx.farmId, name })),
          skipDuplicates: true,
        });

        // Pass 1: create pigs (+ weights)
        // First create every pig WITHOUT parents (we cannot link a mother until she exists).
        const weightIdByTag = new Map<string, string>();
        for (const { data: r } of valid) {
          const pig = await tx.pig.create({
            data: {
              farmId: ctx.farmId,
              tagId: r.tagId,
              breed: r.breed,
              sex: r.sex,
              dateOfBirth: new Date(r.dateOfBirth),
              castrated: r.sex === "MALE" ? r.castrated : null, // castrated only applies to males
            },
          });
          createdByTag.set(r.tagId.toLowerCase(), pig.id);
          if (r.weightKg) {
            // A first weight reading for this pig, stamped "now" and attributed to the importing user.
            const wr = await tx.weightRecord.create({
              data: {
                farmId: ctx.farmId, pigId: pig.id, weightKg: Number(r.weightKg),
                measuredAt: new Date(), recordedById: ctx.userId,
              },
            });
            weightIdByTag.set(r.tagId.toLowerCase(), wr.id);
          }
        }

        // Notes for all pigs, in one query. `!` after a value tells the type checker "this is not None".
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
        // Now every pig exists, so a parent tag can be turned into a database id: first look among the
        // pigs we just created, then among pigs already on the farm; otherwise null.
        // `a ?? b ?? null` = Python `a if a is not None else (b if b is not None else None)`.
        const resolve = (tag?: string) =>
          tag
            ? createdByTag.get(tag.toLowerCase()) ?? existingByTag.get(tag.toLowerCase())?.id ?? null
            : null;
        for (const { data: r } of valid) {
          const key = r.tagId.toLowerCase();
          const currentWeightId = weightIdByTag.get(key);
          if (!r.motherTagId && !r.fatherTagId && !currentWeightId) continue; // nothing to link for this pig
          await tx.pig.update({
            where: { id: createdByTag.get(key)! },
            data: { motherId: resolve(r.motherTagId), fatherId: resolve(r.fatherTagId), currentWeightId },
          });
        }
      },
      // Give the transaction a time budget that grows with the file size (see columns.ts).
      { timeout: importTxTimeoutMs(valid.length), maxWait: 10_000 },
    );
  } catch (e) {
    // Turn two known database failures into messages a farmer can understand.
    // `e instanceof X` = `isinstance(e, X)`.
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
    throw e; // anything else: re-raise unchanged
  }

  // Step 8: after the transaction succeeded.
  // Recompute each new pig's status (piglet / healthy / market-ready ...) from its age and weight.
  for (const id of createdByTag.values()) await syncStatus(id, settings);

  // Record WHO imported WHAT, including which date order and number convention were used,
  // so an auditor can later tell how ambiguous values were interpreted.
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

// The reverse direction: "Export CSV" on the Pigs page. Not part of the import evaluation.
// Builds one flat dict per pig, in the order a farmer expects, ready to be written as CSV.
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
