// =============================================================================
// columns.ts: the "constants" file for the CSV import.
//
// READING GUIDE FOR PYTHON PEOPLE
//   * This file has no logic to speak of: it is the equivalent of a Python
//     module full of UPPER_CASE constants plus one tiny helper function.
//   * `export` means "importable from other files" (everything in a Python
//     module is importable; in TypeScript you opt in with `export`).
//   * See README.md in this folder for the full TypeScript-to-Python cheat sheet.
// =============================================================================

/**
 * Single source of truth for the default pig-import template. The modal's help
 * text, the downloadable template, header checks and the server-side row type
 * all derive from here, so adding a column is a one-file change.
 */
// The nine columns of Nhoma's own CSV template, in order.
//
// `as const` freezes the array AND tells TypeScript the exact string values.
// Python: roughly `IMPORT_COLUMNS: tuple[Literal["tagId", "breed", ...], ...] = ("tagId", "breed", ...)`
// i.e. an immutable tuple whose members are known literal strings.
export const IMPORT_COLUMNS = [
  "tagId",
  "breed",
  "sex",
  "dateOfBirth",
  "weightKg",
  "motherTagId",
  "fatherTagId",
  "castrated",
  "notes",
] as const;

// A *type* (exists only while type-checking, vanishes at runtime; Python has no
// exact equivalent, the closest is a `Literal[...]` alias).
// `(typeof IMPORT_COLUMNS)[number]` reads: "the type of any element of that array",
// which is the union "tagId" | "breed" | "sex" | ...
// Python: `ImportColumn = Literal["tagId", "breed", "sex", ...]`
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

// Which of those columns every pig MUST have (a pig with no ID, breed, sex or birth
// date is rejected). `readonly ImportColumn[]` = a list you are not allowed to modify.
// Python: `REQUIRED_IMPORT_COLUMNS: Sequence[ImportColumn] = ("tagId", "breed", "sex", "dateOfBirth")`
export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["tagId", "breed", "sex", "dateOfBirth"];

/** Rows per import. Keeps the single DB transaction inside its timeout. */
// A hard cap: files longer than 2000 data rows are refused with a clear message.
export const MAX_IMPORT_ROWS = 2000;

/**
 * Budget for the import's interactive transaction. Prisma's 5s default is too
 * short for a few hundred rows; each row costs up to three queries, so scale
 * with the row count and cap it well under typical serverless limits.
 */
// How long (in milliseconds) the database may take to write an import before we give up.
// Formula: 10 seconds + 25 ms per row, never more than 60 seconds.
// Python: `return min(60_000, 10_000 + row_count * 25)`   (underscores in numbers work in Python too)
// `rowCount: number` is a type annotation (like `row_count: int`); `: number` after the
// parentheses is the return type.
export function importTxTimeoutMs(rowCount: number): number {
  return Math.min(60_000, 10_000 + rowCount * 25);
}

/**
 * Server Actions reject request bodies over 1MB by default (see
 * node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md).
 * Rows travel as the action payload, so check before sending and leave headroom
 * for the framework's own encoding overhead.
 */
// Next.js refuses requests bigger than 1 MB; we stop at 900,000 bytes to leave headroom.
export const MAX_IMPORT_PAYLOAD_BYTES = 900_000;

// The little example file offered on the "Download template" link.
// Backticks (`...`) are TypeScript's f-strings: `${expr}` is Python's `{expr}`.
// Python: f"{','.join(IMPORT_COLUMNS)}\n" + "PIG-201,Large White,...\n"
// `.join(",")` is called ON the array here; in Python it is called on the separator.
export const IMPORT_TEMPLATE_CSV =
  `${IMPORT_COLUMNS.join(",")}\n` + "PIG-201,Large White,FEMALE,2026-05-01,12.5,PIG-003,PIG-001,,healthy piglet\n";
