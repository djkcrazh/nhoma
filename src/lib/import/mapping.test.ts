// =============================================================================
// mapping.test.ts: tests for the mapping format and applyMapping (mapping.ts).
//   Sections, in order: the schema (what a valid/invalid mapping looks like) -> the date-order
//   and number-format confirmation rules -> parseDate / parseNumber / parseWeight (the parsers)
//   -> readCell -> vocabulary resolvers -> applyMapping end to end (a French farm, castrated
//   words, weights, defaults, hostile input like a header called "constructor").
//   THIS IS THE BEST FILE TO SKIM to see exactly what applyMapping promises.
//   Run just this file:  npx vitest run src/lib/import/mapping.test.ts
//   HOW TO READ A VITEST FILE IF YOU KNOW PYTHON/PYTEST
//     describe("group", () => { ... })   a group of related tests   (like a test class)
//     it("does X", () => { ... })        one test; the sentence is the requirement  (like `def test_does_x():`)
//     expect(a).toBe(b) / .toEqual(b)    assert a == b
//     expect(a).toContainEqual(b)        assert b in a
//     expect(fn).toThrow()               with pytest.raises(...)
//   `const x = ...` just means "a variable that is not reassigned". See README.md (this folder)
//   for the full TypeScript <-> Python cheat sheet.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  applyMapping,
  castratedResolver,
  dateOrderAlternative,
  defaultMapping,
  importMappingSchema,
  isAmbiguousNumber,
  isBlankPlaceholder,
  isDateOrderSensitive,
  needsDateOrderConfirmation,
  needsNumberFormatConfirmation,
  parseDate,
  parseNumber,
  parseWeight,
  readCell,
  sexResolver,
  type ImportMapping,
} from "./mapping";
import { validateImportRows } from "./validate";

describe("importMappingSchema", () => {
  it("accepts the default mapping", () => {
    expect(importMappingSchema.safeParse(defaultMapping()).success).toBe(true);
  });

  it("rejects unknown keys, bad formats and oversize strings (it is untrusted input)", () => {
    const m = defaultMapping();
    expect(importMappingSchema.safeParse({ ...m, extra: 1 }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...m, transforms: { ...m.transforms, dateFormat: "yy-dd" } }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...m, fields: { ...m.fields, tagId: { source: "x".repeat(201) } } }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...m, fields: { ...m.fields, tagId: { source: "a", code: "eval()" } } }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...m, transforms: { ...m.transforms, sexValues: { x: "UNKNOWN" } } }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...m, transforms: { ...m.transforms, castratedValues: { x: "yes" } } }).success).toBe(false);
  });

  it("requires the date-order and number-format settings to be present", () => {
    const { dateFormatConfirmed, ...noDate } = defaultMapping().transforms;
    void dateFormatConfirmed;
    expect(importMappingSchema.safeParse({ ...defaultMapping(), transforms: noDate }).success).toBe(false);
    const { numberFormat, ...noNumber } = defaultMapping().transforms;
    void numberFormat;
    expect(importMappingSchema.safeParse({ ...defaultMapping(), transforms: noNumber }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...defaultMapping(), transforms: { ...defaultMapping().transforms, numberFormat: "fr" } }).success).toBe(false);
  });

  it("defaults to the English convention (comma groups thousands, period is the decimal point)", () => {
    expect(defaultMapping().transforms.numberFormat).toBe("en");
  });

  it("accepts optional confidence and reason on a field, and bounds them", () => {
    const m = defaultMapping();
    const withMeta = { ...m, fields: { ...m.fields, tagId: { source: "Ear tag", confidence: 0.9, reason: "Header is a common alias for the pig ID" } } };
    expect(importMappingSchema.safeParse(withMeta).success).toBe(true);
    expect(importMappingSchema.safeParse({ ...m, fields: { ...m.fields, tagId: { source: "a", confidence: 1.5 } } }).success).toBe(false);
    expect(importMappingSchema.safeParse({ ...m, fields: { ...m.fields, tagId: { source: "a", reason: "x".repeat(301) } } }).success).toBe(false);
  });
});

