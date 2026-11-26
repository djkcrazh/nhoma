// =============================================================================
// validate.ts: checks every row of an import and says which rows are OK.
//
// WHERE IT FITS
//   file -> (decode) -> (parse) -> (mapping) -> applyMapping -> THIS FILE -> database write
//
// It is "pure": no database access, no network. The caller hands it the list of
// pigs that already exist (as a dict) so it can spot duplicates and check parents.
// That is what lets an evaluation run it thousands of times, cheaply.
//
// Output: for every row, ok / not ok plus human-readable error messages, and the
// list of rows that are valid. A dry run shows this to the user; a real import
// writes only the valid rows.
// =============================================================================

// Zod schema for ONE pig (tag format, breed length, date not in the future, weight range, ...).
// It lives elsewhere in the app because the "Add pig" form uses it too.
import { pigCreateSchema } from "@/lib/validations/pig";
import type { MappingIssue } from "./mapping";

// The standard row shape Nhoma expects. Everything is text at this point.
// `weightKg?: string` means the key is OPTIONAL (may be missing). Python: `NotRequired[str]` in a TypedDict.
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

// The verdict for ONE row. `row` is the spreadsheet row number (header = 1, first pig = 2),
// the same number a farmer sees in Excel.
export interface RowResult {
  row: number;
  tagId: string;
  ok: boolean;
  errors: string[]; // human-readable, e.g. 'dateOfBirth: "31/02/2024" is not a valid dd/MM/yyyy date'
}

// The same row after cleanup: trimmed, sex expanded (M -> MALE), castrated turned into a real boolean.
export interface NormalizedRow {
  tagId: string;
  breed: string;
  sex: string;
  dateOfBirth: string;
  weightKg?: string;
  motherTagId?: string;
  fatherTagId?: string;
  castrated: boolean;
  notes?: string;
}

// What we need to know about a pig that is ALREADY in the database.
export interface ExistingPig {
  id: string;
  sex: string;
  /** Soft-deleted pigs keep their tag (unique per farm) but cannot be parents. */
  deleted: boolean;
}

// Tidy one row. Python version:
//     def normalize_import_row(r):
//         sex = (r.get("sex") or "").strip().upper()
//         return {"tagId": (r.get("tagId") or "").strip(), ...,
//                 "sex": "MALE" if sex == "M" else "FEMALE" if sex == "F" else sex,
//                 "weightKg": (r.get("weightKg") or "").strip() or None, ...}
// `(r.sex ?? "")` = "if sex is missing use empty string". `x?.trim() || undefined` = "trimmed text, or None if empty".
export function normalizeImportRow(r: ImportRow): NormalizedRow {
  const sexRaw = (r.sex ?? "").trim().toUpperCase();
  return {
    tagId: (r.tagId ?? "").trim(),
    breed: (r.breed ?? "").trim(),
    sex: sexRaw === "M" ? "MALE" : sexRaw === "F" ? "FEMALE" : sexRaw,
    dateOfBirth: (r.dateOfBirth ?? "").trim(),
    weightKg: r.weightKg?.trim() || undefined,
    motherTagId: r.motherTagId?.trim() || undefined,
    fatherTagId: r.fatherTagId?.trim() || undefined,
    // Built-in meanings of the castrated column: yes/true/1/y mean True, everything else False.
    castrated: ["yes", "true", "1", "y"].includes((r.castrated ?? "").trim().toLowerCase()),
    notes: r.notes?.trim() || undefined,
  };
}

// What validateImportRows returns.
export interface ValidatedImport {
  results: RowResult[]; // one verdict per row, in file order
  valid: { row: number; data: NormalizedRow }[]; // only the rows that passed, ready to write
}

/**
 * Pure validation for a CSV import: no database, no clock beyond what the Zod
 * schema reads. `existingByTag` is keyed by lower-cased tag ID and must include
 * soft-deleted pigs, because they still occupy the (farmId, tagId) unique index.
 */
