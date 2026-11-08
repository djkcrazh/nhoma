import { describe, expect, it } from "vitest";
import { checkMapping, normalizeKey, suggestMapping, type Unresolved } from "./suggest";
import { applyMapping, importMappingSchema } from "./mapping";
import { validateImportRows } from "./validate";
import { IMPORT_COLUMNS } from "./columns";

const sources = (headers: string[], rows: Record<string, string>[] = []) => {
  const { mapping, unresolved } = suggestMapping(headers, rows);
  return { fields: Object.fromEntries(Object.entries(mapping.fields).map(([k, v]) => [k, v?.source])), mapping, unresolved };
};
const kinds = (u: Unresolved[]) => u.map((x) => x.kind);

describe("normalizeKey", () => {
  it("strips accents, case and separators", () => {
    expect(normalizeKey("Né le")).toBe("nele");
    expect(normalizeKey("Date_of Birth")).toBe("dateofbirth");
    expect(normalizeKey("Poids (kg)")).toBe("poidskg");
    expect(normalizeKey("出生日期")).toBe("出生日期");
  });
});

describe("suggestMapping: columns", () => {
  it("is the identity for the default template", () => {
    const rows = [{ tagId: "A", breed: "Duroc", sex: "FEMALE", dateOfBirth: "2026-01-01" }];
    const s = sources([...IMPORT_COLUMNS], rows);
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
  const sexRows = (...vals: string[]) => vals.map((sex) => ({ tagId: "A", breed: "x", sex, dateOfBirth: "2026-01-01" }));

  it("translates the farm's words in four languages", () => {
    const rows = sexRows("Truie", "Verrat", "Hembra", "Macho", "母", "公", "Sow", "Boar", "FEMALE");
    const { mapping, unresolved } = suggestMapping(["tagId", "breed", "sex", "dateOfBirth"], rows);
    expect(mapping.transforms.sexValues).toMatchObject({ Truie: "FEMALE", Verrat: "MALE", Hembra: "FEMALE", Macho: "MALE", 母: "FEMALE", 公: "MALE", Sow: "FEMALE", Boar: "MALE" });
    expect(kinds(unresolved)).not.toContain("unknownSexValues");
  });

  it("surfaces words it does not know instead of guessing", () => {
    const { unresolved } = suggestMapping(["tagId", "breed", "sex", "dateOfBirth"], sexRows("Sow", "Weaner", "???"));
    const u = unresolved.find((x) => x.kind === "unknownSexValues") as { values: string[] };
    expect(u.values.sort()).toEqual(["???", "Weaner"]);
  });
});

describe("suggestMapping: hostile or odd cell values", () => {
  const sexCells = (...vals: string[]) => vals.map((sex) => ({ tagId: "A", breed: "x", sex, dateOfBirth: "2026-01-01" }));

  it("does not treat Object.prototype names as known sex words", () => {
    const { mapping, unresolved } = suggestMapping(["tagId", "breed", "sex", "dateOfBirth"], sexCells("constructor", "toString", "__proto__", "Sow"));
    const u = unresolved.find((x) => x.kind === "unknownSexValues") as { values: string[] };
    expect(u.values.sort()).toEqual(["__proto__", "constructor", "toString"]);
    expect(Object.keys(mapping.transforms.sexValues)).toEqual(["Sow"]);
    expect(typeof mapping.transforms.sexValues.constructor).toBe("function"); // inherited, not an own entry
    expect(Object.hasOwn(mapping.transforms.sexValues, "constructor")).toBe(false);
  });

  it("flags prototype names in checkMapping too", () => {
    const { mapping } = suggestMapping(["tagId", "breed", "sex", "dateOfBirth"], sexCells("Sow"));
    expect(checkMapping(mapping, sexCells("constructor"))).toEqual([{ kind: "unknownSexValues", values: ["constructor"] }]);
  });

  it("copes with a header called constructor", () => {
    const rows = [{ constructor: "x", tagId: "A", breed: "x", sex: "F", dateOfBirth: "2026-01-01" }];
    expect(() => suggestMapping(["constructor", "tagId", "breed", "sex", "dateOfBirth"], rows)).not.toThrow();
  });
});

describe("suggestMapping: dates", () => {
  const withDates = (...dateOfBirth: string[]) => suggestMapping(["tagId", "breed", "sex", "dateOfBirth"], dateOfBirth.map((d) => ({ tagId: "A", breed: "x", sex: "F", dateOfBirth: d })));

  it("detects ISO, Chinese and dotted formats", () => {
    expect(withDates("2026-01-15", "2026-02-01").mapping.transforms.dateFormat).toBe("iso");
    expect(withDates("2026年1月15日", "2026年2月1日").mapping.transforms.dateFormat).toBe("yyyy年M月d日");
    expect(withDates("15.01.2026", "01.02.2026").mapping.transforms.dateFormat).toBe("dd.MM.yyyy");
  });

  it("uses a day above 12 to break the dd/MM vs MM/dd tie", () => {
    expect(withDates("15/01/2026", "03/04/2026").mapping.transforms.dateFormat).toBe("dd/MM/yyyy");
    expect(withDates("01/15/2026", "03/04/2026").mapping.transforms.dateFormat).toBe("MM/dd/yyyy");
  });

  describe("when day and month order cannot be told apart", () => {
    const BOTH = ["dd/MM/yyyy", "MM/dd/yyyy"];
    const ambiguous = (dates: string[], now: string) =>
      suggestMapping(["tagId", "breed", "sex", "dateOfBirth"], dates.map((d) => ({ tagId: "A", breed: "x", sex: "F", dateOfBirth: d })), { now: new Date(now) });

    it("asks the user instead of guessing from habit", () => {
      const s = ambiguous(["03/04/2024", "05/06/2024"], "2026-11-08");
      expect(s.unresolved).toContainEqual({ kind: "ambiguousDate", candidates: BOTH });
    });

    it("pre-selects the one reading that keeps every date out of the future", () => {
      // 10/02/2026: day-first is 10 Feb (past), month-first is 2 Oct (future on 1 May 2026)
      const s = ambiguous(["10/02/2026"], "2026-05-01");
      expect(s.mapping.transforms.dateFormat).toBe("dd/MM/yyyy");
      expect(kinds(s.unresolved)).not.toContain("ambiguousDate");
      // and the mirror image
      expect(ambiguous(["02/10/2026"], "2026-05-01").mapping.transforms.dateFormat).toBe("MM/dd/yyyy");
    });

    it("still asks when both readings are plausible or both are in the future", () => {
      expect(kinds(ambiguous(["10/02/2026"], "2026-12-31").unresolved)).toContain("ambiguousDate");
      expect(kinds(ambiguous(["10/11/2030"], "2026-05-01").unresolved)).toContain("ambiguousDate");
    });
  });

  it("reports dates that no supported format can read", () => {
    expect(kinds(withDates("15/01/2026", "2026-01-15").unresolved)).toContain("unparseableDates");
    expect(kinds(withDates("yesterday").unresolved)).toContain("unparseableDates");
  });
});

describe("checkMapping", () => {
  const headers = ["Numéro", "Race", "Sexe", "Naissance"];
  const records = [
    { Numéro: "T-1", Race: "Landrace", Sexe: "Truie", Naissance: "15/01/2024" },
    { Numéro: "V-1", Race: "Duroc", Sexe: "Verrat", Naissance: "20/03/2024" },
  ];

  it("is clean for a complete, well-formed mapping", () => {
    const { mapping } = suggestMapping(headers, records);
    expect(checkMapping(mapping, records)).toEqual([]);
  });

  it("flags a required field that was un-mapped by hand, but accepts a breed default", () => {
    const { mapping } = suggestMapping(headers, records);
    mapping.fields.breed = { source: null };
    expect(checkMapping(mapping, records)).toEqual([{ kind: "missingField", field: "breed" }]);
    mapping.fields.breed = { source: null, default: "Mixed Breed" };
    expect(checkMapping(mapping, records)).toEqual([]);
    mapping.fields.sex = { source: null, default: "F" }; // sex can never be defaulted
    expect(checkMapping(mapping, records)).toEqual([{ kind: "missingField", field: "sex" }]);
  });

  it("flags sex values that have no translation, case-insensitively", () => {
    const { mapping } = suggestMapping(headers, records);
    delete mapping.transforms.sexValues.Truie;
    expect(checkMapping(mapping, records)).toEqual([{ kind: "unknownSexValues", values: ["Truie"] }]);
    mapping.transforms.sexValues.truie = "FEMALE";
    expect(checkMapping(mapping, records)).toEqual([]);
  });

  it("flags dates the chosen format cannot read, with a count and example", () => {
    const { mapping } = suggestMapping(headers, records);
    mapping.transforms.dateFormat = "iso";
    expect(checkMapping(mapping, records)).toEqual([{ kind: "unreadableDates", count: 2, example: "15/01/2024" }]);
  });
});

describe("suggest -> apply -> validate (a French farm, no hand-tuning)", () => {
  it("imports a French file as-is", () => {
    const headers = ["Numéro", "Race", "Sexe", "Date de naissance", "Poids (kg)", "Mère", "Castré"];
    const records = [
      { Numéro: "T-1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "15/01/2024", "Poids (kg)": "180,5", Mère: "", Castré: "" },
      { Numéro: "V-1", Race: "Duroc", Sexe: "Verrat", "Date de naissance": "20/03/2024", "Poids (kg)": "210", Mère: "", Castré: "non" },
      { Numéro: "P-1", Race: "Landrace", Sexe: "Truie", "Date de naissance": "25/06/2025", "Poids (kg)": "12,5", Mère: "T-1", Castré: "" },
    ];
    const { mapping, unresolved } = suggestMapping(headers, records);
    expect(unresolved).toEqual([]);
    const { rows, issues } = applyMapping(records, mapping);
    const { results, valid } = validateImportRows(rows, new Map(), issues);
    expect(results.map((r) => r.errors)).toEqual([[], [], []]);
    expect(valid).toHaveLength(3);
    expect(rows[2]).toMatchObject({ tagId: "P-1", sex: "FEMALE", dateOfBirth: "2025-06-25", weightKg: "12.5", motherTagId: "T-1" });
  });
});
