// =============================================================================
// suggest.ts: the NON-AI "first guess" at how to read a farm's spreadsheet.
//
// WHY THIS FILE MATTERS FOR EVALUATIONS
//   This is the BASELINE. In Phase 3 an AI model will propose mappings; the
//   evaluation question is "is the AI better than this plain, free, rule-based
//   guesser?". If it is not clearly better, we do not need the AI (and its cost).
//
// WHAT IT DOES
//   Input : the file's column headers + its rows (as a list of dicts).
//   Output: a proposed mapping (see mapping.ts) + a list of things a human
//           should look at.
//
// TWO KINDS OF "THINGS TO LOOK AT" (they need different reactions):
//   * MappingProblem : the MAPPING itself is wrong/incomplete -> block the import.
//                      e.g. no column for the pig ID; most dates unreadable; the
//                      day/month order has not been confirmed by a person.
//   * MappingWarning : a FEW stray cells are bad -> do NOT block; the bad rows
//                      will be listed individually in the validation report.
//                      e.g. one impossible date (31/02) in 500 rows.
//   The rule of thumb used throughout: "at least half the cells are bad" = the
//   mapping is the problem; "fewer than half" = a few stray cells.
//
// TYPESCRIPT-FOR-PYTHON-READERS cheat sheet: see README.md in this folder.
// =============================================================================

import { IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS, type ImportColumn } from "./columns";
import {
  DATE_FORMATS,
  castratedResolver,
  dateOrderAlternative,
  defaultMapping,
  isBlankPlaceholder,
  isFemale,
  needsDateOrderConfirmation,
  needsNumberFormatConfirmation,
  parseDate,
  parseNumber,
  parseWeight,
  readCell,
  sexResolver,
  weightDigits,
  type DateFormat,
  type ImportMapping,
  type NumberFormat,
} from "./mapping";

/**
 * Deterministic first guess at an ImportMapping from a file's headers and a
 * sample of its rows: no model, no network. It powers the manual mapping screen
 * and is the baseline any future agent has to beat.
 *
 * Two kinds of finding, because they call for different responses:
 *  - MappingProblem: the MAPPING is wrong or incomplete (a required field is
 *    unmapped, the date format reads most dates wrong, most sex words are
 *    untranslated, nobody confirmed the day/month order). Blocks the import.
 *  - MappingWarning: a few stray CELLS are bad. They would fail row by row in
 *    the validation report, which is where a person can see and fix them, so
 *    they must not trap the user on the mapping screen.
 */

// ---------------------------------------------------------------------------
// 1. THE KINDS OF FINDINGS (type definitions)
// ---------------------------------------------------------------------------
// A "discriminated union": a value that is ONE of several shapes, and the `kind` field tells you which.
// Python analogue: a Union of TypedDicts / dataclasses, each with a Literal `kind`, e.g.
//     class MissingField(TypedDict): kind: Literal["missingField"]; field: ImportColumn
//     MappingProblem = Union[MissingField, ConfirmDateOrder, ...]
// `betterFormat?:` marks an optional key.
export type MappingProblem =
  | { kind: "missingField"; field: ImportColumn } // a required field has no column
  | { kind: "confirmDateOrder"; format: DateFormat; alternative: DateFormat } // a human must pick day-first or month-first
  | { kind: "unreadableDates"; count: number; example: string; betterFormat?: DateFormat } // most dates don't match the chosen style
  | { kind: "confirmNumberFormat"; format: NumberFormat } // a human must pick the number convention
  | { kind: "unreadableWeights"; count: number; example: string; betterFormat?: NumberFormat } // most weights don't match the convention
  | { kind: "unknownSexValues"; values: string[]; rows: number } // most sex words have no translation
  | { kind: "unknownCastratedValues"; values: string[]; rows: number }; // most castrated words have no meaning

// The non-blocking cousins: only a few cells are affected.
export type MappingWarning =
  | { kind: "strayDates"; count: number; example: string }
  | { kind: "strayWeights"; count: number; example: string }
  | { kind: "straySexValues"; values: string[]; rows: number }
  | { kind: "strayCastratedValues"; values: string[]; rows: number };