describe("date order confirmation", () => {
  it("knows which formats leave day vs month in doubt", () => {
    expect(dateOrderAlternative("dd/MM/yyyy")).toBe("MM/dd/yyyy");
    expect(dateOrderAlternative("MM/dd/yyyy")).toBe("dd/MM/yyyy");
    expect(dateOrderAlternative("dd.MM.yyyy")).toBe("MM.dd.yyyy");
    for (const f of ["iso", "yyyy/MM/dd", "yyyy年M月d日"] as const) {
      expect(dateOrderAlternative(f)).toBeNull();
      expect(isDateOrderSensitive(f)).toBe(false);
    }
  });

  const withDates = (dateFormat: ImportMapping["transforms"]["dateFormat"], confirmed: boolean): ImportMapping => {
    const m = defaultMapping();
    return { ...m, transforms: { ...m.transforms, dateFormat, dateFormatConfirmed: confirmed } };
  };

  it("requires confirmation for an order-sensitive format until a person confirms", () => {
    expect(needsDateOrderConfirmation(withDates("dd/MM/yyyy", false))).toBe(true);
    expect(needsDateOrderConfirmation(withDates("MM/dd/yyyy", false))).toBe(true);
    expect(needsDateOrderConfirmation(withDates("dd/MM/yyyy", true))).toBe(false);
  });

  it("never asks for ISO, year-first or Chinese dates", () => {
    for (const f of ["iso", "yyyy/MM/dd", "yyyy年M月d日"] as const) expect(needsDateOrderConfirmation(withDates(f, false))).toBe(false);
  });

  it("does not ask when the file has no date column mapped", () => {
    const m = withDates("dd/MM/yyyy", false);
    expect(needsDateOrderConfirmation({ ...m, fields: { ...m.fields, dateOfBirth: { source: null } } })).toBe(false);
  });
});

describe("parseDate", () => {
  it("parses each supported format to yyyy-MM-dd", () => {
    expect(parseDate("2026-05-01", "iso")).toBe("2026-05-01");
    expect(parseDate("2026-5-1T10:00:00Z", "iso")).toBe("2026-05-01");
    expect(parseDate("15/01/2026", "dd/MM/yyyy")).toBe("2026-01-15");
    expect(parseDate("01/15/2026", "MM/dd/yyyy")).toBe("2026-01-15");
    expect(parseDate("15.01.2026", "dd.MM.yyyy")).toBe("2026-01-15");
    expect(parseDate("01.15.2026", "MM.dd.yyyy")).toBe("2026-01-15");
    expect(parseDate("2026/01/15", "yyyy/MM/dd")).toBe("2026-01-15");
    expect(parseDate("2026年1月5日", "yyyy年M月d日")).toBe("2026-01-05");
  });

  it("reads the same text two ways depending on the order", () => {
    expect(parseDate("03/04/2024", "dd/MM/yyyy")).toBe("2024-04-03");
    expect(parseDate("03/04/2024", "MM/dd/yyyy")).toBe("2024-03-04");
  });

  it("rejects impossible calendar dates and wrong shapes", () => {
    expect(parseDate("31/02/2026", "dd/MM/yyyy")).toBeNull();
    expect(parseDate("13/01/2026", "MM/dd/yyyy")).toBeNull(); // month 13
    expect(parseDate("15/01/26", "dd/MM/yyyy")).toBeNull(); // two-digit year unsupported
    expect(parseDate("hello", "iso")).toBeNull();
  });
});

