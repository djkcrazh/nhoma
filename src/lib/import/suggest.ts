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

export type MappingProblem =
  | { kind: "missingField"; field: ImportColumn }
  | { kind: "confirmDateOrder"; format: DateFormat; alternative: DateFormat }
  | { kind: "unreadableDates"; count: number; example: string; betterFormat?: DateFormat }
  | { kind: "confirmNumberFormat"; format: NumberFormat }
  | { kind: "unreadableWeights"; count: number; example: string; betterFormat?: NumberFormat }
  | { kind: "unknownSexValues"; values: string[]; rows: number }
  | { kind: "unknownCastratedValues"; values: string[]; rows: number };

export type MappingWarning =
  | { kind: "strayDates"; count: number; example: string }
  | { kind: "strayWeights"; count: number; example: string }
  | { kind: "straySexValues"; values: string[]; rows: number }
  | { kind: "strayCastratedValues"; values: string[]; rows: number };

export type Unresolved = MappingProblem | MappingWarning;

export interface MappingSuggestion {
  mapping: ImportMapping;
  /** Everything a person should look at. Empty means the mapping screen can be skipped. */
  unresolved: Unresolved[];
  /** Why a particular day/month order looks right. Shown beside the confirmation, never applied on its own. */
  dateHint?: { format: DateFormat; reason: string };
  /** Why a particular number convention looks right (e.g. "180,5" only reads with a decimal comma). Never applied without confirmation when a value is ambiguous. */
  numberHint?: { format: NumberFormat; reason: string };
}

/** Lower-case, strip accents and separators: "Né le" -> "nele", "Date_of Birth" -> "dateofbirth". */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_\-.:/()]+/g, "");
}

// Header names farms actually use, English / French / Spanish / Mandarin.
// Entries are matched after normalizeKey, so accents and spacing don't matter.
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

// Sex vocabulary -> canonical value. Keys go through normalizeKey. A Map, not an
// object literal: a cell reading "constructor" must not match Object.prototype.
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

export function standardSex(value: string): "MALE" | "FEMALE" | undefined {
  return STANDARD_SEX.get(value.trim().toLowerCase());
}

const SAMPLE_ROWS = 200;

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
export function resolveAmbiguousDateFormat(
  candidates: readonly DateFormat[],
  dates: readonly string[],
  now: Date = new Date(),
): DateFormat | null {
  const today = now.toISOString().slice(0, 10);
  const plausible = candidates.filter((format) =>
    dates.every((d) => {
      const iso = parseDate(d, format);
      return iso !== null && iso <= today; // yyyy-MM-dd strings sort chronologically
    }),
  );
  return plausible.length === 1 ? plausible[0] : null;
}

/** At least half of the non-empty cells: the mapping, not a stray cell, is the likely culprit. */
const isMajority = (bad: number, total: number) => total > 0 && bad * 2 >= total;

interface Analysis {
  missing: ImportColumn[];
  dates: { total: number; bad: string[]; betterFormat?: DateFormat };
  weights: { total: number; bad: string[]; betterFormat?: NumberFormat };
  sex: { total: number; unknownValues: string[]; unknownRows: number };
  castrated: { total: number; unknownValues: string[]; unknownRows: number };
}

/** One pass over the whole file, shared by checkMapping and mappingWarnings. */
function analyze(mapping: ImportMapping, records: Record<string, unknown>[]): Analysis {
  const column = (field: ImportColumn) => mapping.fields[field]?.source ?? null;

  const missing = REQUIRED_IMPORT_COLUMNS.filter((field) => {
    const hasDefault = field === "breed" && !!mapping.fields.breed?.default?.trim();
    return !column(field) && !hasDefault;
  });

  const dateSource = column("dateOfBirth");
  const dateCells = dateSource ? records.map((r) => readCell(r, dateSource)).filter(Boolean) : [];
  const format = mapping.transforms.dateFormat;
  const bad = dateCells.filter((d) => parseDate(d, format) === null);
  const other = dateOrderAlternative(format);
  // If the opposite day/month order reads every date the chosen one cannot, the chosen order is wrong.
  const betterFormat = other && bad.length > 0 && dateCells.every((d) => parseDate(d, other) !== null) ? other : undefined;

  const weightSource = column("weightKg");
  const weightCells = weightSource
    ? records.map((r) => readCell(r, weightSource)).filter((c) => c && !isBlankPlaceholder(c))
    : [];
  const { weightUnit, numberFormat } = mapping.transforms;
  const badWeights = weightCells.filter((c) => parseWeight(c, weightUnit, numberFormat) === null);
  const otherNumberFormat: NumberFormat = numberFormat === "en" ? "eu" : "en";
  // If the other convention reads every weight this one cannot, the chosen convention is wrong.
  const betterNumberFormat =
    badWeights.length > 0 && weightCells.every((c) => parseWeight(c, weightUnit, otherNumberFormat) !== null)
      ? otherNumberFormat
      : undefined;

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

  return {
    missing,
    dates: { total: dateCells.length, bad, betterFormat },
    weights: { total: weightCells.length, bad: badWeights, betterFormat: betterNumberFormat },
    sex: { total: sexTotal, unknownValues: [...unknownSex], unknownRows: unknownSexRows },
    castrated: { total: castratedTotal, unknownValues: [...unknownCastrated], unknownRows: unknownCastratedRows },
  };
}