// Either kind. (Python: `Unresolved = Union[MappingProblem, MappingWarning]`.)
export type Unresolved = MappingProblem | MappingWarning;

// What suggestMapping returns.
export interface MappingSuggestion {
  mapping: ImportMapping; // the proposed mapping
  /** Everything a person should look at. Empty means the mapping screen can be skipped. */
  unresolved: Unresolved[];
  /** Why a particular day/month order looks right. Shown beside the confirmation, never applied on its own. */
  dateHint?: { format: DateFormat; reason: string };
  /** Why a particular number convention looks right (e.g. "180,5" only reads with a decimal comma). Never applied without confirmation when a value is ambiguous. */
  numberHint?: { format: NumberFormat; reason: string };
}

// ---------------------------------------------------------------------------
// 2. HEADER MATCHING
// ---------------------------------------------------------------------------

/** Lower-case, strip accents and separators: "Né le" -> "nele", "Date_of Birth" -> "dateofbirth". */
// Makes header names comparable: "Pig No.", "pig_no", "PIG NO" all become "pigno".
// Python version:
//     import unicodedata, re
//     s = unicodedata.normalize("NFD", s)                      # split "é" into "e" + accent mark
//     s = "".join(c for c in s if not unicodedata.category(c).startswith("M"))   # drop accent marks
//     return re.sub(r"[\s_\-.:/()]+", "", s.lower())           # drop spaces, _, -, ., :, /, ( )
// (`\p{M}` is the regex class for "combining marks"; the `u` flag turns on Unicode mode; `g` = replace all.)
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_\-.:/()]+/g, "");
}

// Header names farms actually use, English / French / Spanish / Mandarin.
// Entries are matched after normalizeKey, so accents and spacing don't matter.
// A dict from "Nhoma field" to "list of normalized header names that mean it".
// `Record<ImportColumn, string[]>` = `dict[ImportColumn, list[str]]`.
// (To teach the guesser a new header name, add it to the right list; tests in suggest.test.ts check it.)
const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  tagId: ["tagid", "tag", "id", "pigid", "eartag", "number", "pignumber", "pigno", "pignum", "tagno", "tagnumber", "tagnum", "earno", "earnumber", "animalid", "animalno", "numero", "identifiant", "identificacion", "arete", "caravana", "猪号", "耳号", "耳标", "编号"],
  breed: ["breed", "race", "raza", "品种", "品系"],
  sex: ["sex", "gender", "sexe", "genre", "sexo", "性别"],
  dateOfBirth: ["dateofbirth", "dob", "birthdate", "birthday", "born", "datenaissance", "datedenaissance", "naissance", "fechanacimiento", "fechadenacimiento", "nacimiento", "出生日期", "出生", "生日"],
  weightKg: ["weight", "weightkg", "weightlb", "weightlbs", "poids", "poidskg", "peso", "pesokg", "体重", "重量"],
  motherTagId: ["mother", "mothertagid", "mothertag", "dam", "mere", "idmere", "madre", "母亲", "母号", "母本"],
  fatherTagId: ["father", "fathertagid", "fathertag", "sire", "pere", "idpere", "padre", "父亲", "父号", "父本"],
  castrated: ["castrated", "neutered", "castre", "castrado", "去势", "阉割", "已阉"],
  notes: ["notes", "note", "remarks", "comments", "comment", "observations", "notas", "observaciones", "备注", "说明"],
};

// ---------------------------------------------------------------------------
// 3. VOCABULARIES: farm words -> meaning
// ---------------------------------------------------------------------------

// Sex vocabulary -> canonical value. Keys go through normalizeKey. A Map, not an
// object literal: a cell reading "constructor" must not match Object.prototype.
// A lookup table from a normalized word to MALE/FEMALE. (A `Map` is Python's `dict`; the comment above
// explains why a plain JavaScript object `{}` is not used: it secretly contains keys like "constructor".)
// `new Map(Object.entries({...}))` builds a dict from a literal.
const SEX_VOCAB = new Map<string, "MALE" | "FEMALE">(
  Object.entries({
    m: "MALE", male: "MALE", boar: "MALE", barrow: "MALE", verrat: "MALE", macho: "MALE", verraco: "MALE", 公: "MALE", 公猪: "MALE", 雄: "MALE",
    f: "FEMALE", female: "FEMALE", sow: "FEMALE", gilt: "FEMALE", truie: "FEMALE", femelle: "FEMALE", hembra: "FEMALE", cerda: "FEMALE", marrana: "FEMALE", 母: "FEMALE", 母猪: "FEMALE", 雌: "FEMALE",
  } as const),
);

