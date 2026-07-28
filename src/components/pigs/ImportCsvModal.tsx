"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { importPigsAction } from "@/server/actions";
import { Icon } from "@/components/ui/NhomaIcons";
import type { RowResult } from "@/server/services/import.service";

interface Report {
  total: number;
  valid: number;
  invalid: number;
  results: RowResult[];
  imported: number;
}

const TEMPLATE =
  "tagId,breed,sex,dateOfBirth,weightKg,motherTagId,fatherTagId,castrated,notes\n" +
  "PIG-201,Large White,FEMALE,2026-05-01,12.5,PIG-003,PIG-001,,healthy piglet\n";

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
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setRows(null);
    setReport(null);
    setFileName("");
  }

  function onFile(file: File) {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: async (res) => {
        setRows(res.data);
        // Dry run immediately so the farmer sees a validation report first
        setBusy(true);
        const r = await importPigsAction(res.data, true);
        setBusy(false);
        if (r.ok) setReport(r.data as Report);
        else toast.error(r.error);
      },
    });
  }

  async function commit() {
    if (!rows) return;
    setBusy(true);
    const r = await importPigsAction(rows, false);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const rep = r.data as Report;
    toast.success(`Imported ${rep.imported} pigs${rep.invalid ? ` — ${rep.invalid} rows skipped` : ""}`);
    router.refresh();
    onOpenChange(false);
    reset();
  }

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
      {!rows ? (
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-rule-strong bg-sunken px-6 py-10 text-center transition-colors hover:border-accent">
            <Icon.File className="nhoma-icon text-ink-faint" size={30} />
            <span className="text-sm font-semibold">Choose a CSV file</span>
            <span className="text-xs text-ink-faint">
              Columns: tagId, breed, sex, dateOfBirth, weightKg, motherTagId, fatherTagId, castrated, notes
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          <div className="text-right">
            <a
              className="-my-1 py-1 text-xs font-semibold text-accent hover:underline"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="pig-import-template.csv"
            >
              Download template ↓
            </a>
          </div>
        </div>
      ) : busy && !report ? (
        <div className="space-y-2 py-6">
          <div className="skeleton h-5 w-2/3" />
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-5 w-3/5" />
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
