import { IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS, type ImportColumn } from "./columns";
import { DATE_FORMATS, defaultMapping, parseDate, readCell, type DateFormat, type ImportMapping } from "./mapping";

/**
 * Deterministic first guess at an ImportMapping from a file's headers and a
 * sample of its rows: no model, no network. It powers the manual mapping screen
 * and is the baseline any future agent has to beat. Anything it cannot settle
 * with confidence is returned in `unresolved` for a person to decide.
 */

export type Unresolved =
  | { kind: "missingField"; field: ImportColumn }
  | { kind: "unknownSexValues"; values: string[] }
  | { kind: "ambiguousDate"; candidates: DateFormat[] }
  | { kind: "unparseableDates" };

export interface MappingSuggestion {
  mapping: ImportMapping;
  unresolved: Unresolved[];
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
  tagId: ["tagid", "tag", "id", "pigid", "eartag", "number", "pignumber", "numero", "identifiant", "identificacion", "arete", "caravana", "猪号", "耳号", "耳标", "编号"],
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
 * Every sampled date parses as BOTH dd/MM/yyyy and MM/dd/yyyy (no day above
 * 12 to break the tie, e.g. 03/04/2026). Return the format to pre-select, or
 * null to make the user choose.
 *
 * Policy: never guess from locale or habit. The function cannot see the user's
 * locale, and a wrong guess silently swaps day and month for every pig, while
 * asking costs one click. The one piece of hard evidence a file does carry is
 * that a pig cannot be born in the future (the importer rejects such dates), so
 * if exactly one reading keeps every date in the past, that reading wins.
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

export type MappingProblem =
  | { kind: "missingField"; field: ImportColumn }
  | { kind: "unknownSexValues"; values: string[] }
  | { kind: "unreadableDates"; count: number; example: string };

/**
 * Re-checks a (possibly hand-edited) mapping against the whole file. Anything
 * returned here would make the import fail or silently mis-read data, so the
 * mapping screen keeps its Continue button off until this list is empty.
 */
export function checkMapping(mapping: ImportMapping, records: Record<string, unknown>[]): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const column = (field: ImportColumn) => mapping.fields[field]?.source ?? null;
  const values = (field: ImportColumn) => {
    const src = column(field);
    return src ? records.map((r) => readCell(r, src)).filter(Boolean) : [];
  };

  for (const field of REQUIRED_IMPORT_COLUMNS) {
    const hasDefault = field === "breed" && !!mapping.fields.breed?.default?.trim();
    if (!column(field) && !hasDefault) problems.push({ kind: "missingField", field });
  }

  const translated = new Set(Object.keys(mapping.transforms.sexValues).map((k) => k.trim().toLowerCase()));
  const unknown = [...new Set(values("sex"))].filter((v) => !standardSex(v) && !translated.has(v.toLowerCase()));
  if (unknown.length > 0) problems.push({ kind: "unknownSexValues", values: unknown });

  const bad = values("dateOfBirth").filter((d) => parseDate(d, mapping.transforms.dateFormat) === null);
  if (bad.length > 0) problems.push({ kind: "unreadableDates", count: bad.length, example: bad[0] });

  return problems;
}

export function suggestMapping(
  headers: readonly string[],
  records: Record<string, unknown>[],
  opts: { now?: Date } = {},
): MappingSuggestion {
  const mapping = defaultMapping();
  const unresolved: Unresolved[] = [];
  const taken = new Set<string>();

  // 1. Columns: first unused header whose normalized name is a known alias.
  for (const field of IMPORT_COLUMNS) {
    const aliases = new Set([normalizeKey(field), ...HEADER_ALIASES[field]]);
    const source = headers.find((h) => h && !taken.has(h) && aliases.has(normalizeKey(h)));
    if (source) {
      taken.add(source);
      mapping.fields[field] = { source };
    } else {
      mapping.fields[field] = { source: null };
    }
  }
  for (const field of REQUIRED_IMPORT_COLUMNS) {
    if (!mapping.fields[field]?.source) unresolved.push({ kind: "missingField", field });
  }

  const sample = records.slice(0, SAMPLE_ROWS);
  const valuesOf = (field: ImportColumn): string[] => {
    const src = mapping.fields[field]?.source;
    return src ? sample.map((r) => readCell(r, src)).filter(Boolean) : [];
  };

  // 2. Sex vocabulary: translate what we know, surface what we don't.
  const known: [string, "MALE" | "FEMALE"][] = [];
  const unknownSex = new Set<string>();
  for (const value of new Set(valuesOf("sex"))) {
    const meaning = SEX_VOCAB.get(normalizeKey(value));
    if (meaning) known.push([value, meaning]);
    else unknownSex.add(value);
  }
  mapping.transforms.sexValues = Object.fromEntries(known); // fromEntries, not assignment: a value like "__proto__" stays a plain key
  if (unknownSex.size > 0) unresolved.push({ kind: "unknownSexValues", values: [...unknownSex] });

  // 3. Date format: keep every format that parses ALL sampled values.
  const dates = valuesOf("dateOfBirth");
  if (dates.length > 0) {
    const fits = DATE_FORMATS.filter((f) => dates.every((d) => parseDate(d, f) !== null));
    if (fits.length === 1) mapping.transforms.dateFormat = fits[0];
    else if (fits.length === 0) unresolved.push({ kind: "unparseableDates" });
    else {
      const picked = resolveAmbiguousDateFormat(fits, dates, opts.now);
      if (picked && fits.includes(picked)) mapping.transforms.dateFormat = picked;
      else unresolved.push({ kind: "ambiguousDate", candidates: [...fits] });
    }
  }

  // 4. Weight unit from the header ("Weight (lb)", "poids lbs").
  const weightHeader = mapping.fields.weightKg?.source;
  if (weightHeader && /(lbs?|pounds?|libras?)$/.test(normalizeKey(weightHeader))) {
    mapping.transforms.weightUnit = "lb";
  }

  return { mapping, unresolved };
}