// ARGUMENTS
//   rows           : the standard rows from applyMapping
//   existingByTag  : {lowercased tag: ExistingPig} for pigs already on the farm
//                    `Map<string, ExistingPig>` is Python's `dict[str, ExistingPig]`
//   mappingIssues  : the per-row problems applyMapping found (default: none). `= []` is a default value.
//
// WHAT IT CHECKS, per row
//   1. the pig-level rules in `pigCreateSchema` (required fields, formats, ranges)
//   2. the tag is not already used on the farm (including by a removed pig)
//   3. the tag is not duplicated earlier in the same file
//   4. mother/father: exist (on the farm or in the file), are the right sex, are not the pig itself
//   5. "lineage": a pig whose in-file parent failed validation also fails
export function validateImportRows(
  rows: ImportRow[],
  existingByTag: Map<string, ExistingPig>,
  /** Cell-translation problems from applyMapping, index-aligned with `rows`. */
  mappingIssues: MappingIssue[][] = [],
): ValidatedImport {
  // Attach a spreadsheet row number to every row and clean it up.
  // `i + 2` because Excel row 1 is the header, so the first pig is row 2.
  // Python: `[{"row": i + 2, "data": normalize_import_row(raw)} for i, raw in enumerate(rows)]`
  const normalized = rows.map((raw, i) => ({ row: i + 2, data: normalizeImportRow(raw) })); // header is row 1

  // Build the file's tag index up front (first occurrence per tag wins) so a
  // parent listed AFTER its child in the file still resolves — file order
  // must not matter, since pass 1 creates every valid row before pass 2 links.
  // fileTags = {lowercased tag: {sex, row}} for every pig in THIS file.
  const fileTags = new Map<string, { sex: string; row: number }>();
  for (const { row, data: r } of normalized) {
    // `const { row, data: r } of normalized` unpacks each item: `row` = item["row"], `r` = item["data"].
    if (r.tagId && !fileTags.has(r.tagId.toLowerCase())) {
      fileTags.set(r.tagId.toLowerCase(), { sex: r.sex, row });
    }
  }

  const results: RowResult[] = [];
  const resultByRow = new Map<number, RowResult>(); // quick lookup: row number -> its verdict

  // ---------- PASS A: check each row on its own ----------
  for (const { row: rowNum, data: r } of normalized) {
    const errors: string[] = [];

    // A translation problem already explains the field; drop the schema's
    // generic complaint about the blanked-out value so users see one clear error.
    // `?? []` = "or an empty list if there is none". `new Set(...)` = Python `set(...)`.
    const issues = mappingIssues[rowNum - 2] ?? [];
    const explained = new Set<string>(issues.map((i) => i.field));
    // `errors.push(...list)` appends every item. Python: `errors.extend(...)`.
    errors.push(...issues.map((i) => `${i.field}: ${i.message}`));

    const originalSex = (rows[rowNum - 2]?.sex ?? "").trim(); // as written in the file, not upper-cased
    // Run the per-pig rules. `safeParse` returns {success: true, data} or {success: false, error}
    // instead of raising. (Pydantic: `Model.model_validate(...)` wrapped in try/except.)
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
      errors.push(
        ...parsed.error.issues
          // Skip complaints about fields applyMapping already explained.
          .filter((iss) => !explained.has(String(iss.path[0])))
          // Turn the library's wording into something a farmer can act on.
          .map((iss) =>
            iss.path[0] === "sex"
              ? originalSex
                ? `sex: "${originalSex}" is not male or female (use Edit column matching to say what it means)`
                : "sex: Sex is required"
              : `${iss.path.join(".")}: ${iss.message}`,
          ),
      );
    }
    // Is this tag already on the farm?
    const taken = r.tagId ? existingByTag.get(r.tagId.toLowerCase()) : undefined;
    if (taken)
      errors.push(
        taken.deleted
          ? `Tag ID "${r.tagId}" belongs to a removed pig and cannot be reused`
          : `Tag ID "${r.tagId}" already exists on the farm`,
      );
    // Is the tag repeated earlier in this same file?
    const firstOccurrence = r.tagId ? fileTags.get(r.tagId.toLowerCase()) : undefined;
    if (firstOccurrence && firstOccurrence.row !== rowNum)
      errors.push(`Duplicate tag ID within file (also row ${firstOccurrence.row})`);

    // Parent references: must exist on farm or anywhere else in this file, correct sex
    // Loop over [(mother tag, expected sex, label), (father tag, ...)].
    // `as const` freezes the little arrays so TypeScript knows exactly what is in them.
    for (const [ref, wantSex, label] of [
      [r.motherTagId, "FEMALE", "Mother"],
      [r.fatherTagId, "MALE", "Father"],
    ] as const) {
      if (!ref) continue; // no parent listed: nothing to check
      if (ref.toLowerCase() === r.tagId.toLowerCase()) {
        errors.push(`${label} cannot be the pig itself`);
        continue;
      }
      const onFarm = existingByTag.get(ref.toLowerCase()); // parent already in the database?
      const inFile = fileTags.get(ref.toLowerCase()); // or elsewhere in this file?
      if (onFarm?.deleted) errors.push(`${label} "${ref}" was removed from the farm`);
      else if (!onFarm && !inFile) errors.push(`${label} "${ref}" not found on farm or in file`);
      // Wrong sex (e.g. a boar listed as the mother). `a ?? b` = `a if a is not None else b`.
      else if ((onFarm?.sex ?? inFile?.sex) !== wantSex)
        errors.push(`${label} "${ref}" is not ${wantSex === "FEMALE" ? "female" : "male"}`);
    }

    // The verdict: ok exactly when there are no errors.
    const result = { row: rowNum, tagId: r.tagId || "(blank)", ok: errors.length === 0, errors };
    results.push(result);
    resultByRow.set(rowNum, result);
  }

  // ---------- PASS B: lineage ----------
  // A row can only be created if every in-file parent it points to is ALSO
  // going to be created — otherwise pass 2 would silently fall back to a
  // null parent. Propagate invalidity to fixpoint (a bad grandparent should
  // sink its whole in-file lineage, not just its direct child).
  //
  // In plain words: if the mother's row failed, her piglets must fail too, and so must THEIR
  // piglets, and so on. We repeat the sweep until a whole pass changes nothing ("fixpoint").
  // `while (changed) { changed = false; ... }` is a normal Python `while changed:` loop.
  let changed = true;
  while (changed) {
    changed = false;
    for (const { row: rowNum, data: r } of normalized) {
      const result = resultByRow.get(rowNum)!; // `!` tells TypeScript "this is definitely not None"
      if (!result.ok) continue; // already failed; nothing to propagate
      for (const [ref, label] of [
        [r.motherTagId, "Mother"],
        [r.fatherTagId, "Father"],
      ] as const) {
        // Parents already in the database are fine; only in-file parents can drag a row down.
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

  // Keep only the rows that passed; those are the ones a real import writes.
  const valid = normalized.filter(({ row }) => resultByRow.get(row)!.ok);
  return { results, valid };
}
