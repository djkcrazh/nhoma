// =============================================================================
// columns.test.ts: tests for the constants and limits in columns.ts.
//   Checks: the template CSV starts with all nine columns in order, and the
//   database time budget grows with row count but never leaves 10 s .. 60 s.
//   Run just this file:  npx vitest run src/lib/import/columns.test.ts
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
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_CSV,
  MAX_IMPORT_ROWS,
  importTxTimeoutMs,
} from "./columns";

describe("importTxTimeoutMs", () => {
  it("never drops below the 10s floor and grows with the row count", () => {
    expect(importTxTimeoutMs(0)).toBe(10_000);
    expect(importTxTimeoutMs(400)).toBe(20_000);
  });

  it("caps at 60s, which is reached at the row limit", () => {
    expect(importTxTimeoutMs(MAX_IMPORT_ROWS)).toBe(60_000);
    expect(importTxTimeoutMs(1_000_000)).toBe(60_000);
  });
});

describe("template", () => {
  it("starts with every import column in order", () => {
    expect(IMPORT_TEMPLATE_CSV.split("\n")[0]).toBe(IMPORT_COLUMNS.join(","));
  });
});
