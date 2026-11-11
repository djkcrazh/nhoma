import { z } from "zod";
import { IMPORT_COLUMNS, type ImportColumn } from "./columns";
import type { ImportRow } from "./validate";

/**
 * A farm's import template: which column in THEIR file feeds each Nhoma field,
 * and how to translate their values. It is plain data (no code), validated
 * strictly, so it is safe to store, diff, and later have a model propose.
 * Transforms come from a closed set implemented below.
 */

export const DATE_FORMATS = [
  "iso",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "dd.MM.yyyy",
  "MM.dd.yyyy",
  "yyyy/MM/dd",
  "yyyy年M月d日",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Formats that differ only in whether the day or the month comes first. */
const DATE_ORDER_PAIRS: readonly (readonly [DateFormat, DateFormat])[] = [
  ["dd/MM/yyyy", "MM/dd/yyyy"],
  ["dd.MM.yyyy", "MM.dd.yyyy"],
];

/** The same format with day and month swapped, or null when the order is not in doubt (ISO, year-first, CJK). */
export function dateOrderAlternative(format: DateFormat): DateFormat | null {
  for (const [a, b] of DATE_ORDER_PAIRS) {
    if (format === a) return b;
    if (format === b) return a;
  }
  return null;
}

export const isDateOrderSensitive = (format: DateFormat): boolean => dateOrderAlternative(format) !== null;

const fieldSchema = z.strictObject({
  /** Header of the column in the uploaded file, or null when the file has none. */
  source: z.string().max(200).nullable(),
  /** Used when the column is absent or the cell is blank (e.g. breed "Mixed Breed"). */
  default: z.string().max(200).optional(),
  /** How sure whoever proposed this match is (0-1). Informational; set by a suggester or agent. */
  confidence: z.number().min(0).max(1).optional(),
  /** One line on why the match was proposed, shown to the human reviewer. */
  reason: z.string().max(300).optional(),
});

const boundedRecord = <T extends z.ZodType>(value: T) =>
  z.record(z.string().max(100), value).refine((r) => Object.keys(r).length <= 100, "Too many entries");

export const importMappingSchema = z.strictObject({
  version: z.literal(1),
  fields: z.strictObject({
    tagId: fieldSchema.optional(),
    breed: fieldSchema.optional(),
    sex: fieldSchema.optional(),
    dateOfBirth: fieldSchema.optional(),
    weightKg: fieldSchema.optional(),
    motherTagId: fieldSchema.optional(),
    fatherTagId: fieldSchema.optional(),
    castrated: fieldSchema.optional(),
    notes: fieldSchema.optional(),
  }),
  transforms: z.strictObject({
    /** Farm vocabulary for sex, keys compared case-insensitively ("truie" -> FEMALE). */
    sexValues: boundedRecord(z.enum(["MALE", "FEMALE"])),
    dateFormat: z.enum(DATE_FORMATS),
    /**
     * A person confirmed the day/month order. Required before anything is
     * written when the format is order-sensitive (see needsDateOrderConfirmation),
     * so a suggester or agent can propose a format but never import on its own say-so.
     */
    dateFormatConfirmed: z.boolean(),
    weightUnit: z.enum(["kg", "lb"]),
    /** Farm vocabulary for castrated beyond yes/no/true/false/1/0/y/n ("oui" -> true, "non" -> false). */
    castratedValues: boundedRecord(z.boolean()),
  }),
});

export type ImportMapping = z.infer<typeof importMappingSchema>;

/** Maps each canonical column to itself: what the default template implies. */
export function defaultMapping(): ImportMapping {
  return {
    version: 1,
    fields: Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, { source: c }])),
    transforms: { sexValues: {}, dateFormat: "iso", dateFormatConfirmed: false, weightUnit: "kg", castratedValues: {} },
  };
}

/**
 * True when dates are mapped in a day/month-ambiguous format that no person has
 * confirmed. The import UI blocks on this, and the server refuses to write.
 */
export function needsDateOrderConfirmation(mapping: ImportMapping): boolean {
  return (
    !!mapping.fields.dateOfBirth?.source &&
    isDateOrderSensitive(mapping.transforms.dateFormat) &&
    !mapping.transforms.dateFormatConfirmed
  );
}

// ---------- value parsers ----------

const DATE_SHAPES: Record<DateFormat, { re: RegExp; order: readonly ["y" | "d" | "m", "y" | "d" | "m", "y" | "d" | "m"] }> = {
  iso: { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/, order: ["y", "m", "d"] },
  "dd/MM/yyyy": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["d", "m", "y"] },
  "MM/dd/yyyy": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["m", "d", "y"] },
  "dd.MM.yyyy": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["d", "m", "y"] },
  "MM.dd.yyyy": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["m", "d", "y"] },
  "yyyy/MM/dd": { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: ["y", "m", "d"] },
  "yyyy年M月d日": { re: /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/, order: ["y", "m", "d"] },
};

