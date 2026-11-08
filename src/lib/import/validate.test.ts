import { describe, expect, it } from "vitest";
import { validateImportRows, normalizeImportRow, type ExistingPig, type ImportRow } from "./validate";

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  tagId: "PIG-1",
  breed: "Large White",
  sex: "FEMALE",
  dateOfBirth: "2020-01-15",
  ...over,
});

const farm = (entries: Record<string, Partial<ExistingPig>> = {}) =>
  new Map<string, ExistingPig>(
    Object.entries(entries).map(([tag, p]) => [tag.toLowerCase(), { id: `id-${tag}`, sex: "FEMALE", deleted: false, ...p }]),
  );

const errorsFor = (rows: ImportRow[], existing = farm()) => validateImportRows(rows, existing).results.map((r) => r.errors);

describe("normalizeImportRow", () => {
  it("expands M/F shorthand case-insensitively and trims", () => {
    expect(normalizeImportRow(row({ sex: " m " })).sex).toBe("MALE");
    expect(normalizeImportRow(row({ sex: "f" })).sex).toBe("FEMALE");
    expect(normalizeImportRow(row({ sex: "male" })).sex).toBe("MALE");
  });

  it("parses castrated tokens and treats anything else as false", () => {
    for (const t of ["yes", "TRUE", "1", "Y"]) expect(normalizeImportRow(row({ castrated: t })).castrated).toBe(true);
    for (const t of ["no", "", "oui", undefined]) expect(normalizeImportRow(row({ castrated: t })).castrated).toBe(false);
  });

  it("turns blank optionals into undefined", () => {
    const n = normalizeImportRow(row({ weightKg: "  ", motherTagId: "", notes: " " }));
    expect(n.weightKg).toBeUndefined();
    expect(n.motherTagId).toBeUndefined();
    expect(n.notes).toBeUndefined();
  });
});

describe("validateImportRows", () => {
  it("numbers rows from 2 because the header is row 1", () => {
    const { results } = validateImportRows([row({ tagId: "A" }), row({ tagId: "B" })], farm());
    expect(results.map((r) => r.row)).toEqual([2, 3]);
  });

  it("accepts a clean row", () => {
    const { results, valid } = validateImportRows([row({ weightKg: "12.5" })], farm());
    expect(results[0].ok).toBe(true);
    expect(valid).toHaveLength(1);
  });

  it("reports missing required fields", () => {
    const [errs] = errorsFor([row({ tagId: "", breed: "", dateOfBirth: "" })]);
    expect(errs.join(" | ")).toMatch(/tagId: Tag ID is required/);
    expect(errs.join(" | ")).toMatch(/breed: Breed is required/);
    expect(errs.some((e) => e.startsWith("dateOfBirth"))).toBe(true);
  });

  it("rejects a bad sex, future date and non-positive weight", () => {
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect(errorsFor([row({ sex: "boar" })])[0].some((e) => e.startsWith("sex"))).toBe(true);
    expect(errorsFor([row({ dateOfBirth: future })])[0].join()).toMatch(/future/);
    expect(errorsFor([row({ weightKg: "-3" })])[0].join()).toMatch(/Weight must be positive/);
  });

  it("silently drops castrated on females instead of failing them", () => {
    const { results } = validateImportRows([row({ sex: "FEMALE", castrated: "yes" })], farm());
    expect(results[0].ok).toBe(true);
  });

  it("flags tags that already exist, case-insensitively", () => {
    const [errs] = errorsFor([row({ tagId: "pig-1" })], farm({ "PIG-1": {} }));
    expect(errs).toContain('Tag ID "pig-1" already exists on the farm');
  });

  it("explains when the tag belongs to a removed pig", () => {
    const [errs] = errorsFor([row({ tagId: "PIG-1" })], farm({ "PIG-1": { deleted: true } }));
    expect(errs[0]).toMatch(/belongs to a removed pig/);
  });

  it("flags duplicates inside the file on every occurrence after the first", () => {
    const results = validateImportRows([row({ tagId: "A" }), row({ tagId: "a" })], farm()).results;
    expect(results[0].ok).toBe(true);
    expect(results[1].errors).toContain("Duplicate tag ID within file (also row 2)");
  });

  describe("parents", () => {
    it("resolves a parent that appears AFTER its child in the file", () => {
      const { results } = validateImportRows(
        [row({ tagId: "KID", motherTagId: "MOM" }), row({ tagId: "MOM", sex: "FEMALE" })],
        farm(),
      );
      expect(results.map((r) => r.ok)).toEqual([true, true]);
    });

    it("resolves parents already on the farm", () => {
      const { results } = validateImportRows([row({ fatherTagId: "BOAR" })], farm({ BOAR: { sex: "MALE" } }));
      expect(results[0].ok).toBe(true);
    });

    it("rejects an unknown parent", () => {
      expect(errorsFor([row({ motherTagId: "NOPE" })])[0]).toContain('Mother "NOPE" not found on farm or in file');
    });

    it("rejects a parent of the wrong sex", () => {
      expect(errorsFor([row({ motherTagId: "BOAR" })], farm({ BOAR: { sex: "MALE" } }))[0]).toContain('Mother "BOAR" is not female');
      expect(errorsFor([row({ fatherTagId: "SOW" })], farm({ SOW: { sex: "FEMALE" } }))[0]).toContain('Father "SOW" is not male');
    });

    it("rejects a pig that is its own parent", () => {
      expect(errorsFor([row({ tagId: "A", motherTagId: "a" })])[0]).toContain("Mother cannot be the pig itself");
    });

    it("rejects a parent that was removed from the farm", () => {
      const [errs] = errorsFor([row({ motherTagId: "OLD" })], farm({ OLD: { deleted: true } }));
      expect(errs).toContain('Mother "OLD" was removed from the farm');
    });

    it("sinks a whole in-file lineage when the grandparent is invalid", () => {
      const rows = [
        row({ tagId: "GRAND", breed: "" }), // invalid
        row({ tagId: "PARENT", motherTagId: "GRAND" }),
        row({ tagId: "CHILD", motherTagId: "PARENT" }),
      ];
      const { results, valid } = validateImportRows(rows, farm());
      expect(results.map((r) => r.ok)).toEqual([false, false, false]);
      expect(results[1].errors).toContain('Mother "GRAND" (row 2) failed validation');
      expect(results[2].errors).toContain('Mother "PARENT" (row 3) failed validation');
      expect(valid).toHaveLength(0);
    });

    it("does not sink a child whose parent is valid", () => {
      const { results } = validateImportRows([row({ tagId: "MOM" }), row({ tagId: "KID", motherTagId: "MOM" })], farm());
      expect(results.every((r) => r.ok)).toBe(true);
    });
  });
});