describe("parseNumber", () => {
  it("English: a comma is a thousands separator and a period is the decimal point", () => {
    expect(parseNumber("12.5", "en")).toBe(12.5);
    expect(parseNumber("1,200", "en")).toBe(1200);
    expect(parseNumber("1,234,567.89", "en")).toBe(1234567.89);
    expect(parseNumber("85", "en")).toBe(85);
  });

  it("European: a period is a thousands separator and a comma is the decimal point", () => {
    expect(parseNumber("12,5", "eu")).toBe(12.5);
    expect(parseNumber("1.200", "eu")).toBe(1200);
    expect(parseNumber("1.234,5", "eu")).toBe(1234.5);
  });

  it("rejects text that is not valid in the convention, instead of misreading it", () => {
    expect(parseNumber("12,5", "en")).toBeNull(); // a thousands group needs exactly three digits
    expect(parseNumber("1,20", "en")).toBeNull();
    expect(parseNumber("12.5", "eu")).toBeNull();
    expect(parseNumber("0.5", "eu")).toBeNull();
    expect(parseNumber("1,2,3", "en")).toBeNull();
    expect(parseNumber("", "en")).toBeNull();
    expect(parseNumber("abc", "en")).toBeNull();
  });

  it("flags only values that mean different things in the two conventions", () => {
    for (const v of ["1,200", "1.200", "1,234", "2.500 kg"]) expect(isAmbiguousNumber(v)).toBe(true);
    for (const v of ["12.5", "12,5", "85", "100 lb", "1,234.5", "1.234,5", "abc", ""]) expect(isAmbiguousNumber(v)).toBe(false);
  });
});

describe("parseWeight", () => {
  it("reads English numbers by default", () => {
    expect(parseWeight("12.5", "kg")).toBe("12.5");
    expect(parseWeight("1,250.5", "kg")).toBe("1250.5");
    expect(parseWeight("12.5 kg", "lb")).toBe("12.5"); // unit in the cell wins
  });

  it("does NOT read a decimal comma as English: 12,5 is an error, not 125", () => {
    expect(parseWeight("12,5", "kg")).toBeNull();
    expect(parseWeight("1,200", "kg")).toBe("1200"); // a comma is a comma
  });

  it("reads European numbers when asked", () => {
    expect(parseWeight("12,5", "kg", "eu")).toBe("12.5");
    expect(parseWeight("1.250,5", "kg", "eu")).toBe("1250.5");
    expect(parseWeight("1,200", "kg", "eu")).toBe("1.2");
  });

  it("converts pounds to kilograms, rounded to 2 places", () => {
    expect(parseWeight("100", "lb")).toBe("45.36");
    expect(parseWeight("27.6 lbs", "kg")).toBe("12.52");
  });

  it("rejects non-numeric text", () => {
    expect(parseWeight("heavy", "kg")).toBeNull();
    expect(parseWeight("12 stone", "kg")).toBeNull();
  });
});

describe("blank weight placeholders", () => {
  it("recognises the ways farms write 'not weighed'", () => {
    for (const v of ["n/a", "N/A", "na", "-", "--", "?", "unknown", "None"]) expect(isBlankPlaceholder(v)).toBe(true);
    for (const v of ["0", "12.5", "heavy", ""]) expect(isBlankPlaceholder(v)).toBe(false);
  });
});

describe("number format confirmation", () => {
  const withWeights = (numberFormatConfirmed: boolean): ImportMapping => ({
    ...defaultMapping(),
    transforms: { ...defaultMapping().transforms, numberFormatConfirmed },
  });
  const recs = (...w: string[]) => w.map((weightKg) => ({ weightKg }));

  it("is required only when some weight reads two ways and nobody confirmed", () => {
    expect(needsNumberFormatConfirmation(withWeights(false), recs("85.5", "1,200"))).toBe(true);
    expect(needsNumberFormatConfirmation(withWeights(true), recs("85.5", "1,200"))).toBe(false);
  });

  it("is not required when every value is unambiguous", () => {
    expect(needsNumberFormatConfirmation(withWeights(false), recs("85.5", "112", "1,020.5"))).toBe(false);
    expect(needsNumberFormatConfirmation(withWeights(false), recs("180,5", "12,5"))).toBe(false);
  });

  it("is not required when weights are not mapped", () => {
    const m = withWeights(false);
    expect(needsNumberFormatConfirmation({ ...m, fields: { ...m.fields, weightKg: { source: null } } }, recs("1,200"))).toBe(false);
  });
});