// Castrated vocabulary beyond the built-in yes/no/true/false/1/0/y/n.
const CASTRATED_VOCAB = new Map<string, boolean>(
  Object.entries({
    oui: true, si: true, castre: true, castrado: true, castrated: true, neutered: true, 是: true, 已阉: true, 已去势: true,
    non: false, 否: false, 未阉: false, intact: false, entier: false, entero: false,
  }),
);

/** What the importer already understands without any mapping: M, F, MALE, FEMALE. */
const STANDARD_SEX = new Map<string, "MALE" | "FEMALE">([
  ["m", "MALE"],
  ["f", "FEMALE"],
  ["male", "MALE"],
  ["female", "FEMALE"],
]);

// "Does the importer already understand this sex word without any translation?"
// Returns "MALE" / "FEMALE", or `undefined` (= None) if it is not one of the four standard words.
export function standardSex(value: string): "MALE" | "FEMALE" | undefined {
  return STANDARD_SEX.get(value.trim().toLowerCase());
}

// How many rows from the top of the file the guesser looks at when learning vocabularies and formats.
// (Checking happens on the WHOLE file; only the guessing uses a sample, for speed.)
const SAMPLE_ROWS = 200;

// ---------------------------------------------------------------------------
// 4. DAY/MONTH ORDER HINT
// ---------------------------------------------------------------------------

/**
 * Every sampled date parses as BOTH day-first and month-first (no day above 12
 * to break the tie, e.g. 03/04/2026). Returns the order that looks right, or
 * null when nothing in the file can tell.
 *
 * This only ever feeds a HINT: a person still confirms the order. The function
 * cannot see the user's locale, and a wrong guess silently swaps day and month
 * for every pig. The one piece of hard evidence a file does carry is that a pig
 * cannot be born in the future (the importer rejects such dates), so if exactly
 * one reading keeps every date in the past, that reading is suggested.
 */
// Example: dates ["10/02/2026"] checked on 1 May 2026:
//   day-first   -> 10 Feb 2026 (in the past)    OK
//   month-first -> 2 Oct 2026  (in the future)  impossible for a birth date
//   => only day-first is plausible, so suggest "dd/MM/yyyy".
// `now: Date = new Date()` is a default argument (Python: `now=None` then `now = now or datetime.now()`);
// tests pass a fixed date so results are repeatable.
export function resolveAmbiguousDateFormat(
  candidates: readonly DateFormat[],
  dates: readonly string[],
  now: Date = new Date(),
): DateFormat | null {
  const today = now.toISOString().slice(0, 10); // "2026-11-11"
  // Keep only the candidate formats under which EVERY date is valid and not in the future.
  // `array.filter(fn)` = `[x for x in array if fn(x)]`; `array.every(fn)` = `all(fn(x) for x in array)`.
  const plausible = candidates.filter((format) =>
    dates.every((d) => {
      const iso = parseDate(d, format);
      return iso !== null && iso <= today; // yyyy-MM-dd strings sort chronologically
    }),
  );
  // Exactly one survivor -> suggest it. Zero or two -> no suggestion (return None).
  return plausible.length === 1 ? plausible[0] : null;
}

// ---------------------------------------------------------------------------
// 5. ANALYSIS: measure how well a mapping reads the file
// ---------------------------------------------------------------------------

/** At least half of the non-empty cells: the mapping, not a stray cell, is the likely culprit. */
// The "majority" rule used everywhere below. Python: `total > 0 and bad * 2 >= total`.
const isMajority = (bad: number, total: number) => total > 0 && bad * 2 >= total;

