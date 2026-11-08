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
