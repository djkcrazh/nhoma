"use client";

// =============================================================================
// ImportCsvModal.tsx: the "Import CSV" pop-up on the Pigs page (the screen a farmer sees).
//
// FOR PYTHON READERS (you can skip this file when working on the evaluations)
//   This is a React component: a function that returns a description of the screen (JSX, the
//   HTML-looking text below). React re-runs it whenever its "state" changes.
//     * `useState(x)` gives you a variable plus a function to change it; changing it redraws the
//       screen (like a Streamlit/Jupyter widget). `const [step, setStep] = useState("pick")`
//       means: `step` starts as "pick"; calling `setStep("map")` changes it and redraws.
//     * `async function onFile(file)` runs when the user picks a file.
//     * The flow: pick a file -> decode bytes (decode.ts) -> parse (PapaParse + parse.ts)
//       -> suggestMapping (suggest.ts) -> either go straight to a dry-run report, or show the
//       mapping screen (ImportMappingStep.tsx) -> user confirms -> dry run -> "Import N pigs".
//     * Every decision about WHAT is valid lives in src/lib/import/, not here; this file only
//       moves data between those functions and the screen.
//   See src/lib/import/README.md for the pipeline diagram.
// =============================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { importPigsAction } from "@/server/actions";
import { Icon } from "@/components/ui/NhomaIcons";
import { ImportEncodingPicker } from "./ImportEncodingPicker";
import { ImportMappingStep } from "./ImportMappingStep";
import type { RowResult } from "@/lib/import/validate";
import {
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_CSV,
  MAX_IMPORT_PAYLOAD_BYTES,
  MAX_IMPORT_ROWS,
} from "@/lib/import/columns";
import { decodeCsvBytes, isLegacyEncoding, type CsvEncoding, type LegacyCsvEncoding } from "@/lib/import/decode";
import { hasValueSource, isDateOrderSensitive, type ImportMapping } from "@/lib/import/mapping";
import { cleanRecords } from "@/lib/import/parse";
import { suggestMapping, type MappingSuggestion } from "@/lib/import/suggest";

interface Report {
  total: number;
  valid: number;
  invalid: number;
  results: RowResult[];
  imported: number;
}

/** What the server reported, plus the exact input it was computed from, so "Import" writes what was reviewed. */
interface CheckedReport extends Report {
  mapping: ImportMapping;
  records: Record<string, string>[];
}

