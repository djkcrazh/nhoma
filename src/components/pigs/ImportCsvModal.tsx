"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { importPigsAction } from "@/server/actions";
import { Icon } from "@/components/ui/NhomaIcons";
import type { RowResult } from "@/lib/import/validate";
import {
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_CSV,
  MAX_IMPORT_PAYLOAD_BYTES,
  MAX_IMPORT_ROWS,
  canonicalizeHeader,
  checkHeaders,
} from "@/lib/import/columns";
import { decodeCsvBytes, type CsvEncoding } from "@/lib/import/decode";

interface Report {
  total: number;
  valid: number;
  invalid: number;
  results: RowResult[];
  imported: number;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function ImportCsvModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState<CsvEncoding | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setReport(null);
    setFileName("");
    setEncoding(null);
    setError(null);
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
        transformHeader: canonicalizeHeader,
      });

      const quoteError = parsed.errors.find((e) => e.type === "Quotes");
      if (quoteError) {
        setError(`The file has a formatting problem near row ${(quoteError.row ?? 0) + 2}: ${quoteError.message}. Check for an unclosed quote.`);
        return;
      }
      const fields = parsed.meta.fields ?? [];
      const { missing } = checkHeaders(fields);
      if (missing.length > 0) {
        setError(
          `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
            `Found: ${fields.filter(Boolean).join(", ") || "no headers"}. Use the template below as a guide.`,
        );
        return;
      }
      if (parsed.data.length === 0) {
        setError("No data rows found below the header row.");
        return;
      }
      if (parsed.data.length > MAX_IMPORT_ROWS) {
        setError(`This file has ${parsed.data.length} rows. Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
        return;
      }
      if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > MAX_IMPORT_PAYLOAD_BYTES) {
        setError("This file contains too much text to import at once. Split it into smaller files or shorten long notes.");
        return;
      }

      setRows(parsed.data);
      setEncoding(decoded.encoding);
      // Dry run immediately so the farmer sees a validation report first
      const r = await importPigsAction(parsed.data, true);
      if (r.ok) setReport(r.data as Report);
      else setError(r.error);
    } catch (e) {
      console.error("CSV import failed to start", e);
      setError("Couldn't read that file. Make sure it's a CSV and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await importPigsAction(rows, false);
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
      ) : busy && !report ? (
        <div className="space-y-2 py-6" aria-busy="true">
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-5 w-3/5" />
        </div>
      ) : !rows ? (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-rule-strong bg-sunken px-6 py-10 text-center transition-colors hover:border-accent">
            <Icon.File className="nhoma-icon text-ink-faint" size={30} />
            <span className="text-sm font-semibold">Choose a CSV file</span>
            <span className="text-xs text-ink-faint">Columns: {IMPORT_COLUMNS.join(", ")}</span>
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
      ) : report ? (
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

          <div className="flex justify-between gap-2 border-t border-dashed border-rule pt-4">
            <button className="btn btn-ghost" onClick={reset} disabled={busy}>
              ← Choose another file
            </button>
            <button className="btn btn-primary" onClick={commit} disabled={busy || report.valid === 0}>
              {busy ? "Importing…" : `Import ${report.valid} pigs`}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