describe("readCell", () => {
  it("reads and trims own string properties", () => {
    expect(readCell({ a: "  x " }, "a")).toBe("x");
  });

  it("reads blank for a missing, null or non-string source", () => {
    expect(readCell({ a: "x" }, null)).toBe("");
    expect(readCell({ a: "x" }, "b")).toBe("");
    expect(readCell({ a: ["x", "y"] }, "a")).toBe("");
    expect(readCell({ a: 5 }, "a")).toBe("");
  });

  it("never reaches the prototype chain", () => {
    expect(readCell({}, "constructor")).toBe("");
    expect(readCell({}, "__proto__")).toBe("");
    expect(readCell({}, "toString")).toBe("");
  });
});

describe("vocabulary resolvers", () => {
  const m = (patch: Partial<ImportMapping["transforms"]>): ImportMapping => ({ ...defaultMapping(), transforms: { ...defaultMapping().transforms, ...patch } });

  it("sexResolver translates case-insensitively and passes unknown words through", () => {
    const toSex = sexResolver(m({ sexValues: { Truie: "FEMALE" } }));
    expect(toSex("TRUIE")).toBe("FEMALE");
    expect(toSex(" truie ")).toBe("FEMALE");
    expect(toSex("M")).toBe("M");
  });

  it("castratedResolver knows the built-ins, the farm's words, and says undefined otherwise", () => {
    const toCastrated = castratedResolver(m({ castratedValues: { oui: true, Non: false } }));
    for (const t of ["yes", "TRUE", "1", "y", "Oui"]) expect(toCastrated(t)).toBe(true);
    for (const t of ["no", "false", "0", "N", "non"]) expect(toCastrated(t)).toBe(false);
    expect(toCastrated("peut-être")).toBeUndefined();
    expect(toCastrated("constructor")).toBeUndefined();
  });
});

