/**
 * eval-bridge.ts: the ONE doorway between the Python evaluations and the TypeScript importer.
 *
 * HOW IT WORKS (for Python readers)
 *   Python starts this script as a subprocess, writes ONE json document to its stdin, and reads
 *   ONE json document from its stdout:
 *
 *       stdin :  {"ops": [{"id": "case-1", "op": "suggest", "headers": [...], "records": [...]}, ...]}
 *       stdout:  {"results": {"case-1": {...}, ...}}
 *
 *   Each "op" is one call to a real importer function. They are batched (many cases per run)
 *   because starting Node costs about a second.
 *
 *   The evaluations never reimplement parsing: they call the SAME functions the browser screens
 *   and the server use, so a score here is a score for the real importer.
 *
 * OPS
 *   read     {bytesHex}               bytes -> decoded text -> parsed rows (exactly what the upload modal does)
 *   default  {}                       the "identity" mapping (file already uses Nhoma's column names)
 *   suggest  {headers, records}       the rule-based guesser (the baseline an AI must beat)
 *   check    {mapping, records}       is this mapping valid, and what must a person still settle?
 *   apply    {mapping, records}       translate the rows with a mapping and validate them (a dry run, no database)
 *
 * No database, no network, no clock-dependent writes. Run by hand to try it:
 *   echo '{"ops":[{"id":"x","op":"default"}]}' | npx tsx scripts/eval-bridge.ts
 */
import { readFileSync } from "node:fs"; // read all of stdin (file descriptor 0)
import Papa from "papaparse"; // the same CSV parser the browser upload uses
import { decodeCsvBytes } from "@/lib/import/decode";
import { cleanRecords } from "@/lib/import/parse";
import { applyMapping, defaultMapping, importMappingSchema } from "@/lib/import/mapping";
import { checkMapping, mappingWarnings, suggestMapping } from "@/lib/import/suggest";
import { validateImportRows } from "@/lib/import/validate";

// One row of the farm's file: header text -> cell text. Python: dict[str, str]
type Records = Record<string, string>[];

// The shape of an incoming request. A "discriminated union": the `op` field says which variant it is.
// Python analogue: a Union of TypedDicts keyed by a Literal.
type Op =
  | { id: string; op: "read"; bytesHex: string }
  | { id: string; op: "default" }
  | { id: string; op: "suggest"; headers: string[]; records: Records }
  | { id: string; op: "check"; mapping: unknown; records: Records; headers?: string[] }
  | { id: string; op: "apply"; mapping: unknown; records: Records };

// Run one op and return a plain JSON-able object. Mirrors, step for step, what the app does.
function run(op: Op): unknown {
  switch (op.op) {
    case "read": {
      // 1. bytes -> text. Python: data = bytes.fromhex(hex); text = decode(data)
      const decoded = decodeCsvBytes(Uint8Array.from(Buffer.from(op.bytesHex, "hex")));
      // 2. text -> list of dicts, the same options the upload modal passes to PapaParse.
      const parsed = Papa.parse<Record<string, unknown>>(decoded.text, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim(),
      });
      return {
        encoding: decoded.encoding,
        headers: (parsed.meta.fields ?? []).filter(Boolean),
        records: cleanRecords(parsed.data), // drops the parser's "extra cells" bookkeeping key
        quoteErrors: parsed.errors.filter((e) => e.type === "Quotes").length,
      };
    }
    case "default":
      return { mapping: defaultMapping() };
    case "suggest":
      return suggestMapping(op.headers, op.records);
    case "check": {
      // A proposed mapping may be malformed (a model could emit anything), so validate its SHAPE first.
      const shape = importMappingSchema.safeParse(op.mapping);
      if (!shape.success) return { schemaOk: false, schemaErrors: shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
      return {
        schemaOk: true,
        problems: checkMapping(shape.data, op.records, op.headers), // BLOCKING: a person must settle these
        warnings: mappingWarnings(shape.data, op.records), // a few stray cells: listed row by row later
      };
    }
    case "apply": {
      const shape = importMappingSchema.safeParse(op.mapping);
      if (!shape.success) return { schemaOk: false, schemaErrors: shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
      const mapped = applyMapping(op.records, shape.data); // farm's rows -> Nhoma's standard rows
      // Validate against an EMPTY farm (no existing pigs), exactly like a first import.
      const validated = validateImportRows(mapped.rows, new Map(), mapped.issues);
      return {
        schemaOk: true,
        rows: mapped.rows,
        issues: mapped.issues,
        verdicts: validated.results.map((r) => ({ ok: r.ok, errors: r.errors })),
        validCount: validated.valid.length,
      };
    }
  }
}

// ---- main: read the batch, run every op, print the results ----
const input = JSON.parse(readFileSync(0, "utf8")) as { ops: Op[] };
const results: Record<string, unknown> = {};
for (const op of input.ops) {
  try {
    results[op.id] = run(op);
  } catch (e) {
    // One bad case must not sink the whole batch: record the error and keep going.
    results[op.id] = { error: e instanceof Error ? e.message : String(e) };
  }
}
process.stdout.write(JSON.stringify({ results }));