type Step = "pick" | "map" | "report";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function ImportCsvModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("pick");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [dateHint, setDateHint] = useState<MappingSuggestion["dateHint"]>();
  const [numberHint, setNumberHint] = useState<MappingSuggestion["numberHint"]>();
  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState<CsvEncoding | null>(null);
  const [report, setReport] = useState<CheckedReport | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null); // the raw file, kept so a wrong encoding guess can be corrected
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("pick");
    setHeaders([]);
    setRecords([]);
    setMapping(null);
    setDateHint(undefined);
    setNumberHint(undefined);
    setReport(null);
    setFileName("");
    setEncoding(null);
    setBytes(null);
    setError(null);
  }

  /** Dry run: validates every row against the mapping and writes nothing. */
  async function runDryRun(recs: Record<string, string>[], m: ImportMapping) {
    setBusy(true);
    try {
      const r = await importPigsAction(recs, m, true);
      if (r.ok) {
        setReport({ ...(r.data as Report), mapping: m, records: recs });
        setStep("report");
      } else setError(r.error);
    } catch (e) {
      console.error("CSV dry run failed", e);
      setError("Couldn't check that file. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      if (file.size > MAX_FILE_BYTES) {
        setError(`That file is ${(file.size / 1_048_576).toFixed(1)} MB. Import files up to 5 MB (about ${MAX_IMPORT_ROWS} rows) at a time.`);
        return;
      }
      // Read bytes ourselves: Papa.parse(File) assumes UTF-8, which garbles
      // accents and Chinese in Excel's default Windows CSV exports.
      const raw = new Uint8Array(await file.arrayBuffer());
      setBytes(raw);
      await processBytes(raw);
    } catch (e) {
      console.error("CSV import failed to start", e);
      setError("Couldn't read that file. Make sure it's a CSV and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** Decode -> parse -> suggest a mapping -> dry run or mapping screen. Shared by a new file and an encoding change. */
  async function processBytes(raw: Uint8Array, encodingOverride?: LegacyCsvEncoding) {
    const decoded = decodeCsvBytes(raw, encodingOverride);
    const parsed = Papa.parse<Record<string, string>>(decoded.text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });

    const quoteError = parsed.errors.find((e) => e.type === "Quotes");
    if (quoteError) {
      setError(`The file has a formatting problem near row ${(quoteError.row ?? 0) + 2}: ${quoteError.message}. Check for an unclosed quote.`);
      return;
    }
    const fileHeaders = (parsed.meta.fields ?? []).filter(Boolean);
    const rows = cleanRecords(parsed.data); // drops Papa's __parsed_extra on ragged rows
    if (fileHeaders.length === 0 || rows.length === 0) {
      setError("No data rows found. The first row should be the column names, followed by one pig per row.");
      return;
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      setError(`This file has ${rows.length} rows. Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
      return;
    }
    if (new TextEncoder().encode(JSON.stringify(rows)).length > MAX_IMPORT_PAYLOAD_BYTES) {
      setError("This file contains too much text to import at once. Split it into smaller files or shorten long notes.");
      return;
    }

    const suggestion = suggestMapping(fileHeaders, rows);
    setHeaders(fileHeaders);
    setRecords(rows);
    setMapping(suggestion.mapping);
    setDateHint(suggestion.dateHint);
    setNumberHint(suggestion.numberHint);
    setEncoding(decoded.encoding);
    // Fully matched files (including the default template) skip straight to
    // the validation report; anything uncertain goes to the mapping screen.
    if (suggestion.unresolved.length === 0) await runDryRun(rows, suggestion.mapping);
    else setStep("map");
  }

  /** The person overrode the guessed character set: re-read the file from its original bytes. */
  async function changeEncoding(next: LegacyCsvEncoding) {
    if (!bytes) return;
    setBusy(true);
    try {
      setReport(null);
      setMapping(null);
      setStep("pick"); // shows the loading skeleton until the re-read finishes
      await processBytes(bytes, next);
    } catch (e) {
      console.error("CSV re-read failed", e);
      setError("Couldn't read that file. Make sure it's a CSV and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!report) return;
    setBusy(true);
    try {
      // Send exactly what the report was computed from, not whatever the screen holds now.
      const r = await importPigsAction(report.records, report.mapping, false);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const rep = r.data as Report;
      toast.success(`Imported ${rep.imported} pigs${rep.invalid ? ` — ${rep.invalid} rows skipped` : ""}`);
      router.refresh();
      onOpenChange(false);
      reset();
    } catch (e) {
      // A dropped connection does not tell us whether the server already saved the pigs.
      console.error("CSV import failed", e);
      toast.error("Couldn't confirm whether the import finished. Check the herd before trying again.");
      router.refresh(); // so the herd list shows what actually got saved
    } finally {
      setBusy(false);
    }
  }

  const templateLink = (
    <a
      className="-my-1 py-1 text-xs font-semibold text-accent hover:underline"
      href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE_CSV)}`}
      download="pig-import-template.csv"
    >
      Download template ↓
    </a>
  );

  // Only files whose character set was guessed get the picker (UTF-8 and BOM'd files are certain).
  const legacyPicker =
    bytes && encoding && isLegacyEncoding(encoding) ? (
      <ImportEncodingPicker bytes={bytes} encoding={encoding} onChange={(e) => void changeEncoding(e)} disabled={busy} />
    ) : null;

  const skeleton = (
    <div className="space-y-2 py-6" aria-busy="true">
      <div className="skeleton h-5 w-2/3" />
      <div className="skeleton h-5 w-1/2" />
      <div className="skeleton h-5 w-3/5" />
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      title="Import pigs from CSV"
      subtitle="Validated first — nothing is written until you confirm"
      wide
    >
      {error ? (
        <div className="space-y-4">
          <div role="alert" className="rounded-lg border border-rule bg-sunken px-4 py-3 text-sm text-overdue">
            {fileName && <div className="mb-1 font-tag text-xs text-ink-faint">{fileName}</div>}
            {error}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-dashed border-rule pt-4">
            <button className="btn btn-ghost" onClick={reset}>
              ← Choose another file
            </button>
            {templateLink}
          </div>
        </div>
      ) : step === "pick" ? (
        busy ? (
          skeleton
        ) : (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-rule-strong bg-sunken px-6 py-10 text-center transition-colors hover:border-accent">
              <Icon.File className="nhoma-icon text-ink-faint" size={30} />
              <span className="text-sm font-semibold">Choose a CSV file</span>
              <span className="text-xs text-ink-faint">
                Any column names work: you&apos;ll match them to Nhoma&apos;s fields ({IMPORT_COLUMNS.join(", ")})
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // allow re-selecting the same file after fixing it
                  if (file) void onFile(file);
                }}
              />
            </label>
            <div className="text-right">{templateLink}</div>
          </div>
        )
      ) : step === "map" && mapping ? (
        <div className="space-y-5">
          {legacyPicker}
          <ImportMappingStep
            headers={headers}
            records={records}
            mapping={mapping}
            dateHint={dateHint}
            numberHint={numberHint}
            onChange={setMapping}
            onContinue={() => runDryRun(records, mapping)}
            onBack={reset}
            busy={busy}
            />
        </div>
      ) : step === "report" && report ? (
        <div className="space-y-4">
          {legacyPicker}
          <div className="flex flex-wrap gap-3">
            <span className="status-badge status-badge--neutral">
              <span className="dot" />
              {fileName} · {report.total} rows
            </span>
            <span className="status-badge status-badge--ok">
              <span className="dot" />
              {report.valid} valid
            </span>
            {report.invalid > 0 && (
              <span className="status-badge status-badge--overdue">
                <span className="dot" />
                {report.invalid} with errors
              </span>
            )}
            {hasValueSource(report.mapping.fields.dateOfBirth) && isDateOrderSensitive(report.mapping.transforms.dateFormat) && (
              <span className="status-badge status-badge--neutral" title="Change this with Edit column matching">
                <span className="dot" />
                dates read {report.mapping.transforms.dateFormat.startsWith("dd") ? "day first" : "month first"} ({report.mapping.transforms.dateFormat})
              </span>
            )}
            {encoding && encoding !== "utf-8" && !isLegacyEncoding(encoding) && (
              <span className="status-badge status-badge--neutral" title="Announced by the file itself">
                <span className="dot" />
                read as {encoding}
              </span>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-rule">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Tag</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r) => (
                  <tr key={r.row}>
                    <td className="font-tag text-xs">{r.row}</td>
                    <td className="font-tag text-xs">{r.tagId}</td>
                    <td>
                      {r.ok ? (
                        <span className="inline-flex items-center gap-1 text-xs text-ok">
                          <Icon.Check size={12} /> ready
                        </span>
                      ) : (
                        <span className="text-xs text-overdue">{r.errors.join(" · ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-between gap-2 border-t border-dashed border-rule pt-4">
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={reset} disabled={busy}>
                ← Choose another file
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setReport(null);
                  setStep("map");
                }}
                disabled={busy}
              >
                Edit column matching
              </button>
            </div>
            <button className="btn btn-primary" onClick={commit} disabled={busy || report.valid === 0}>
              {busy ? "Importing…" : `Import ${report.valid} pigs`}
            </button>
          </div>
        </div>
      ) : (
        skeleton
      )}
    </Modal>
  );
}