// A bundle of measurements about one file under one mapping (internal; not exported).
interface Analysis {
  missing: ImportColumn[]; // required fields with no column
  dates: { total: number; bad: string[]; betterFormat?: DateFormat }; // how many dates, which ones can't be read
  weights: { total: number; bad: string[]; betterFormat?: NumberFormat };
  sex: { total: number; unknownValues: string[]; unknownRows: number };
  castrated: { total: number; unknownValues: string[]; unknownRows: number };
}

/** One pass over the whole file, shared by checkMapping and mappingWarnings. */
// Read the Analysis interface above first, then this function just fills it in, one field at a time.
function analyze(mapping: ImportMapping, records: Record<string, unknown>[]): Analysis {
  // column("sex") -> the farm's header for the sex column, or null if unmapped.
  const column = (field: ImportColumn) => mapping.fields[field]?.source ?? null;

  // Required fields that have no column (breed may instead have a default value like "Mixed Breed").
  const missing = REQUIRED_IMPORT_COLUMNS.filter((field) => {
    const hasDefault = field === "breed" && !!mapping.fields.breed?.default?.trim();
    return !column(field) && !hasDefault;
  });

  // ---- DATES: collect the non-empty date cells and find the ones the chosen format cannot read
  const dateSource = column("dateOfBirth");
  // `cond ? a : b` = `a if cond else b`.  `.filter(Boolean)` drops empty strings.
  const dateCells = dateSource ? records.map((r) => readCell(r, dateSource)).filter(Boolean) : [];
  const format = mapping.transforms.dateFormat;
  const bad = dateCells.filter((d) => parseDate(d, format) === null);
  const other = dateOrderAlternative(format);
  // If the opposite day/month order reads every date the chosen one cannot, the chosen order is wrong.
  const betterFormat = other && bad.length > 0 && dateCells.every((d) => parseDate(d, other) !== null) ? other : undefined;

  // ---- WEIGHTS: same idea, with number conventions. "n/a"-style placeholders are ignored.
  const weightSource = column("weightKg");
  const weightCells = weightSource
    ? records.map((r) => readCell(r, weightSource)).filter((c) => c && !isBlankPlaceholder(c))
    : [];
  // `const { a, b } = obj` unpacks keys into variables (Python: `a, b = obj["a"], obj["b"]`).
  const { weightUnit, numberFormat } = mapping.transforms;
  const badWeights = weightCells.filter((c) => parseWeight(c, weightUnit, numberFormat) === null);
  const otherNumberFormat: NumberFormat = numberFormat === "en" ? "eu" : "en";
  // If the other convention reads every weight this one cannot, the chosen convention is wrong.
  const betterNumberFormat =
    badWeights.length > 0 && weightCells.every((c) => parseWeight(c, weightUnit, otherNumberFormat) !== null)
      ? otherNumberFormat
      : undefined;

  // ---- SEX: count cells whose word is neither a standard word nor translated by the mapping
  const toSex = sexResolver(mapping);
  const translated = new Set(Object.keys(mapping.transforms.sexValues).map((k) => k.trim().toLowerCase()));
  const sexSource = column("sex");
  const unknownSex = new Set<string>();
  let sexTotal = 0;
  let unknownSexRows = 0;
  if (sexSource) {
    for (const rec of records) {
      const v = readCell(rec, sexSource);
      if (!v) continue;
      sexTotal++;
      if (!standardSex(v) && !translated.has(v.toLowerCase())) {
        unknownSexRows++;
        unknownSex.add(v);
      }
    }
  }

  // ---- CASTRATED: same, but ignore sows (they are routinely "n/a")
  const toCastrated = castratedResolver(mapping);
  const castratedSource = column("castrated");
  const unknownCastrated = new Set<string>();
  let castratedTotal = 0;
  let unknownCastratedRows = 0;
  if (castratedSource) {
    for (const rec of records) {
      const v = readCell(rec, castratedSource);
      if (!v || isFemale(toSex(readCell(rec, sexSource)))) continue; // sows are routinely "n/a"
      castratedTotal++;
      if (toCastrated(v) === undefined) {
        unknownCastratedRows++;
        unknownCastrated.add(v);
      }
    }
  }

  // `[...someSet]` turns a set into a list (Python: `list(some_set)`).
  return {
    missing,
    dates: { total: dateCells.length, bad, betterFormat },
    weights: { total: weightCells.length, bad: badWeights, betterFormat: betterNumberFormat },
    sex: { total: sexTotal, unknownValues: [...unknownSex], unknownRows: unknownSexRows },
    castrated: { total: castratedTotal, unknownValues: [...unknownCastrated], unknownRows: unknownCastratedRows },
  };
}