const weightsAreBlocking = (a: Analysis) =>
  a.weights.bad.length > 0 && (isMajority(a.weights.bad.length, a.weights.total) || !!a.weights.betterFormat);

const dateIsBlocking = (a: Analysis) => a.dates.bad.length > 0 && (isMajority(a.dates.bad.length, a.dates.total) || !!a.dates.betterFormat);

/**
 * Problems that must be fixed on the mapping screen before importing. Anything
 * returned here would make the import fail wholesale or silently mis-read data,
 * so the screen keeps its Continue button off until this list is empty.
 */
export function checkMapping(mapping: ImportMapping, records: Record<string, unknown>[]): MappingProblem[] {
  const a = analyze(mapping, records);
  const problems: MappingProblem[] = a.missing.map((field) => ({ kind: "missingField", field }));

  const alternative = dateOrderAlternative(mapping.transforms.dateFormat);
  if (alternative && a.dates.total > 0 && needsDateOrderConfirmation(mapping)) {
    problems.push({ kind: "confirmDateOrder", format: mapping.transforms.dateFormat, alternative });
  }
  if (dateIsBlocking(a)) {
    problems.push({ kind: "unreadableDates", count: a.dates.bad.length, example: a.dates.bad[0], betterFormat: a.dates.betterFormat });
  }
  if (needsNumberFormatConfirmation(mapping, records)) {
    problems.push({ kind: "confirmNumberFormat", format: mapping.transforms.numberFormat });
  }
  if (weightsAreBlocking(a)) {
    problems.push({ kind: "unreadableWeights", count: a.weights.bad.length, example: a.weights.bad[0], betterFormat: a.weights.betterFormat });
  }
  if (a.sex.unknownValues.length > 0 && isMajority(a.sex.unknownRows, a.sex.total)) {
    problems.push({ kind: "unknownSexValues", values: a.sex.unknownValues, rows: a.sex.unknownRows });
  }
  if (a.castrated.unknownValues.length > 0 && isMajority(a.castrated.unknownRows, a.castrated.total)) {
    problems.push({ kind: "unknownCastratedValues", values: a.castrated.unknownValues, rows: a.castrated.unknownRows });
  }
  return problems;
}

/** A few bad cells: shown on the mapping screen for awareness, reported per row in the validation report. */
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

export function suggestMapping(
  headers: readonly string[],
  records: Record<string, unknown>[],
  opts: { now?: Date } = {},
): MappingSuggestion {
  const mapping = defaultMapping();
  let dateHint: MappingSuggestion["dateHint"];
  let numberHint: MappingSuggestion["numberHint"];
  const taken = new Set<string>();

  // 1. Columns: first unused header whose normalized name is a known alias.
  for (const field of IMPORT_COLUMNS) {
    const aliases = new Set([normalizeKey(field), ...HEADER_ALIASES[field]]);
    const source = headers.find((h) => h && !taken.has(h) && aliases.has(normalizeKey(h)));
    if (source) taken.add(source);
    mapping.fields[field] = { source: source ?? null };
  }

  const sample = records.slice(0, SAMPLE_ROWS);
  const valuesOf = (field: ImportColumn): string[] => {
    const src = mapping.fields[field]?.source;
    return src ? sample.map((r) => readCell(r, src)).filter(Boolean) : [];
  };

  // 2. Sex vocabulary: translate what we know (unknown words surface via checkMapping).
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
  const dates = valuesOf("dateOfBirth");
  if (dates.length > 0) {
    const readable = DATE_FORMATS.map((f) => [f, dates.filter((d) => parseDate(d, f) !== null).length] as const);
    const best = Math.max(...readable.map(([, n]) => n));
    if (best > 0 && best * 2 >= dates.length) {
      const fits = readable.filter(([, n]) => n === best).map(([f]) => f);
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
  const weightDigitsSample = valuesOf("weightKg").filter((v) => !isBlankPlaceholder(v)).map(weightDigits);
  const euOnly = weightDigitsSample.filter((d): d is string => !!d && parseNumber(d, "en") === null && parseNumber(d, "eu") !== null);
  const enOnly = weightDigitsSample.filter((d): d is string => !!d && parseNumber(d, "eu") === null && parseNumber(d, "en") !== null);
  if (euOnly.length > 0 && enOnly.length === 0) {
    mapping.transforms.numberFormat = "eu";
    numberHint = { format: "eu", reason: `“${euOnly[0]}” only makes sense with a decimal comma, so your numbers look European (1.234,5).` };
  }

  // 6. Weight unit from the header ("Weight (lb)", "poids lbs").
  const weightHeader = mapping.fields.weightKg?.source;
  if (weightHeader && /(lbs?|pounds?|libras?)$/.test(normalizeKey(weightHeader))) {
    mapping.transforms.weightUnit = "lb";
  }

  return { mapping, unresolved: [...checkMapping(mapping, records), ...mappingWarnings(mapping, records)], dateHint, numberHint };
}
