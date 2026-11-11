// =============================================================================
// mapping.ts: the heart of the CSV import. Read this file first.
//
// THE PROBLEM IT SOLVES
//   Every farm's spreadsheet has different column names, date styles, number
//   styles and words for "male/female". A "mapping" is a small piece of DATA
//   that says how to read ONE particular farm's file:
//
//       {"fields": {"tagId": {"source": "Pig No"}, "sex": {"source": "Sex"}, ...},
//        "transforms": {"dateFormat": "dd/MM/yyyy", "dateFormatConfirmed": true,
//                       "numberFormat": "en", "sexValues": {"Sow": "FEMALE"}, ...}}
//
//   `applyMapping(records, mapping)` then turns the farm's raw rows into Nhoma's
//   standard rows. The mapping can be written by a person (the mapping screen),
//   by the deterministic guesser (suggest.ts), or, in Phase 3, by an AI model.
//   An AI never gets to run code: it can only produce this JSON, and the JSON is
//   checked by the strict schema below. That is the safety idea of the whole design.
//
// WHAT AN EVALUATION CARES ABOUT
//   * `importMappingSchema`  : the exact shape a proposed mapping must have.
//   * `applyMapping`         : given records + mapping -> standard rows + issues.
//   * the two "needs...Confirmation" functions: the human-in-the-loop guards.
//
// TYPESCRIPT-FOR-PYTHON-READERS cheat sheet: see README.md in this folder.
// =============================================================================

// `import { a, b } from "x"` = Python's `from x import a, b`.
// "zod" is a validation library. Python equivalent: `pydantic`.
import { z } from "zod";
import { IMPORT_COLUMNS, type ImportColumn } from "./columns";
// `import type { ... }` means "I only need this for type checking; don't load it at runtime".
// (Python: `if TYPE_CHECKING: from .validate import ImportRow`.)
import type { ImportRow } from "./validate";

/**
 * A farm's import template: which column in THEIR file feeds each Nhoma field,
 * and how to translate their values. It is plain data (no code), validated
 * strictly, so it is safe to store, diff, and later have a model propose.
 * Transforms come from a closed set implemented below.
 */

// ---------------------------------------------------------------------------
// 1. THE ALLOWED CHOICES
// ---------------------------------------------------------------------------

// Every date style we know how to read. The strings are the names a farmer would recognise:
//   dd = day, MM = month, yyyy = year.   "iso" means 2026-01-15 (year-month-day).
// Python: `DATE_FORMATS = ("iso", "dd/MM/yyyy", ...)`
export const DATE_FORMATS = [
  "iso",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "dd.MM.yyyy",
  "MM.dd.yyyy",
  "yyyy/MM/dd",
  "yyyy年M月d日",
] as const;
// The type "any one of those strings". Python: `DateFormat = Literal["iso", "dd/MM/yyyy", ...]`
export type DateFormat = (typeof DATE_FORMATS)[number];

// How a file writes numbers:
//   "en" = 1,234.5  (comma groups thousands, period is the decimal point)  <- Ghana, UK, US
//   "eu" = 1.234,5  (period groups thousands, comma is the decimal point)  <- France, Spain, ...
export const NUMBER_FORMATS = ["en", "eu"] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** Formats that differ only in whether the day or the month comes first. */
// Pairs of date styles that look identical but swap day and month.
// `readonly (readonly [DateFormat, DateFormat])[]` = a read-only list of read-only 2-tuples.
// Python: `DATE_ORDER_PAIRS: Sequence[tuple[DateFormat, DateFormat]] = (("dd/MM/yyyy", "MM/dd/yyyy"), ...)`
const DATE_ORDER_PAIRS: readonly (readonly [DateFormat, DateFormat])[] = [
  ["dd/MM/yyyy", "MM/dd/yyyy"],
  ["dd.MM.yyyy", "MM.dd.yyyy"],
];

/** The same format with day and month swapped, or null when the order is not in doubt (ISO, year-first, CJK). */
// Example: dateOrderAlternative("dd/MM/yyyy") -> "MM/dd/yyyy";  dateOrderAlternative("iso") -> null.
// `DateFormat | null` means the function returns either a DateFormat or `null` (Python: `None`).
// Python version:
//     for a, b in DATE_ORDER_PAIRS:
//         if fmt == a: return b
//         if fmt == b: return a
//     return None
export function dateOrderAlternative(format: DateFormat): DateFormat | null {
  for (const [a, b] of DATE_ORDER_PAIRS) {
    if (format === a) return b;
    if (format === b) return a;
  }
  return null;
}