// "Do the unreadable weights/dates mean the MAPPING is wrong?"  Yes if at least half are bad,
// or if the opposite convention reads them all (strong evidence the chosen one is wrong).
// `!!x` = `bool(x)`.
const weightsAreBlocking = (a: Analysis) =>
  a.weights.bad.length > 0 && (isMajority(a.weights.bad.length, a.weights.total) || !!a.weights.betterFormat);

const dateIsBlocking = (a: Analysis) => a.dates.bad.length > 0 && (isMajority(a.dates.bad.length, a.dates.total) || !!a.dates.betterFormat);

// ---------------------------------------------------------------------------
// 6. checkMapping / mappingWarnings: the two public "report card" functions
// ---------------------------------------------------------------------------

/**
 * Problems that must be fixed on the mapping screen before importing. Anything
 * returned here would make the import fail wholesale or silently mis-read data,
 * so the screen keeps its Continue button off until this list is empty.
 */
// Given ANY mapping (suggested, hand-edited, or AI-proposed) and the file's rows, return the list of
// BLOCKING problems. An empty list means "safe to continue".
// FOR EVALUATIONS: `checkMapping(proposedMapping, records) == []` is a cheap, free pass/fail signal.
export function checkMapping(mapping: ImportMapping, records: Record<string, unknown>[]): MappingProblem[] {
  const a = analyze(mapping, records);
  // A required field with no column becomes a "missingField" problem.
  // `.map((field) => ({ ... }))` builds one dict per item; the parentheses around `{...}` just tell
  // JavaScript "this brace is a dict, not a function body".
  const problems: MappingProblem[] = a.missing.map((field) => ({ kind: "missingField", field }));

  // Human-in-the-loop #1: the day/month order must be confirmed by a person.
  const alternative = dateOrderAlternative(mapping.transforms.dateFormat);
  if (alternative && a.dates.total > 0 && needsDateOrderConfirmation(mapping)) {
    problems.push({ kind: "confirmDateOrder", format: mapping.transforms.dateFormat, alternative });
  }
  if (dateIsBlocking(a)) {
    problems.push({ kind: "unreadableDates", count: a.dates.bad.length, example: a.dates.bad[0], betterFormat: a.dates.betterFormat });
  }
  // Human-in-the-loop #2: the number convention must be confirmed when a value reads two ways.
  if (needsNumberFormatConfirmation(mapping, records)) {
    problems.push({ kind: "confirmNumberFormat", format: mapping.transforms.numberFormat });
  }
  if (weightsAreBlocking(a)) {
    problems.push({ kind: "unreadableWeights", count: a.weights.bad.length, example: a.weights.bad[0], betterFormat: a.weights.betterFormat });
  }
  // Untranslated sex / castrated words only block when MOST of the file is affected.
  if (a.sex.unknownValues.length > 0 && isMajority(a.sex.unknownRows, a.sex.total)) {
    problems.push({ kind: "unknownSexValues", values: a.sex.unknownValues, rows: a.sex.unknownRows });
  }
  if (a.castrated.unknownValues.length > 0 && isMajority(a.castrated.unknownRows, a.castrated.total)) {
    problems.push({ kind: "unknownCastratedValues", values: a.castrated.unknownValues, rows: a.castrated.unknownRows });
  }
  return problems;
}

