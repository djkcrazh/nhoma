// =============================================================================
// parse.ts: one tiny helper that tidies rows coming out of the CSV parser.
//
// Context: the browser uses a library called PapaParse to turn CSV text into a
// list of rows. Python equivalent: `csv.DictReader(...)` giving one dict per row.
// =============================================================================

/**
 * Papa.parse(header: true) is lenient in ways the server's strict record schema
 * is not: a row with more cells than headers gets an extra `__parsed_extra`
 * array. Reduce parsed rows to plain header -> string records before they are
 * sent, so one ragged row never rejects the whole import.
 */
// Input : a list of dicts whose values could be anything.   `Record<string, unknown>` = `dict[str, Any]`
// Output: a list of dicts whose values are always strings.  `Record<string, string>`  = `dict[str, str]`
//
// Python version of the whole function:
//     def clean_records(rows):
//         out = []
//         for row in rows:
//             clean = {}
//             for key, value in row.items():
//                 if key == "__parsed_extra":      # the parser's name for "extra cells on a long row"
//                     continue
//                 clean[key] = value if isinstance(value, str) else ""
//             out.append(clean)
//         return out
export function cleanRecords(rows: Record<string, unknown>[]): Record<string, string>[] {
  // `.map(fn)` runs fn on every row and collects the results. Python: a list comprehension.
  // `(row) => { ... }` is an anonymous function (Python: `lambda`, but allowed to have many lines).
  return rows.map((row) => {
    const clean: Record<string, string> = {};
    // `Object.entries(row)` = `row.items()`. `for (const [key, value] of ...)` = `for key, value in ...`
    for (const [key, value] of Object.entries(row)) {
      if (key === "__parsed_extra") continue; // `continue` works exactly as in Python
      // `typeof value === "string"` = `isinstance(value, str)`.  `a ? b : c` = `b if a else c`
      clean[key] = typeof value === "string" ? value : "";
    }
    return clean;
  });
}
