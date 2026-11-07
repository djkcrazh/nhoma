import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_CSV,
  MAX_IMPORT_ROWS,
  canonicalizeHeader,
  checkHeaders,
  importTxTimeoutMs,
} from "./columns";

describe("canonicalizeHeader", () => {
  it("maps case, spacing and separator variants to the canonical name", () => {
    for (const h of ["TagID", "tag_id", "Tag ID", " TAG-ID ", "﻿tagId"]) expect(canonicalizeHeader(h)).toBe("tagId");
    expect(canonicalizeHeader("Date of Birth")).toBe("dateOfBirth");
    expect(canonicalizeHeader("WEIGHTKG")).toBe("weightKg");
  });

  it("returns unknown headers trimmed and unchanged", () => {
    expect(canonicalizeHeader("  Genre ")).toBe("Genre");
    expect(canonicalizeHeader("品种")).toBe("品种");
  });
});

describe("checkHeaders", () => {
  it("lists missing required columns", () => {
    expect(checkHeaders(["tagId", "notes"]).missing).toEqual(["breed", "sex", "dateOfBirth"]);
  });

  it("passes when every required column is present and reports ignored extras", () => {
    const res = checkHeaders(["tagId", "breed", "sex", "dateOfBirth", "Color", ""]);
    expect(res.missing).toEqual([]);
    expect(res.ignored).toEqual(["Color"]);
  });
});

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
