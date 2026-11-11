import { describe, expect, it } from "vitest";
import { checkMapping, mappingWarnings, normalizeKey, suggestMapping, type Unresolved } from "./suggest";
import { applyMapping, importMappingSchema, type ImportMapping } from "./mapping";
import { validateImportRows } from "./validate";
import { IMPORT_COLUMNS } from "./columns";

const HEADERS = ["tagId", "breed", "sex", "dateOfBirth"];
const row = (over: Record<string, string> = {}) => ({ tagId: "A", breed: "x", sex: "F", dateOfBirth: "2026-01-01", ...over });
const kinds = (u: Unresolved[]) => u.map((x) => x.kind);
const confirmed = (m: ImportMapping): ImportMapping => ({ ...m, transforms: { ...m.transforms, dateFormatConfirmed: true } });

const sources = (headers: string[], rows: Record<string, string>[] = []) => {
  const { mapping, unresolved } = suggestMapping(headers, rows);
  return { fields: Object.fromEntries(Object.entries(mapping.fields).map(([k, v]) => [k, v?.source])), mapping, unresolved };
};

describe("normalizeKey", () => {
  it("strips accents, case and separators", () => {
    expect(normalizeKey("Né le")).toBe("nele");
    expect(normalizeKey("Date_of Birth")).toBe("dateofbirth");
    expect(normalizeKey("Poids (kg)")).toBe("poidskg");
    expect(normalizeKey("出生日期")).toBe("出生日期");
  });
});

