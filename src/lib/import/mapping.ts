import { z } from "zod";
import { IMPORT_COLUMNS, type ImportColumn } from "./columns";
import type { ImportRow } from "./validate";

/**
 * A farm's import template: which column in THEIR file feeds each Nhoma field,
 * and how to translate their values. It is plain data (no code), validated
 * strictly, so it is safe to store, diff, and later have a model propose.
 * Transforms come from a closed set implemented below.
 */

export const DATE_FORMATS = ["iso", "dd/MM/yyyy", "MM/dd/yyyy", "dd.MM.yyyy", "yyyy/MM/dd", "yyyy年M月d日"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const fieldSchema = z.strictObject({
  /** Header of the column in the uploaded file, or null when the file has none. */
  source: z.string().max(200).nullable(),
  /** Used when the column is absent or the cell is blank (e.g. breed "Mixed Breed"). */
  default: z.string().max(200).optional(),
});

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
    sexValues: z
      .record(z.string().max(100), z.enum(["MALE", "FEMALE"]))
      .refine((r) => Object.keys(r).length <= 100, "Too many sex values"),
    dateFormat: z.enum(DATE_FORMATS),
    weightUnit: z.enum(["kg", "lb"]),
    /** Extra tokens that mean "castrated" besides yes/true/1/y ("oui", "si", "是"). */
    castratedTrue: z.array(z.string().max(50)).max(20),
  }),
});

export type ImportMapping = z.infer<typeof importMappingSchema>;

/** Maps each canonical column to itself: what the default template implies. */
export function defaultMapping(): ImportMapping {
  return {
    version: 1,
    fields: Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, { source: c }])),
    transforms: { sexValues: {}, dateFormat: "iso", weightUnit: "kg", castratedTrue: [] },
  };
}

// ---------- value parsers ----------

const DATE_SHAPES: Record<DateFormat, { re: RegExp; order: readonly ["y" | "d" | "m", "y" | "d" | "m", "y" | "d" | "m"] }> = {
  iso: { re: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/, order: ["y", "m", "d"] },
  "dd/MM/yyyy": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["d", "m", "y"] },
  "MM/dd/yyyy": { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ["m", "d", "y"] },
  "dd.MM.yyyy": { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: ["d", "m", "y"] },
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

const CASTRATED_TRUE = ["yes", "true", "1", "y"];

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
  const sexValues = new Map(Object.entries(mapping.transforms.sexValues).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const castratedTrue = new Set([...CASTRATED_TRUE, ...mapping.transforms.castratedTrue.map((t) => t.trim().toLowerCase())]);

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

    const sexRaw = cell("sex");
    const castratedRaw = cell("castrated");
    rows.push({
      tagId: cell("tagId"),
      breed: cell("breed"),
      sex: sexValues.get(sexRaw.toLowerCase()) ?? sexRaw,
      dateOfBirth,
      weightKg,
      motherTagId: cell("motherTagId"),
      fatherTagId: cell("fatherTagId"),
      castrated: castratedRaw ? (castratedTrue.has(castratedRaw.toLowerCase()) ? "yes" : "no") : "",
      notes: cell("notes"),
    });
    issues.push(rowIssues);
  }
  return { rows, issues };
}
