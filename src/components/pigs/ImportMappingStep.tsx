"use client";

import { useMemo } from "react";
import { IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS, type ImportColumn } from "@/lib/import/columns";
import { DATE_FORMATS, applyMapping, parseDate, readCell, type DateFormat, type ImportMapping } from "@/lib/import/mapping";
import { checkMapping, standardSex, type MappingProblem } from "@/lib/import/suggest";

const FIELD_LABELS: Record<ImportColumn, string> = {
  tagId: "Pig ID (tag)",
  breed: "Breed",
  sex: "Sex",
  dateOfBirth: "Date of birth",
  weightKg: "Weight",
  motherTagId: "Mother's tag",
  fatherTagId: "Father's tag",
  castrated: "Castrated",
  notes: "Notes",
};

function describe(p: MappingProblem): string {
  switch (p.kind) {
    case "missingField":
      return p.field === "breed"
        ? "Choose a breed column, or type a breed to use for every pig."
        : `Choose which column holds the ${FIELD_LABELS[p.field].toLowerCase()}.`;
    case "unknownSexValues":
      return `Say whether ${p.values.map((v) => `“${v}”`).join(", ")} mean male or female.`;
    case "unreadableDates":
      return `${p.count} date${p.count > 1 ? "s" : ""} don't match the chosen format (for example “${p.example}”).`;
  }
}

export function ImportMappingStep({
  headers,
  records,
  mapping,
  onChange,
  onContinue,
  onBack,
  busy,
}: {
  headers: string[];
  records: Record<string, string>[];
  mapping: ImportMapping;
  onChange: (m: ImportMapping) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const problems = useMemo(() => checkMapping(mapping, records), [mapping, records]);
  const preview = useMemo(() => applyMapping(records.slice(0, 3), mapping).rows, [records, mapping]);

  const sexSource = mapping.fields.sex?.source;
  const sexValues = useMemo(
    () => (sexSource ? [...new Set(records.map((r) => readCell(r, sexSource)).filter(Boolean))].slice(0, 12) : []),
    [records, sexSource],
  );
  const dateSource = mapping.fields.dateOfBirth?.source;
  const dateSamples = useMemo(
    () => (dateSource ? records.map((r) => readCell(r, dateSource)).filter(Boolean).slice(0, 3) : []),
    [records, dateSource],
  );

  const setField = (field: ImportColumn, source: string | null) =>
    onChange({ ...mapping, fields: { ...mapping.fields, [field]: { ...mapping.fields[field], source } } });

  const setBreedDefault = (value: string) =>
    onChange({ ...mapping, fields: { ...mapping.fields, breed: { source: mapping.fields.breed?.source ?? null, default: value } } });

  const setTransform = (patch: Partial<ImportMapping["transforms"]>) =>
    onChange({ ...mapping, transforms: { ...mapping.transforms, ...patch } });

  const sexValueFor = (v: string): "MALE" | "FEMALE" | "" => {
    const key = v.toLowerCase();
    const hit = Object.entries(mapping.transforms.sexValues).find(([k]) => k.trim().toLowerCase() === key);
    return hit?.[1] ?? standardSex(v) ?? "";
  };

  const setSexValue = (v: string, to: "MALE" | "FEMALE" | "") => {
    const key = v.toLowerCase();
    const kept = Object.entries(mapping.transforms.sexValues).filter(([k]) => k.trim().toLowerCase() !== key);
    setTransform({ sexValues: Object.fromEntries(to ? [...kept, [v, to]] : kept) });
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-soft">
        We matched what we could. Check each field, fix anything that looks off, then continue to the validation report.
      </p>

      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-rule bg-sunken px-4 py-3">
          {problems.map((p, i) => (
            <li key={i} className="field-error !mt-0">
              {describe(p)}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {IMPORT_COLUMNS.map((field) => {
          const required = (REQUIRED_IMPORT_COLUMNS as readonly string[]).includes(field);
          const missing = problems.some((p) => p.kind === "missingField" && p.field === field);
          return (
            <div key={field}>
              <label className="field-label" htmlFor={`map-${field}`}>
                {FIELD_LABELS[field]}
                {required && <span aria-hidden> *</span>}
              </label>
              <select
                id={`map-${field}`}
                className={`select ${missing ? "input-error" : ""}`}
                value={mapping.fields[field]?.source ?? ""}
                onChange={(e) => setField(field, e.target.value || null)}
              >
                <option value="">{required ? "— choose a column —" : "— not in my file —"}</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              {field === "breed" && !mapping.fields.breed?.source && (
                <input
                  className="input mt-2"
                  placeholder="Breed for every pig, e.g. Mixed Breed"
                  aria-label="Default breed"
                  value={mapping.fields.breed?.default ?? ""}
                  onChange={(e) => setBreedDefault(e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      {(sexValues.length > 0 || dateSource || mapping.fields.weightKg?.source) && (
        <div className="space-y-4 rounded-lg border border-rule p-4">
          {sexValues.length > 0 && (
            <fieldset>
              <legend className="field-label">What your sex values mean</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {sexValues.map((v) => (
                  <label key={v} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-tag">{v}</span>
                    <select
                      className={`select !w-auto ${sexValueFor(v) ? "" : "input-error"}`}
                      value={sexValueFor(v)}
                      onChange={(e) => setSexValue(v, e.target.value as "MALE" | "FEMALE" | "")}
                      aria-label={`Meaning of ${v}`}
                    >
                      <option value="">— choose —</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {dateSource && (
            <div>
              <label className="field-label" htmlFor="map-date-format">
                Date format
              </label>
              <select
                id="map-date-format"
                className="select"
                value={mapping.transforms.dateFormat}
                onChange={(e) => setTransform({ dateFormat: e.target.value as DateFormat })}
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f === "iso" ? "yyyy-MM-dd (2026-01-15)" : f}
                  </option>
                ))}
              </select>
              {dateSamples.length > 0 && (
                <p className="mt-1 text-xs text-ink-faint">
                  {dateSamples
                    .map((d) => `${d} → ${parseDate(d, mapping.transforms.dateFormat) ?? "unreadable"}`)
                    .join("  ·  ")}
                </p>
              )}
            </div>
          )}

          {mapping.fields.weightKg?.source && (
            <div>
              <label className="field-label" htmlFor="map-weight-unit">
                Weight unit
              </label>
              <select
                id="map-weight-unit"
                className="select"
                value={mapping.transforms.weightUnit}
                onChange={(e) => setTransform({ weightUnit: e.target.value as "kg" | "lb" })}
              >
                <option value="kg">Kilograms</option>
                <option value="lb">Pounds (converted to kg)</option>
              </select>
            </div>
          )}
        </div>
      )}

      {preview.length > 0 && (
        <div>
          <div className="field-label">How the first rows will be read</div>
          <div className="overflow-x-auto rounded-lg border border-rule">
            <table className="data-table">
              <thead>
                <tr>
                  {["Tag", "Breed", "Sex", "Born", "Weight kg"].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td className="font-tag text-xs">{r.tagId || "—"}</td>
                    <td className="text-xs">{r.breed || "—"}</td>
                    <td className="text-xs">{r.sex || "—"}</td>
                    <td className="font-tag text-xs">{r.dateOfBirth || "—"}</td>
                    <td className="font-tag text-xs">{r.weightKg || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 border-t border-dashed border-rule pt-4">
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>
          ← Choose another file
        </button>
        <button className="btn btn-primary" onClick={onContinue} disabled={busy || problems.length > 0}>
          {busy ? "Checking…" : "Continue to validation"}
        </button>
      </div>
    </div>
  );
}