// "Is this date style one where day/month order is in doubt?"  (True for dd/MM/yyyy etc., False for ISO.)
// `(x) => expr` is a one-line function (Python: `lambda x: expr`). `!==` is Python's `!=`.
export const isDateOrderSensitive = (format: DateFormat): boolean => dateOrderAlternative(format) !== null;

// ---------------------------------------------------------------------------
// 2. THE SCHEMA: the exact shape a mapping must have
// ---------------------------------------------------------------------------
// Think of `z.strictObject({...})` as a pydantic model with `extra="forbid"`: unknown keys are errors.
// `z.string().max(200).nullable()` = `Optional[constr(max_length=200)]`.
// `.optional()` = the key may be missing entirely.

// How ONE Nhoma field is filled from the farm's file.
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

// A helper that builds "a dict with at most 100 string keys whose values satisfy `value`".
// `<T extends z.ZodType>` is a GENERIC (a type parameter). Python: `def bounded_record(value: Type[T]) -> ...`.
// You can ignore the generics syntax: just read it as "a function that makes a bounded dict-validator".
const boundedRecord = <T extends z.ZodType>(value: T) =>
  z.record(z.string().max(100), value).refine((r) => Object.keys(r).length <= 100, "Too many entries");

// THE MAPPING SCHEMA. A proposal from the suggester, a person or an AI must pass this.
export const importMappingSchema = z.strictObject({
  version: z.literal(1), // always the number 1 for now (Python: Literal[1])
  // One entry per Nhoma field. Each is optional because a farm's file may not have every column.
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
  // How to translate the VALUES in those columns.
  transforms: z.strictObject({
    /** Farm vocabulary for sex, keys compared case-insensitively ("truie" -> FEMALE). */
    // e.g. {"Sow": "FEMALE", "Boar": "MALE"}: what this farm's words mean.
    sexValues: boundedRecord(z.enum(["MALE", "FEMALE"])),
    dateFormat: z.enum(DATE_FORMATS), // which of the date styles above this file uses
    /**
     * A person confirmed the day/month order. Required before anything is
     * written when the format is order-sensitive (see needsDateOrderConfirmation),
     * so a suggester or agent can propose a format but never import on its own say-so.
     */
    // HUMAN-IN-THE-LOOP FLAG #1. An evaluation must set this itself, acting as the "simulated
    // human"; an AI must never be allowed to set it.
    dateFormatConfirmed: z.boolean(),
    weightUnit: z.enum(["kg", "lb"]),
    /**
     * How the file writes numbers. "en" = 1,234.5: a comma groups thousands and a
     * period is the decimal point (Ghana, UK, US). "eu" = 1.234,5: the reverse
     * (French, Spanish, much of Europe).
     */
    numberFormat: z.enum(NUMBER_FORMATS),
    /** A person confirmed the convention. Required when some value reads differently under each one ("1,200"). */
    // HUMAN-IN-THE-LOOP FLAG #2 (same idea as above, for numbers).
    numberFormatConfirmed: z.boolean(),
    /** Farm vocabulary for castrated beyond yes/no/true/false/1/0/y/n ("oui" -> true, "non" -> false). */
    castratedValues: boundedRecord(z.boolean()),
  }),
});

// `z.infer<typeof schema>` derives a TypeScript type FROM the schema, so the schema and the type
// can never disagree. Python/pydantic analogue: the model class IS the type.
export type ImportMapping = z.infer<typeof importMappingSchema>;

/** Maps each canonical column to itself: what the default template implies. */
// The mapping that means "the file already uses Nhoma's own column names".
// For a file with Nhoma's template headers the suggester returns essentially this.
// Python: {"version": 1, "fields": {c: {"source": c} for c in IMPORT_COLUMNS}, "transforms": {...}}
export function defaultMapping(): ImportMapping {
  return {
    version: 1,
    // Object.fromEntries(list of [key, value]) = Python's dict(list_of_pairs).
    // `IMPORT_COLUMNS.map((c) => [c, {source: c}])` = `[(c, {"source": c}) for c in IMPORT_COLUMNS]`.
    fields: Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, { source: c }])),
    transforms: {
      sexValues: {},
      dateFormat: "iso",
      dateFormatConfirmed: false, // nobody has confirmed anything yet
      weightUnit: "kg",
      numberFormat: "en", // English convention is the default (Ghana)
      numberFormatConfirmed: false,
      castratedValues: {},
    },
  };
}