/** A few bad cells: shown on the mapping screen for awareness, reported per row in the validation report. */
// The mirror image of checkMapping: the same findings, but only the ones where FEW cells are affected.
export function mappingWarnings(mapping: ImportMapping, records: Record<string, unknown>[]): MappingWarning[] {
  const a = analyze(mapping, records);
  const warnings: MappingWarning[] = [];
  if (a.dates.bad.length > 0 && !dateIsBlocking(a)) {
    warnings.push({ kind: "strayDates", count: a.dates.bad.length, example: a.dates.bad[0] });
  }
  if (a.weights.bad.length > 0 && !weightsAreBlocking(a)) {
    warnings.push({ kind: "strayWeights", count: a.weights.bad.length, example: a.weights.bad[0] });
  }
  if (a.sex.unknownValues.length > 0 && !isMajority(a.sex.unknownRows, a.sex.total)) {
    warnings.push({ kind: "straySexValues", values: a.sex.unknownValues, rows: a.sex.unknownRows });
  }
  if (a.castrated.unknownValues.length > 0 && !isMajority(a.castrated.unknownRows, a.castrated.total)) {
    warnings.push({ kind: "strayCastratedValues", values: a.castrated.unknownValues, rows: a.castrated.unknownRows });
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// 7. suggestMapping: the main entry point
// ---------------------------------------------------------------------------

// INPUT : headers (list of column names), records (list of dicts), opts.now (only tests set this)
// OUTPUT: a MappingSuggestion (proposed mapping + what a human should look at)
// `opts: { now?: Date } = {}` is an optional "options" argument with a default of an empty dict.
export function suggestMapping(
  headers: readonly string[],
  records: Record<string, unknown>[],
  opts: { now?: Date } = {},
): MappingSuggestion {
  const mapping = defaultMapping(); // start from the blank default and fill it in
  let dateHint: MappingSuggestion["dateHint"]; // (an indexed-access type: "the type of the dateHint field above")
  let numberHint: MappingSuggestion["numberHint"];
  const taken = new Set<string>(); // headers already assigned to a field (one header feeds at most one field)

  // 1. Columns: first unused header whose normalized name is a known alias.
  // For each Nhoma field, find the first unused header whose normalized name is one of its aliases.
  // Python version of the inside of the loop:
  //     aliases = {normalize_key(field), *HEADER_ALIASES[field]}
  //     source = next((h for h in headers if h and h not in taken and normalize_key(h) in aliases), None)
  for (const field of IMPORT_COLUMNS) {
    const aliases = new Set([normalizeKey(field), ...HEADER_ALIASES[field]]);
    const source = headers.find((h) => h && !taken.has(h) && aliases.has(normalizeKey(h)));
    if (source) taken.add(source);
    mapping.fields[field] = { source: source ?? null };
  }

  // Take only the first 200 rows as a sample (`.slice(0, 200)` = `[:200]`).
  const sample = records.slice(0, SAMPLE_ROWS);
  // valuesOf("sex") -> the non-empty cell values of the (mapped) sex column in the sample.
  const valuesOf = (field: ImportColumn): string[] => {
    const src = mapping.fields[field]?.source;
    return src ? sample.map((r) => readCell(r, src)).filter(Boolean) : [];
  };

  // 2. Sex vocabulary: translate what we know (unknown words surface via checkMapping).
  // For each DISTINCT sex word in the file that we recognise, record its meaning in the mapping.
  const knownSex: [string, "MALE" | "FEMALE"][] = [];
  for (const value of new Set(valuesOf("sex"))) {
    const meaning = SEX_VOCAB.get(normalizeKey(value));
    if (meaning) knownSex.push([value, meaning]);
  }
  mapping.transforms.sexValues = Object.fromEntries(knownSex); // fromEntries, not assignment: "__proto__" stays a plain key

  // 3. Castrated vocabulary, for rows where it matters (not sows).
  const toSex = sexResolver(mapping);
  const castratedSource = mapping.fields.castrated?.source;
  const sexSource = mapping.fields.sex?.source;
  const knownCastrated: [string, boolean][] = [];
  if (castratedSource) {
    for (const rec of sample) {
      const value = readCell(rec, castratedSource);
      if (!value || isFemale(toSex(readCell(rec, sexSource)))) continue;
      const meaning = CASTRATED_VOCAB.get(normalizeKey(value));
      if (meaning !== undefined && !knownCastrated.some(([k]) => k === value)) knownCastrated.push([value, meaning]);
    }
  }
  mapping.transforms.castratedValues = Object.fromEntries(knownCastrated);

  // 4. Date format: the format(s) that read the MOST sampled dates, provided they read at
  // least half. A few impossible dates (31/02) fail every format and must not make the
  // whole column look unreadable. Order-sensitive formats are only ever PROPOSED here;
  // a person confirms (dateFormatConfirmed).
  //
  // IN PLAIN WORDS: try every date style on the sample, count how many dates each style can read,
  // and pick the best one (if it reads at least half the dates). If two styles tie (e.g. dd/MM and
  // MM/dd on dates where the day is 12 or less), use the "not in the future" hint, but NEVER mark
  // it confirmed: only a person does that.
  const dates = valuesOf("dateOfBirth");
  if (dates.length > 0) {
    // List of [format, how many dates it can read]. `as const` here just freezes the pair.
    const readable = DATE_FORMATS.map((f) => [f, dates.filter((d) => parseDate(d, f) !== null).length] as const);
    // `Math.max(...list)` = Python `max(list)` (the `...` spreads the list into separate arguments, like `*list`).
    const best = Math.max(...readable.map(([, n]) => n));
    if (best > 0 && best * 2 >= dates.length) {
      const fits = readable.filter(([, n]) => n === best).map(([f]) => f); // all styles tied for best
      if (fits.length === 1) {
        mapping.transforms.dateFormat = fits[0];
        if (dateOrderAlternative(fits[0])) {
          dateHint = { format: fits[0], reason: `Only ${fits[0]} can read the dates in your file.` };
        }
      } else {
        // Judge the tie only on dates some candidate can read; strays tell us nothing.
        const usable = dates.filter((d) => fits.some((f) => parseDate(d, f) !== null));
        const picked = resolveAmbiguousDateFormat(fits, usable, opts.now);
        mapping.transforms.dateFormat = picked ?? fits[0];
        if (picked) dateHint = { format: picked, reason: `${picked} is the only order that keeps every date in the past.` };
      }
    } // otherwise leave ISO; checkMapping reports the dates as unreadable.
  }

  // 5. Number convention. English (1,234.5) is the default. Switch to European (1.234,5) only
  // when the file contains a value that cannot be English, like "180,5", and none that cannot
  // be European. Values that read both ways ("1,200") are left to a person via checkMapping.
  //
  // IN PLAIN WORDS: "180,5" is impossible in English (a comma must be followed by exactly three digits),
  // so if we see such a value and nothing that is impossible in the European style, the file must be
  // European. `(d): d is string => ...` is a "type guard": it filters out nulls AND tells the type
  // checker the rest are strings (Python: just `[d for d in xs if d and ...]`).
  const weightDigitsSample = valuesOf("weightKg").filter((v) => !isBlankPlaceholder(v)).map(weightDigits);
  const euOnly = weightDigitsSample.filter((d): d is string => !!d && parseNumber(d, "en") === null && parseNumber(d, "eu") !== null);
  const enOnly = weightDigitsSample.filter((d): d is string => !!d && parseNumber(d, "eu") === null && parseNumber(d, "en") !== null);
  if (euOnly.length > 0 && enOnly.length === 0) {
    mapping.transforms.numberFormat = "eu";
    numberHint = { format: "eu", reason: `“${euOnly[0]}” only makes sense with a decimal comma, so your numbers look European (1.234,5).` };
  }

  // 6. Weight unit from the header ("Weight (lb)", "poids lbs").
  // If the weight column's header ends in lb/lbs/pound(s)/libra(s), the numbers are pounds.
  const weightHeader = mapping.fields.weightKg?.source;
  if (weightHeader && /(lbs?|pounds?|libras?)$/.test(normalizeKey(weightHeader))) {
    mapping.transforms.weightUnit = "lb";
  }

  // Finally: run the report-card functions on our own suggestion, so the caller knows what (if anything)
  // a person still has to look at.   `[...a, ...b]` = `a + b` for lists.
  return { mapping, unresolved: [...checkMapping(mapping, records), ...mappingWarnings(mapping, records)], dateHint, numberHint };
}