/** Returns "yyyy-MM-dd" for a real calendar date in the given format, else null. */
export function parseDate(raw: string, format: DateFormat): string | null {
  const shape = DATE_SHAPES[format];
  const m = raw.trim().match(shape.re);
  if (!m) return null;
  const parts = { y: 0, m: 0, d: 0 };
  shape.order.forEach((k, i) => (parts[k] = Number(m[i + 1])));
  const probe = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (probe.getUTCFullYear() !== parts.y || probe.getUTCMonth() !== parts.m - 1 || probe.getUTCDate() !== parts.d) return null; // e.g. 31/02
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${String(parts.y).padStart(4, "0")}-${p2(parts.m)}-${p2(parts.d)}`;
}

const LB_TO_KG = 0.45359237;

/** Accepts "12.5", "12,5", "12.5 kg", "27.6 lbs". A unit in the cell beats the mapping's unit. */
export function parseWeight(raw: string, defaultUnit: "kg" | "lb"): string | null {
  const m = raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kgs?|lbs?)?$/i);
  if (!m) return null;
  const unit = m[2] ? (m[2].toLowerCase().startsWith("lb") ? "lb" : "kg") : defaultUnit;
  const n = Number(m[1].replace(",", ".")) * (unit === "lb" ? LB_TO_KG : 1);
  return String(Math.round(n * 100) / 100);
}

/**
 * Reads one cell by header name. Own properties only, so a header or mapping
 * source like "constructor" or "__proto__" can never reach Object.prototype,
 * and anything that is not a string reads as blank.
 */
export function readCell(rec: Record<string, unknown>, source: string | null | undefined): string {
  if (!source || !Object.hasOwn(rec, source)) return "";
  const v = rec[source];
  return typeof v === "string" ? v.trim() : "";
}

// ---------- vocabulary resolvers ----------

const lowerKeyed = <V>(table: Record<string, V>): Map<string, V> =>
  new Map(Object.entries(table).map(([k, v]) => [k.trim().toLowerCase(), v]));

/** Translates a farm's sex word using the mapping; anything unknown passes through unchanged. */
export function sexResolver(mapping: ImportMapping): (raw: string) => string {
  const table = lowerKeyed(mapping.transforms.sexValues);
  return (raw) => table.get(raw.trim().toLowerCase()) ?? raw;
}

export const isFemale = (sex: string): boolean => ["FEMALE", "F"].includes(sex.trim().toUpperCase());

const CASTRATED_YES = new Set(["yes", "true", "1", "y"]);
const CASTRATED_NO = new Set(["no", "false", "0", "n"]);

/** true / false for a castrated cell, or undefined when nothing (mapping or built-in) says what it means. */
export function castratedResolver(mapping: ImportMapping): (raw: string) => boolean | undefined {
  const table = lowerKeyed(mapping.transforms.castratedValues);
  return (raw) => {
    const key = raw.trim().toLowerCase();
    return table.get(key) ?? (CASTRATED_YES.has(key) ? true : CASTRATED_NO.has(key) ? false : undefined);
  };
}

// ---------- applyMapping ----------

/** A problem found while translating a cell, tied to the field it came from. */
export interface MappingIssue {
  field: ImportColumn;
  message: string;
}

export interface MappedRows {
  rows: ImportRow[];
  /** Same length as `rows`; issues[i] belongs to rows[i]. */
  issues: MappingIssue[][];
}

/**
 * Translates raw file records (keyed by THEIR headers) into canonical import
 * rows. Pure and total: it never throws on bad cells, it reports them as
 * issues so the dry run can show every problem at once.
 */
export function applyMapping(records: Record<string, unknown>[], mapping: ImportMapping): MappedRows {
  const toSex = sexResolver(mapping);
  const toCastrated = castratedResolver(mapping);

  const rows: ImportRow[] = [];
  const issues: MappingIssue[][] = [];
  for (const rec of records) {
    const rowIssues: MappingIssue[] = [];
    const cell = (field: ImportColumn): string => {
      const fm = mapping.fields[field];
      return readCell(rec, fm?.source) || fm?.default?.trim() || "";
    };

    let dateOfBirth = cell("dateOfBirth");
    if (dateOfBirth) {
      const iso = parseDate(dateOfBirth, mapping.transforms.dateFormat);
      if (iso) dateOfBirth = iso;
      else {
        rowIssues.push({ field: "dateOfBirth", message: `"${dateOfBirth}" is not a valid ${mapping.transforms.dateFormat} date` });
        dateOfBirth = "";
      }
    }

    let weightKg = cell("weightKg");
    if (weightKg) {
      const kg = parseWeight(weightKg, mapping.transforms.weightUnit);
      if (kg) weightKg = kg;
      else {
        rowIssues.push({ field: "weightKg", message: `"${weightKg}" is not a weight` });
        weightKg = "";
      }
    }

    const sex = toSex(cell("sex"));

    // Castrated only matters for males; sows are routinely marked "n/a" or "-" and must not fail for it.
    let castrated = "";
    const castratedRaw = cell("castrated");
    if (castratedRaw && !isFemale(sex)) {
      const meaning = toCastrated(castratedRaw);
      if (meaning === undefined) rowIssues.push({ field: "castrated", message: `"${castratedRaw}" is not yes or no` });
      else castrated = meaning ? "yes" : "no";
    }

    rows.push({
      tagId: cell("tagId"),
      breed: cell("breed"),
      sex,
      dateOfBirth,
      weightKg,
      motherTagId: cell("motherTagId"),
      fatherTagId: cell("fatherTagId"),
      castrated,
      notes: cell("notes"),
    });
    issues.push(rowIssues);
  }
  return { rows, issues };
}