// ---------------------------------------------------------------------------
// 3. THE HUMAN-IN-THE-LOOP GUARDS
// ---------------------------------------------------------------------------

/**
 * True when dates are mapped in a day/month-ambiguous format that no person has
 * confirmed. The import UI blocks on this, and the server refuses to write.
 */
// Python version:
//     def needs_date_order_confirmation(m):
//         src = (m["fields"].get("dateOfBirth") or {}).get("source")
//         return bool(src) and is_date_order_sensitive(m["transforms"]["dateFormat"]) \
//                and not m["transforms"]["dateFormatConfirmed"]
// Syntax notes: `!!x` converts to a boolean (Python `bool(x)`); `?.` is "safe access": `a?.b` is
// `None` if `a` is missing instead of raising an error (Python: `(a or {}).get("b")`).
export function needsDateOrderConfirmation(mapping: ImportMapping): boolean {
  return (
    !!mapping.fields.dateOfBirth?.source &&
    isDateOrderSensitive(mapping.transforms.dateFormat) &&
    !mapping.transforms.dateFormatConfirmed
  );
}

/**
 * True when weights are mapped, at least one value reads differently under the
 * two conventions ("1,200" is 1200 or 1.2), and nobody has confirmed which. Unlike
 * the date check this needs the file's values, so the server calls it with the rows.
 */
// Python: `return any(is_ambiguous_number(read_cell(r, source)) for r in records)`
// (`records.some(fn)` = `any(fn(r) for r in records)`.)
// `Record<string, unknown>[]` = `list[dict[str, Any]]`.
export function needsNumberFormatConfirmation(mapping: ImportMapping, records: Record<string, unknown>[]): boolean {
  const source = mapping.fields.weightKg?.source;
  if (!source || mapping.transforms.numberFormatConfirmed) return false;
  return records.some((r) => isAmbiguousNumber(readCell(r, source)));
}

// ---------------------------------------------------------------------------
// 4. VALUE PARSERS: turning text like "03/04/2024" or "1,200" into real values
// ---------------------------------------------------------------------------

