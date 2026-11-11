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
import { ImportMappingStep } from "./ImportMappingStep";
import type { RowResult } from "@/lib/import/validate";
import {
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_CSV,
  MAX_IMPORT_PAYLOAD_BYTES,
  MAX_IMPORT_ROWS,
} from "@/lib/import/columns";
import { decodeCsvBytes, type CsvEncoding } from "@/lib/import/decode";
import { isDateOrderSensitive, type ImportMapping } from "@/lib/import/mapping";
import { cleanRecords } from "@/lib/import/parse";
import { suggestMapping, type MappingSuggestion } from "@/lib/import/suggest";

interface Report {
  total: number;
  valid: number;
  invalid: number;
  results: RowResult[];
  imported: number;
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
  const [report, setReport] = useState<Report | null>(null);
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
    setError(null);
  }

  /** Dry run: validates every row against the mapping and writes nothing. */
  async function runDryRun(recs: Record<string, string>[], m: ImportMapping) {
    setBusy(true);
    try {
      const r = await importPigsAction(recs, m, true);
      if (r.ok) {
        setReport(r.data as Report);
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
      const decoded = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
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
    } catch (e) {
      console.error("CSV import failed to start", e);
      setError("Couldn't read that file. Make sure it's a CSV and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!mapping) return;
    setBusy(true);
    try {
      const r = await importPigsAction(records, mapping, false);
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
      console.error("CSV import failed", e);
      toast.error("Something went wrong. Nothing was imported — please try again.");
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
      ) : step === "report" && report ? (
        <div className="space-y-4">
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
            {mapping?.fields.dateOfBirth?.source && isDateOrderSensitive(mapping.transforms.dateFormat) && (
              <span className="status-badge status-badge--neutral" title="Change this with Edit column matching">
                <span className="dot" />
                dates read {mapping.transforms.dateFormat.startsWith("dd") ? "day first" : "month first"} ({mapping.transforms.dateFormat})
              </span>
            )}
            {encoding && encoding !== "utf-8" && (
              <span className="status-badge status-badge--neutral" title="Detected from the file's bytes">
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