describe("applyMapping", () => {
  const french: ImportMapping = {
    version: 1,
    fields: {
      tagId: { source: "Numéro" },
      breed: { source: "Race" },
      sex: { source: "Sexe" },
      dateOfBirth: { source: "Naissance" },
      weightKg: { source: "Poids" },
      motherTagId: { source: "Mère" },
      castrated: { source: "Castré" },
      notes: { source: "Remarques" },
    },
    transforms: {
      sexValues: { Truie: "FEMALE", Verrat: "MALE" },
      dateFormat: "dd/MM/yyyy",
      dateFormatConfirmed: true,
      weightUnit: "lb",
      numberFormat: "eu",
      numberFormatConfirmed: true,
      castratedValues: { oui: true, non: false },
    },
  };

  it("translates a French farm's columns, vocabulary, date format and units", () => {
    const { rows, issues } = applyMapping(
      [{ Numéro: "P1", Race: "Landrace", Sexe: "truie", Naissance: "15/01/2026", Poids: "100", Mère: "P0", Castré: "", Remarques: "ok" },
       { Numéro: "P2", Race: "Duroc", Sexe: "VERRAT", Naissance: "03/02/2026", Poids: "", Mère: "", Castré: "Oui", Remarques: "" }],
      french,
    );
    expect(rows[0]).toMatchObject({ tagId: "P1", sex: "FEMALE", dateOfBirth: "2026-01-15", weightKg: "45.36", motherTagId: "P0", notes: "ok" });
    expect(rows[1]).toMatchObject({ tagId: "P2", sex: "MALE", dateOfBirth: "2026-02-03", castrated: "yes" });
    expect(issues.flat()).toEqual([]);
  });

  describe("castrated", () => {
    const castratedRow = (Sexe: string, Castré: string) =>
      applyMapping([{ Numéro: "P", Race: "x", Sexe, Naissance: "15/01/2026", Castré }], french);

    it("uses the farm's own words, including ones the old yes/no list missed", () => {
      expect(castratedRow("Verrat", "oui").rows[0].castrated).toBe("yes");
      expect(castratedRow("Verrat", "non").rows[0].castrated).toBe("no");
    });

    it("reports an unrecognised value on a male instead of silently importing 'not castrated'", () => {
      const { rows, issues } = castratedRow("Verrat", "peut-être");
      expect(rows[0].castrated).toBe("");
      expect(issues[0]).toEqual([{ field: "castrated", message: '"peut-être" is not yes or no' }]);
    });

    it("ignores the column for sows, which are routinely marked n/a", () => {
      const { rows, issues } = castratedRow("Truie", "n/a");
      expect(rows[0].castrated).toBe("");
      expect(issues[0]).toEqual([]);
    });
  });

  describe("weights", () => {
    const kg = (cell: string, transforms: Partial<ImportMapping["transforms"]> = {}) =>
      applyMapping([{ tagId: "A", weightKg: cell }], { ...defaultMapping(), transforms: { ...defaultMapping().transforms, ...transforms } });

    it("reads English numbers by default, with thousands commas", () => {
      expect(kg("85.5").rows[0].weightKg).toBe("85.5");
      expect(kg("1,020.5").rows[0].weightKg).toBe("1020.5");
    });

    it("reads a decimal comma only when the mapping says the file is European", () => {
      expect(kg("180,5", { numberFormat: "eu" }).rows[0].weightKg).toBe("180.5");
      const en = kg("180,5");
      expect(en.rows[0].weightKg).toBe("");
      expect(en.issues[0]).toEqual([{ field: "weightKg", message: '"180,5" is not a weight' }]);
    });

    it("treats n/a, - and friends as 'not weighed', not as an error", () => {
      for (const cell of ["n/a", "-", "unknown"]) {
        const { rows, issues } = kg(cell);
        expect(rows[0].weightKg).toBe("");
        expect(issues[0]).toEqual([]);
      }
    });
  });

  it("falls back to the field default when the column is absent or the cell blank", () => {
    const m = { ...defaultMapping(), fields: { ...defaultMapping().fields, breed: { source: null, default: "Mixed Breed" } } };
    const { rows } = applyMapping([{ tagId: "A", sex: "F", dateOfBirth: "2026-01-01" }], m);
    expect(rows[0].breed).toBe("Mixed Breed");
  });

  it("passes standard values straight through when no vocabulary is configured", () => {
    const { rows, issues } = applyMapping([{ tagId: "A", breed: "Duroc", sex: "M", dateOfBirth: "2026-01-01", castrated: "yes" }], defaultMapping());
    expect(rows[0]).toMatchObject({ sex: "M", castrated: "yes" });
    expect(issues[0]).toEqual([]);
  });

  it("reports unreadable dates and weights as issues, blanking the value", () => {
    const { rows, issues } = applyMapping([{ tagId: "A", breed: "x", sex: "F", dateOfBirth: "31/02/2026", weightKg: "heavy" }], { ...french, fields: { ...french.fields, tagId: { source: "tagId" }, breed: { source: "breed" }, sex: { source: "sex" }, dateOfBirth: { source: "dateOfBirth" }, weightKg: { source: "weightKg" } } });
    expect(rows[0].dateOfBirth).toBe("");
    expect(rows[0].weightKg).toBe("");
    expect(issues[0].map((i) => i.field)).toEqual(["dateOfBirth", "weightKg"]);
  });

  it("shows ONE clear error per bad date once validated, not the schema's generic one too", () => {
    const { rows, issues } = applyMapping(
      [{ tagId: "A", breed: "Duroc", sex: "F", dateOfBirth: "31/02/2026" }],
      { ...defaultMapping(), transforms: { ...defaultMapping().transforms, dateFormat: "dd/MM/yyyy" } },
    );
    const { results } = validateImportRows(rows, new Map(), issues);
    const errs = results[0].errors.filter((e) => e.startsWith("dateOfBirth"));
    expect(errs).toEqual(['dateOfBirth: "31/02/2026" is not a valid dd/MM/yyyy date']);
  });

  it("survives a mapping whose source is an inherited name like constructor", () => {
    const m = { ...defaultMapping(), fields: { ...defaultMapping().fields, tagId: { source: "constructor" }, sex: { source: "__proto__" } } };
    const { rows } = applyMapping([{ tagId: "A" }], m);
    expect(rows[0]).toMatchObject({ tagId: "", sex: "" });
  });

  it("ignores columns that are not mapped and tolerates missing cells", () => {
    const { rows } = applyMapping([{ other: "x" }], defaultMapping());
    expect(rows[0]).toMatchObject({ tagId: "", breed: "", sex: "", dateOfBirth: "" });
  });
});