// For each date style: a REGULAR EXPRESSION that matches its shape, and the ORDER of the three
// captured numbers (d = day, m = month, y = year).
// `/.../` is a regex literal (Python: r"..." with `re`). `(\d{1,2})` captures 1-2 digits.
// Note the two entries "dd/MM/yyyy" and "MM/dd/yyyy" have the SAME regex but a different order:
// that is the entire day-vs-month ambiguity in code form.
// `Record<DateFormat, {...}>` = `dict[DateFormat, {...}]`.
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
// parseDate("03/04/2024", "dd/MM/yyyy") -> "2024-04-03"
// parseDate("03/04/2024", "MM/dd/yyyy") -> "2024-03-04"      (same text, different answer!)
// parseDate("31/02/2024", "dd/MM/yyyy") -> null              (not a real date)
//
// Python version:
//     m = re.fullmatch(shape.re, raw.strip())
//     if not m: return None
//     parts = dict(zip(shape.order, map(int, m.groups())))      # {"d": 3, "m": 4, "y": 2024}
//     try: datetime.date(parts["y"], parts["m"], parts["d"])    # raises if e.g. Feb 31
//     except ValueError: return None
//     return f"{parts['y']:04d}-{parts['m']:02d}-{parts['d']:02d}"
export function parseDate(raw: string, format: DateFormat): string | null {
  const shape = DATE_SHAPES[format];
  const m = raw.trim().match(shape.re); // `.match(regex)` = `re.fullmatch(...)` here; returns null if no match
  if (!m) return null;
  const parts = { y: 0, m: 0, d: 0 };
  // Put each captured number under its letter. m[1], m[2], m[3] are the 3 regex groups.
  // `forEach((k, i) => ...)` = `for i, k in enumerate(shape.order)`.
  shape.order.forEach((k, i) => (parts[k] = Number(m[i + 1])));
  // JavaScript's Date silently "rolls over" impossible dates (Feb 31 becomes Mar 2), so we build the
  // date and check that year/month/day came back unchanged. That detects impossible dates.
  // (Python's datetime.date raises ValueError instead, so you would use try/except.)
  const probe = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)); // JS months are 0-11, hence `- 1`
  if (probe.getUTCFullYear() !== parts.y || probe.getUTCMonth() !== parts.m - 1 || probe.getUTCDate() !== parts.d) return null; // e.g. 31/02
  // `p2` zero-pads to 2 digits (Python: f"{n:02d}"). The final line is an f-string (backticks).
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${String(parts.y).padStart(4, "0")}-${p2(parts.m)}-${p2(parts.d)}`;
}

// 1 pound = 0.45359237 kilograms.
const LB_TO_KG = 0.45359237;

// Thousands groups must be exactly three digits, so "12,5" is NOT a valid English number
// (and "12.5" is not a valid European one): a wrong convention fails loudly instead of
// quietly reading 12.5 as 125 or 1,200 as 1.2.
// PLAIN-ENGLISH REGEX READING, for "en":   ^ (  1-3 digits then one-or-more ",ddd" groups   OR   just digits  )
//                                            then optionally ".digits"  $
// Examples that match "en": 85  12.5  1,200  1,234.5      Examples that do NOT: 12,5  1,20  1.2.3
// ("eu" is the mirror image with "." and "," swapped.)  `(?:...)` is a non-capturing group, as in Python.
const NUMBER_SHAPES: Record<NumberFormat, RegExp> = {
  en: /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/,
  eu: /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/,
};

/** Parses a plain number in the given convention, or null when the text is not valid in it. */
// parseNumber("1,200", "en") -> 1200      parseNumber("1,200", "eu") -> 1.2
// parseNumber("12,5", "en")  -> null      parseNumber("12,5", "eu")  -> 12.5
// Python version:
//     s = raw.strip()
//     if not re.fullmatch(NUMBER_SHAPES[fmt], s): return None
//     return float(s.replace(",", "")) if fmt == "en" else float(s.replace(".", "").replace(",", "."))
// `/,/g` is "every comma" (the g flag); Python's str.replace replaces all occurrences by default.
export function parseNumber(raw: string, format: NumberFormat): number | null {
  const s = raw.trim();
  if (!NUMBER_SHAPES[format].test(s)) return null; // `.test(s)` = `re.fullmatch(...) is not None`
  return Number(format === "en" ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", "."));
}

// A weight cell looks like: digits/commas/periods, then an optional unit (kg, kgs, lb, lbs). `i` = ignore case.
const WEIGHT_SHAPE = /^([\d.,]+)\s*(kgs?|lbs?)?$/i;
// Things farms type when a pig simply was not weighed. (`new Set([...])` = Python `{...}`.)
const PLACEHOLDERS = new Set(["n/a", "na", "-", "--", "?", "unknown", "none", "null", "nil"]);

/** Weight cells farms fill in when a pig simply was not weighed. Treated as blank, not as an error. */
// Python: `return raw.strip().lower() in PLACEHOLDERS`
export const isBlankPlaceholder = (raw: string): boolean => PLACEHOLDERS.has(raw.trim().toLowerCase());

/**
 * The numeric part of a weight cell ("27.6 lbs" -> "27.6"), or null if it is not
 * number-shaped at all.
 */
// `?.[1]` = "if the match succeeded, take capture group 1". `?? null` = "if that is missing, use null"
// (the `??` operator is Python's `x if x is not None else y`, NOT `x or y`).
export const weightDigits = (raw: string): string | null => raw.trim().match(WEIGHT_SHAPE)?.[1] ?? null;

/** True when the text is a valid number in BOTH conventions but means different things ("1,200": 1200 or 1.2). */
// "1,200"  -> True  (en: 1200, eu: 1.2)       "12.5" -> False (only valid as en)
// "12,5"   -> False (only valid as eu)         "85"   -> False (same in both)
export function isAmbiguousNumber(raw: string): boolean {
  const digits = weightDigits(raw);
  if (!digits) return false;
  const en = parseNumber(digits, "en");
  const eu = parseNumber(digits, "eu");
  return en !== null && eu !== null && en !== eu;
}

/**
 * Accepts "12.5", "1,250.5", "12.5 kg", "27.6 lbs" (English) or "12,5", "1.250,5" (European).
 * A unit in the cell beats the mapping's unit. Returns kilograms as text, or null.
 */
// Returns a STRING like "45.36" (kilograms, 2 decimals) or null if the text is not a valid weight.
// `numberFormat: NumberFormat = "en"` is a parameter with a default value (like `number_format="en"`).
export function parseWeight(raw: string, defaultUnit: "kg" | "lb", numberFormat: NumberFormat = "en"): string | null {
  const m = raw.trim().match(WEIGHT_SHAPE);
  if (!m) return null;
  const value = parseNumber(m[1], numberFormat);
  if (value === null) return null;
  // m[2] is the unit written in the cell (if any); otherwise use the mapping's default unit.
  const unit = m[2] ? (m[2].toLowerCase().startsWith("lb") ? "lb" : "kg") : defaultUnit;
  // Convert to kg and round to 2 decimals: Python `round(value * factor, 2)`.
  // (JavaScript has no round-to-N-decimals, so it multiplies by 100, rounds, divides by 100.)
  return String(Math.round(value * (unit === "lb" ? LB_TO_KG : 1) * 100) / 100);
}

/**
 * Reads one cell by header name. Own properties only, so a header or mapping
 * source like "constructor" or "__proto__" can never reach Object.prototype,
 * and anything that is not a string reads as blank.
 */
// Python: `v = rec.get(source); return v.strip() if isinstance(v, str) else ""`
// The extra care in the TypeScript version exists because JavaScript objects secretly inherit
// properties like "constructor"; a Python dict has no such trap, so `rec.get(...)` is already safe.
// `string | null | undefined` = "a string, or None, or missing".
export function readCell(rec: Record<string, unknown>, source: string | null | undefined): string {
  if (!source || !Object.hasOwn(rec, source)) return "";
  const v = rec[source];
  return typeof v === "string" ? v.trim() : "";
}

// ---------------------------------------------------------------------------
// 5. VOCABULARY RESOLVERS: translating a farm's words
// ---------------------------------------------------------------------------

// Build a lookup table from a dict, with the keys lower-cased and trimmed so matching ignores case.
// `<V>` is a generic: "whatever type the values are". Python: `{k.strip().lower(): v for k, v in table.items()}`
const lowerKeyed = <V>(table: Record<string, V>): Map<string, V> =>
  new Map(Object.entries(table).map(([k, v]) => [k.trim().toLowerCase(), v]));

/** Translates a farm's sex word using the mapping; anything unknown passes through unchanged. */
// "Resolver" = a function-making function. sexResolver(mapping) RETURNS a function.
// Python:
//     def sex_resolver(mapping):
//         table = lower_keyed(mapping["transforms"]["sexValues"])
//         return lambda raw: table.get(raw.strip().lower(), raw)
// `(raw: string) => string` in the signature = `Callable[[str], str]`.
export function sexResolver(mapping: ImportMapping): (raw: string) => string {
  const table = lowerKeyed(mapping.transforms.sexValues);
  return (raw) => table.get(raw.trim().toLowerCase()) ?? raw;
}

// Is this (already translated) sex word "female"? Sows are marked F or FEMALE.
// `[...].includes(x)` = `x in [...]`.
export const isFemale = (sex: string): boolean => ["FEMALE", "F"].includes(sex.trim().toUpperCase());

// Built-in meanings of the castrated column.
const CASTRATED_YES = new Set(["yes", "true", "1", "y"]);
const CASTRATED_NO = new Set(["no", "false", "0", "n"]);

/** true / false for a castrated cell, or undefined when nothing (mapping or built-in) says what it means. */
// Returns True / False / None (Python) depending on the word. `undefined` is TypeScript's "no answer"
// (Python's `None`; TypeScript has both `null` and `undefined`, used here to mean "unknown").
// The nested `a ? x : b ? y : z` is Python's `x if a else (y if b else z)`.
export function castratedResolver(mapping: ImportMapping): (raw: string) => boolean | undefined {
  const table = lowerKeyed(mapping.transforms.castratedValues);
  return (raw) => {
    const key = raw.trim().toLowerCase();
    return table.get(key) ?? (CASTRATED_YES.has(key) ? true : CASTRATED_NO.has(key) ? false : undefined);
  };
}

// ---------------------------------------------------------------------------
// 6. applyMapping: the main translation function
// ---------------------------------------------------------------------------

/** A problem found while translating a cell, tied to the field it came from. */
// Python: `class MappingIssue(TypedDict): field: ImportColumn; message: str`
export interface MappingIssue {
  field: ImportColumn;
  message: string;
}

// What applyMapping returns: the translated rows, and, for each row, a list of problems.
// `ImportRow[]` = `list[ImportRow]`; `MappingIssue[][]` = `list[list[MappingIssue]]`.
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
// INPUT : the farm's rows, e.g. [{"Pig No": "GH-001", "Sex": "Sow", "Date of Birth": "12/03/2024", ...}, ...]
// OUTPUT: Nhoma's standard rows, e.g. [{"tagId": "GH-001", "sex": "FEMALE", "dateOfBirth": "2024-03-12", ...}]
//         plus a list of problems for each row.
//
// "Pure" = no database, no network, no randomness, no side effects: the same inputs always give the
// same outputs. That is exactly what makes it easy to evaluate: call it with a mapping and the
// records, compare the output with the answer you know is correct.
export function applyMapping(records: Record<string, unknown>[], mapping: ImportMapping): MappedRows {
  const toSex = sexResolver(mapping); // functions that translate sex / castrated words
  const toCastrated = castratedResolver(mapping);

  const rows: ImportRow[] = [];
  const issues: MappingIssue[][] = [];
  for (const rec of records) {
    const rowIssues: MappingIssue[] = [];
    // A helper defined inside the loop (a "closure": it can see `rec` and `mapping`).
    // cell("tagId") = "the value in the farm's column that feeds tagId, or the field's default, or empty".
    // `a || b || c` returns the first non-empty value (Python: `a or b or c`).
    const cell = (field: ImportColumn): string => {
      const fm = mapping.fields[field];
      return readCell(rec, fm?.source) || fm?.default?.trim() || "";
    };

    // ---- date of birth: read it in the chosen style and rewrite it as ISO (yyyy-MM-dd)
    let dateOfBirth = cell("dateOfBirth");
    if (dateOfBirth) {
      const iso = parseDate(dateOfBirth, mapping.transforms.dateFormat);
      if (iso) dateOfBirth = iso;
      else {
        // Not readable in that style: record a problem and blank the value so the validator
        // reports ONE clear message instead of a vague one.
        rowIssues.push({ field: "dateOfBirth", message: `"${dateOfBirth}" is not a valid ${mapping.transforms.dateFormat} date` });
        dateOfBirth = "";
      }
    }

    // ---- weight: placeholders ("n/a", "-") mean "not weighed"; otherwise read it and convert to kg
    let weightKg = cell("weightKg");
    if (isBlankPlaceholder(weightKg)) weightKg = ""; // "n/a" means "not weighed", not "bad data"
    if (weightKg) {
      const kg = parseWeight(weightKg, mapping.transforms.weightUnit, mapping.transforms.numberFormat);
      if (kg) weightKg = kg;
      else {
        rowIssues.push({ field: "weightKg", message: `"${weightKg}" is not a weight` });
        weightKg = "";
      }
    }

    // ---- sex: translate the farm's word ("Sow" -> "FEMALE"); unknown words pass through
    const sex = toSex(cell("sex"));

    // ---- castrated: only meaningful for males
    // Castrated only matters for males; sows are routinely marked "n/a" or "-" and must not fail for it.
    let castrated = "";
    const castratedRaw = cell("castrated");
    if (castratedRaw && !isFemale(sex)) {
      const meaning = toCastrated(castratedRaw);
      // `=== undefined` = "the resolver had no answer" (Python: `is None`)
      if (meaning === undefined) rowIssues.push({ field: "castrated", message: `"${castratedRaw}" is not yes or no` });
      else castrated = meaning ? "yes" : "no";
    }

    // Assemble Nhoma's standard row. A bare `sex,` here is shorthand for `sex: sex,`
    // (Python: `{"sex": sex, ...}`; JavaScript lets you omit the key when it matches the variable name).
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
