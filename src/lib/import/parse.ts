/**
 * Papa.parse(header: true) is lenient in ways the server's strict record schema
 * is not: a row with more cells than headers gets an extra `__parsed_extra`
 * array. Reduce parsed rows to plain header -> string records before they are
 * sent, so one ragged row never rejects the whole import.
 */
export function cleanRecords(rows: Record<string, unknown>[]): Record<string, string>[] {
  return rows.map((row) => {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "__parsed_extra") continue;
      clean[key] = typeof value === "string" ? value : "";
    }
    return clean;
  });
}
