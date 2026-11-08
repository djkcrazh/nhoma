/**
 * Single source of truth for the default pig-import template. The modal's help
 * text, the downloadable template, header checks and the server-side row type
 * all derive from here, so adding a column is a one-file change.
 */
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

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["tagId", "breed", "sex", "dateOfBirth"];

/** Rows per import. Keeps the single DB transaction inside its timeout. */
export const MAX_IMPORT_ROWS = 2000;

/**
 * Budget for the import's interactive transaction. Prisma's 5s default is too
 * short for a few hundred rows; each row costs up to three queries, so scale
 * with the row count and cap it well under typical serverless limits.
 */
export function importTxTimeoutMs(rowCount: number): number {
  return Math.min(60_000, 10_000 + rowCount * 25);
}

/**
 * Server Actions reject request bodies over 1MB by default (see
 * node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md).
 * Rows travel as the action payload, so check before sending and leave headroom
 * for the framework's own encoding overhead.
 */
export const MAX_IMPORT_PAYLOAD_BYTES = 900_000;

export const IMPORT_TEMPLATE_CSV =
  `${IMPORT_COLUMNS.join(",")}\n` + "PIG-201,Large White,FEMALE,2026-05-01,12.5,PIG-003,PIG-001,,healthy piglet\n";
