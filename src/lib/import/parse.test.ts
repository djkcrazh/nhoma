// =============================================================================
// parse.test.ts: tests for cleanRecords (parse.ts): the tidy-up of parsed CSV rows.
//   Checks that the parser's "__parsed_extra" key (extra cells on a long row) is dropped and
//   that every value becomes a string.
//   Run just this file:  npx vitest run src/lib/import/parse.test.ts
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
import Papa from "papaparse";
import { cleanRecords } from "./parse";

describe("cleanRecords", () => {
  it("keeps string cells as they are", () => {
    expect(cleanRecords([{ a: "1", b: "" }])).toEqual([{ a: "1", b: "" }]);
  });

  it("drops Papa's __parsed_extra array from ragged rows", () => {
    const parsed = Papa.parse<Record<string, unknown>>("a,b\n1,2\n3,4,5,6\n", { header: true, skipEmptyLines: "greedy" });
    expect(parsed.data[1]).toHaveProperty("__parsed_extra"); // the trap
    expect(cleanRecords(parsed.data)).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("turns non-string values into blanks so the server's strict schema accepts the row", () => {
    expect(cleanRecords([{ a: undefined, b: 5, c: null }])).toEqual([{ a: "", b: "", c: "" }]);
  });
});
