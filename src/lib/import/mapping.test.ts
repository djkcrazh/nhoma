import { describe, expect, it } from "vitest";
import { applyMapping, defaultMapping, importMappingSchema, parseDate, parseWeight, readCell, type ImportMapping } from "./mapping";
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
  });
});

describe("parseDate", () => {
  it("parses each supported format to yyyy-MM-dd", () => {
    expect(parseDate("2026-05-01", "iso")).toBe("2026-05-01");
    expect(parseDate("2026-5-1T10:00:00Z", "iso")).toBe("2026-05-01");
    expect(parseDate("15/01/2026", "dd/MM/yyyy")).toBe("2026-01-15");
    expect(parseDate("01/15/2026", "MM/dd/yyyy")).toBe("2026-01-15");
    expect(parseDate("15.01.2026", "dd.MM.yyyy")).toBe("2026-01-15");
    expect(parseDate("2026/01/15", "yyyy/MM/dd")).toBe("2026-01-15");
    expect(parseDate("2026年1月5日", "yyyy年M月d日")).toBe("2026-01-05");
  });

  it("rejects impossible calendar dates and wrong shapes", () => {
    expect(parseDate("31/02/2026", "dd/MM/yyyy")).toBeNull();
    expect(parseDate("13/01/2026", "MM/dd/yyyy")).toBeNull(); // month 13
    expect(parseDate("15/01/26", "dd/MM/yyyy")).toBeNull(); // two-digit year unsupported
    expect(parseDate("hello", "iso")).toBeNull();
  });
});

describe("parseWeight", () => {
  it("handles decimal commas and units in the cell", () => {
    expect(parseWeight("12.5", "kg")).toBe("12.5");
    expect(parseWeight("12,5", "kg")).toBe("12.5");
    expect(parseWeight("12.5 kg", "lb")).toBe("12.5"); // unit in the cell wins
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
      weightUnit: "lb",
      castratedTrue: ["oui"],
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

  it("falls back to the field default when the column is absent or the cell blank", () => {
    const m = { ...defaultMapping(), fields: { ...defaultMapping().fields, breed: { source: null, default: "Mixed Breed" } } };
    const { rows } = applyMapping([{ tagId: "A", sex: "F", dateOfBirth: "2026-01-01" }], m);
    expect(rows[0].breed).toBe("Mixed Breed");
  });

  it("passes standard values straight through when no vocabulary is configured", () => {
    const { rows } = applyMapping([{ tagId: "A", breed: "Duroc", sex: "M", dateOfBirth: "2026-01-01", castrated: "banana" }], defaultMapping());
    expect(rows[0]).toMatchObject({ sex: "M", castrated: "no" });
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
