import { pigCreateSchema } from "@/lib/validations/pig";
import type { MappingIssue } from "./mapping";

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

export interface ExistingPig {
  id: string;
  sex: string;
  /** Soft-deleted pigs keep their tag (unique per farm) but cannot be parents. */
  deleted: boolean;
}

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
    castrated: ["yes", "true", "1", "y"].includes((r.castrated ?? "").trim().toLowerCase()),
    notes: r.notes?.trim() || undefined,
  };
}

export interface ValidatedImport {
  results: RowResult[];
  valid: { row: number; data: NormalizedRow }[];
}

/**
 * Pure validation for a CSV import: no database, no clock beyond what the Zod
 * schema reads. `existingByTag` is keyed by lower-cased tag ID and must include
 * soft-deleted pigs, because they still occupy the (farmId, tagId) unique index.
 */
export function validateImportRows(
  rows: ImportRow[],
  existingByTag: Map<string, ExistingPig>,
  /** Cell-translation problems from applyMapping, index-aligned with `rows`. */
  mappingIssues: MappingIssue[][] = [],
): ValidatedImport {
  const normalized = rows.map((raw, i) => ({ row: i + 2, data: normalizeImportRow(raw) })); // header is row 1

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

    // A translation problem already explains the field; drop the schema's
    // generic complaint about the blanked-out value so users see one clear error.
    const issues = mappingIssues[rowNum - 2] ?? [];
    const explained = new Set<string>(issues.map((i) => i.field));
    errors.push(...issues.map((i) => `${i.field}: ${i.message}`));

    const originalSex = (rows[rowNum - 2]?.sex ?? "").trim(); // as written in the file, not upper-cased
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
          .filter((iss) => !explained.has(String(iss.path[0])))
          .map((iss) =>
            iss.path[0] === "sex"
              ? originalSex
                ? `sex: "${originalSex}" is not male or female (use Edit column matching to say what it means)`
                : "sex: Sex is required"
              : `${iss.path.join(".")}: ${iss.message}`,
          ),
      );
    }
    const taken = r.tagId ? existingByTag.get(r.tagId.toLowerCase()) : undefined;
    if (taken)
      errors.push(
        taken.deleted
          ? `Tag ID "${r.tagId}" belongs to a removed pig and cannot be reused`
          : `Tag ID "${r.tagId}" already exists on the farm`,
      );
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
      if (onFarm?.deleted) errors.push(`${label} "${ref}" was removed from the farm`);
      else if (!onFarm && !inFile) errors.push(`${label} "${ref}" not found on farm or in file`);
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

  const valid = normalized.filter(({ row }) => resultByRow.get(row)!.ok);
  return { results, valid };
}