describe("suggestMapping: columns", () => {
  it("is the identity for the default template, with nothing for a person to settle", () => {
    const s = sources([...IMPORT_COLUMNS], [row({ sex: "FEMALE" })]);
    for (const c of IMPORT_COLUMNS) expect(s.fields[c]).toBe(c);
    expect(s.unresolved).toEqual([]);
    expect(importMappingSchema.safeParse(s.mapping).success).toBe(true);
  });

  it("recognises English variants", () => {
    const s = sources(["Pig ID", "Breed", "Gender", "DOB", "Weight (lb)", "Dam", "Sire", "Neutered", "Comments"]);
    expect(s.fields).toMatchObject({ tagId: "Pig ID", breed: "Breed", sex: "Gender", dateOfBirth: "DOB", weightKg: "Weight (lb)", motherTagId: "Dam", fatherTagId: "Sire", castrated: "Neutered", notes: "Comments" });
    expect(s.mapping.transforms.weightUnit).toBe("lb");
  });

  it("recognises French headers", () => {
    const s = sources(["Numéro", "Race", "Sexe", "Date de naissance", "Poids", "Mère", "Père", "Castré", "Remarques"]);
    expect(s.fields).toMatchObject({ tagId: "Numéro", breed: "Race", sex: "Sexe", dateOfBirth: "Date de naissance", weightKg: "Poids", motherTagId: "Mère", fatherTagId: "Père", castrated: "Castré" });
  });

  it("recognises Spanish headers", () => {
    const s = sources(["Arete", "Raza", "Sexo", "Fecha de nacimiento", "Peso", "Madre", "Padre", "Castrado", "Notas"]);
    expect(s.fields).toMatchObject({ tagId: "Arete", breed: "Raza", sex: "Sexo", dateOfBirth: "Fecha de nacimiento", weightKg: "Peso", motherTagId: "Madre", fatherTagId: "Padre", castrated: "Castrado", notes: "Notas" });
  });

  it("recognises Mandarin headers", () => {
    const s = sources(["猪号", "品种", "性别", "出生日期", "体重", "母号", "父号", "备注"]);
    expect(s.fields).toMatchObject({ tagId: "猪号", breed: "品种", sex: "性别", dateOfBirth: "出生日期", weightKg: "体重", motherTagId: "母号", fatherTagId: "父号", notes: "备注" });
  });

  it("flags every missing required field and leaves it unmapped", () => {
    const s = sources(["Colour", "Pen"]);
    expect(s.unresolved.filter((u) => u.kind === "missingField").map((u) => (u as { field: string }).field)).toEqual(["tagId", "breed", "sex", "dateOfBirth"]);
    expect(s.fields.tagId).toBeNull();
  });

  it("never maps one header to two fields", () => {
    const s = sources(["id", "Sex", "Breed", "Born"]);
    const used = Object.values(s.fields).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("suggestMapping: sex vocabulary", () => {
  const sexRows = (...vals: string[]) => vals.map((sex) => row({ sex }));

  it("translates the farm's words in four languages", () => {
    const { mapping, unresolved } = suggestMapping(HEADERS, sexRows("Truie", "Verrat", "Hembra", "Macho", "母", "公", "Sow", "Boar", "FEMALE"));
    expect(mapping.transforms.sexValues).toMatchObject({ Truie: "FEMALE", Verrat: "MALE", Hembra: "FEMALE", Macho: "MALE", 母: "FEMALE", 公: "MALE", Sow: "FEMALE", Boar: "MALE" });
    expect(kinds(unresolved)).not.toContain("unknownSexValues");
  });

  it("blocks when most sex words are untranslated (the vocabulary is the problem)", () => {
    const { unresolved } = suggestMapping(HEADERS, sexRows("Sow", "Weaner", "???"));
    const u = unresolved.find((x) => x.kind === "unknownSexValues") as { values: string[]; rows: number };
    expect(u.values.sort()).toEqual(["???", "Weaner"]);
    expect(u.rows).toBe(2);
  });

  it("only warns about a few stray words, so one typo can't trap the user", () => {
    const rows = [...sexRows(...Array(9).fill("Sow")), row({ sex: "Fmale" })];
    const { mapping, unresolved } = suggestMapping(HEADERS, rows);
    expect(kinds(unresolved)).toContain("straySexValues");
    expect(kinds(unresolved)).not.toContain("unknownSexValues");
    expect(checkMapping(mapping, rows)).toEqual([]); // not blocked
  });

  it("does not treat Object.prototype names as known sex words", () => {
    const rows = sexRows("constructor", "toString", "__proto__", "Sow");
    const { mapping, unresolved } = suggestMapping(HEADERS, rows);
    const u = unresolved.find((x) => x.kind === "unknownSexValues") as { values: string[] };
    expect(u.values.sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.keys(mapping.transforms.sexValues)).toEqual(["Sow"]);
    expect(Object.hasOwn(mapping.transforms.sexValues, "constructor")).toBe(false);
  });

  it("copes with a header called constructor", () => {
    expect(() => suggestMapping(["constructor", ...HEADERS], [{ constructor: "x", ...row() }])).not.toThrow();
  });
});

describe("suggestMapping: castrated vocabulary", () => {
  const H = [...HEADERS, "Castré"];
  const pigs = (...pairs: [string, string][]) => pairs.map(([sex, c]) => row({ sex, Castré: c }));

  it("learns the farm's words for males", () => {
    const { mapping } = suggestMapping(H, pigs(["Verrat", "oui"], ["Verrat", "non"], ["Verrat", "oui"]));
    expect(mapping.transforms.castratedValues).toEqual({ oui: true, non: false });
  });

  it("ignores what sows say, so 'n/a' on a sow is no problem", () => {
    const { unresolved } = suggestMapping(H, pigs(["Truie", "n/a"], ["Truie", "-"], ["Verrat", "oui"]));
    expect(kinds(unresolved)).not.toContain("unknownCastratedValues");
    expect(kinds(unresolved)).not.toContain("strayCastratedValues");
  });

  it("blocks when most males have a castrated value nobody can interpret", () => {
    const { unresolved } = suggestMapping(H, pigs(["Verrat", "peut-être"], ["Verrat", "?"], ["Verrat", "oui"]));
    expect(unresolved).toContainEqual({ kind: "unknownCastratedValues", values: ["peut-être", "?"], rows: 2 });
  });

  it("only warns about one stray value among many", () => {
    const rows = pigs(...(Array(9).fill(["Verrat", "oui"]) as [string, string][]), ["Verrat", "hmm"]);
    const { unresolved } = suggestMapping(H, rows);
    expect(unresolved).toContainEqual({ kind: "strayCastratedValues", values: ["hmm"], rows: 1 });
    expect(kinds(unresolved)).not.toContain("unknownCastratedValues");
  });
});

describe("suggestMapping: dates and the human check", () => {
  const withDates = (dates: string[], now?: string) =>
    suggestMapping(HEADERS, dates.map((d) => row({ dateOfBirth: d })), now ? { now: new Date(now) } : {});

  it("needs no confirmation for ISO, year-first or Chinese dates", () => {
    for (const [dates, fmt] of [
      [["2026-01-15", "2026-02-01"], "iso"],
      [["2026/01/15", "2026/02/01"], "yyyy/MM/dd"],
      [["2026年1月15日", "2026年2月1日"], "yyyy年M月d日"],
    ] as const) {
      const s = withDates([...dates]);
      expect(s.mapping.transforms.dateFormat).toBe(fmt);
      expect(kinds(s.unresolved)).not.toContain("confirmDateOrder");
    }
  });

  it("ALWAYS asks a person to confirm day vs month, even when only one reading fits", () => {
    const dayFirst = withDates(["15/01/2026", "03/04/2026"]);
    expect(dayFirst.mapping.transforms.dateFormat).toBe("dd/MM/yyyy"); // a day above 12 rules out month-first
    expect(dayFirst.mapping.transforms.dateFormatConfirmed).toBe(false);
    expect(dayFirst.unresolved).toContainEqual({ kind: "confirmDateOrder", format: "dd/MM/yyyy", alternative: "MM/dd/yyyy" });
    expect(dayFirst.dateHint?.reason).toBe("Only dd/MM/yyyy can read the dates in your file.");

    const monthFirst = withDates(["01/15/2026", "03/04/2026"]);
    expect(monthFirst.mapping.transforms.dateFormat).toBe("MM/dd/yyyy");
    expect(kinds(monthFirst.unresolved)).toContain("confirmDateOrder");
  });

  it("asks for dotted dates too", () => {
    const s = withDates(["15.01.2026", "01.02.2026"]);
    expect(s.mapping.transforms.dateFormat).toBe("dd.MM.yyyy");
    expect(kinds(s.unresolved)).toContain("confirmDateOrder");
  });

  it("clears the confirmation requirement once a person confirms", () => {
    const { mapping } = withDates(["15/01/2026", "03/04/2026"]);
    const rows = ["15/01/2026", "03/04/2026"].map((d) => row({ dateOfBirth: d }));
    expect(kinds(checkMapping(mapping, rows))).toContain("confirmDateOrder");
    expect(checkMapping(confirmed(mapping), rows)).toEqual([]);
  });

  it("with dates that read both ways, pre-selects nothing silently: it asks, and hints only when the future rules one out", () => {
    const tie = withDates(["03/04/2024", "05/06/2024"], "2026-11-08");
    expect(kinds(tie.unresolved)).toContain("confirmDateOrder");
    expect(tie.mapping.transforms.dateFormatConfirmed).toBe(false);
    expect(tie.dateHint).toBeUndefined();

    // 10/02/2026 on 1 May 2026: day-first is 10 Feb (past), month-first is 2 Oct (future)
    const hinted = withDates(["10/02/2026"], "2026-05-01");
    expect(hinted.mapping.transforms.dateFormat).toBe("dd/MM/yyyy");
    expect(hinted.mapping.transforms.dateFormatConfirmed).toBe(false); // still needs a person
    expect(hinted.dateHint).toEqual({ format: "dd/MM/yyyy", reason: "dd/MM/yyyy is the only order that keeps every date in the past." });
    expect(withDates(["02/10/2026"], "2026-05-01").dateHint?.format).toBe("MM/dd/yyyy");
  });

  it("still asks when both readings are plausible or both are in the future", () => {
    expect(withDates(["10/02/2026"], "2026-12-31").dateHint).toBeUndefined();
    expect(withDates(["10/11/2030"], "2026-05-01").dateHint).toBeUndefined();
  });

  it("blocks when no supported format can read the dates", () => {
    const s = withDates(["yesterday", "last week"]);
    expect(s.unresolved).toContainEqual({ kind: "unreadableDates", count: 2, example: "yesterday", betterFormat: undefined });
  });

  it("detects the format from most of the dates, so one impossible date cannot hide the column", () => {
    const rows = [...Array(9).fill("15/01/2026"), "31/02/2026"].map((d) => row({ dateOfBirth: d }));
    const s = suggestMapping(HEADERS, rows);
    expect(s.mapping.transforms.dateFormat).toBe("dd/MM/yyyy"); // 31/02 fails every format; the other nine decide
    expect(kinds(s.unresolved)).toContain("confirmDateOrder"); // a person still confirms the order
    expect(kinds(s.unresolved)).toContain("strayDates");
    expect(kinds(s.unresolved)).not.toContain("unreadableDates");
  });

  it("treats the stray date as a warning, not a blocker, once the order is confirmed", () => {
    const rows = [...Array(9).fill("15/01/2026"), "31/02/2026"].map((d) => row({ dateOfBirth: d }));
    const picked = confirmed(suggestMapping(HEADERS, rows).mapping);
    expect(checkMapping(picked, rows)).toEqual([]);
    expect(mappingWarnings(picked, rows)).toEqual([{ kind: "strayDates", count: 1, example: "31/02/2026" }]);
  });

  it("gives up on a format only when fewer than half the dates read", () => {
    const rows = ["15/01/2026", "yesterday", "last week", "n/a"].map((d) => row({ dateOfBirth: d }));
    const s = suggestMapping(HEADERS, rows);
    expect(s.mapping.transforms.dateFormat).toBe("iso");
    expect(kinds(s.unresolved)).toContain("unreadableDates");
  });

  it("blocks a confirmed order that the file contradicts, and names the order that fits", () => {
    const rows = ["15/01/2026", "20/02/2026"].map((d) => row({ dateOfBirth: d }));
    const { mapping } = suggestMapping(HEADERS, rows);
    const wrong: ImportMapping = { ...mapping, transforms: { ...mapping.transforms, dateFormat: "MM/dd/yyyy", dateFormatConfirmed: true } };
    expect(checkMapping(wrong, rows)).toEqual([{ kind: "unreadableDates", count: 2, example: "15/01/2026", betterFormat: "dd/MM/yyyy" }]);
  });
});

describe("checkMapping", () => {
  const headers = ["Numéro", "Race", "Sexe", "Naissance"];
  const records = [
    { Numéro: "T-1", Race: "Landrace", Sexe: "Truie", Naissance: "15/01/2024" },
    { Numéro: "V-1", Race: "Duroc", Sexe: "Verrat", Naissance: "20/03/2024" },
  ];

  it("is clean for a complete, well-formed, confirmed mapping", () => {
    const { mapping } = suggestMapping(headers, records);
    expect(checkMapping(confirmed(mapping), records)).toEqual([]);
  });

  it("flags a required field that was un-mapped by hand, but accepts a breed default", () => {
    const mapping = confirmed(suggestMapping(headers, records).mapping);
    mapping.fields.breed = { source: null };
    expect(checkMapping(mapping, records)).toEqual([{ kind: "missingField", field: "breed" }]);
    mapping.fields.breed = { source: null, default: "Mixed Breed" };
    expect(checkMapping(mapping, records)).toEqual([]);
    mapping.fields.sex = { source: null, default: "F" }; // sex can never be defaulted
    expect(checkMapping(mapping, records)).toEqual([{ kind: "missingField", field: "sex" }]);
  });

  it("flags sex values that have no translation, case-insensitively", () => {
    const mapping = confirmed(suggestMapping(headers, records).mapping);
    delete mapping.transforms.sexValues.Truie;
    expect(checkMapping(mapping, records)).toEqual([{ kind: "unknownSexValues", values: ["Truie"], rows: 1 }]);
    mapping.transforms.sexValues.truie = "FEMALE";
    expect(checkMapping(mapping, records)).toEqual([]);
  });

  it("flags dates the chosen format cannot read, with a count and example", () => {
    const mapping = confirmed(suggestMapping(headers, records).mapping);
    mapping.transforms.dateFormat = "iso";
    expect(checkMapping(mapping, records)).toEqual([{ kind: "unreadableDates", count: 2, example: "15/01/2024", betterFormat: undefined }]);
  });

  it("flags prototype names in sex cells too", () => {
    const mapping = confirmed(suggestMapping(headers, records).mapping);
    expect(checkMapping(mapping, [{ ...records[0], Sexe: "constructor" }])).toEqual([{ kind: "unknownSexValues", values: ["constructor"], rows: 1 }]);
  });
});

describe("suggest -> confirm -> apply -> validate (a French farm)", () => {
  it("imports a French file once a person confirms the date order", () => {
    const headers = ["Numéro", "Race", "Sexe", "Date de naissance", "Poids (kg)", "Mère", "Castré"];
    const records = [
      { Numéro: "T-1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "15/01/2024", "Poids (kg)": "180,5", Mère: "", Castré: "n/a" },
      { Numéro: "V-1", Race: "Duroc", Sexe: "Verrat", "Date de naissance": "20/03/2024", "Poids (kg)": "210", Mère: "", Castré: "oui" },
      { Numéro: "P-1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "25/06/2025", "Poids (kg)": "12,5", Mère: "T-1", Castré: "" },
    ];
    const { mapping, unresolved } = suggestMapping(headers, records);
    expect(kinds(unresolved)).toEqual(["confirmDateOrder"]); // the only thing left for a person
    const { rows, issues } = applyMapping(records, confirmed(mapping));
    const { results, valid } = validateImportRows(rows, new Map(), issues);
    expect(results.map((r) => r.errors)).toEqual([[], [], []]);
    expect(valid).toHaveLength(3);
    expect(rows[1]).toMatchObject({ sex: "MALE", castrated: "yes" });
    expect(rows[2]).toMatchObject({ tagId: "P-1", sex: "FEMALE", dateOfBirth: "2025-06-25", weightKg: "12.5", motherTagId: "T-1" });
  });
});
