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
