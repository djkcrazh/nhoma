"use client";

import { useMemo } from "react";
import { IMPORT_COLUMNS, REQUIRED_IMPORT_COLUMNS, type ImportColumn } from "@/lib/import/columns";
import {
  DATE_FORMATS,
  applyMapping,
  castratedResolver,
  dateOrderAlternative,
  isAmbiguousNumber,
  isFemale,
  NUMBER_FORMATS,
  parseDate,
  parseNumber,
  readCell,
  sexResolver,
  weightDigits,
  type DateFormat,
  type ImportMapping,
  type NumberFormat,
} from "@/lib/import/mapping";
import {
  checkMapping,
  mappingWarnings,
  standardSex,
  type MappingProblem,
  type MappingSuggestion,
  type MappingWarning,
} from "@/lib/import/suggest";

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

const MAX_VALUES_SHOWN = 30;

const NUMBER_LABELS: Record<NumberFormat, { name: string; code: string }> = {
  en: { name: "Comma for thousands, period for decimals", code: "1,234.5" },
  eu: { name: "Period for thousands, comma for decimals", code: "1.234,5" },
};

const quoted = (values: string[]) => values.slice(0, 4).map((v) => `“${v}”`).join(", ") + (values.length > 4 ? ", …" : "");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describeProblem(p: MappingProblem, format: DateFormat, numberFormat: NumberFormat): string {
  switch (p.kind) {
    case "missingField":
      return p.field === "breed"
        ? "Choose a breed column, or type a breed to use for every pig."
        : `Choose which column holds the ${FIELD_LABELS[p.field].toLowerCase()}.`;
    case "confirmDateOrder":
      return "Confirm whether your dates are day-first or month-first (below).";
    case "confirmNumberFormat":
      return "Confirm how your weights are written (below): some can be read two ways.";
    case "unreadableWeights":
      return p.betterFormat
        ? `${plural(p.count, "weight")} can't be read as “${NUMBER_LABELS[numberFormat].code}”, but “${NUMBER_LABELS[p.betterFormat].code}” reads all of them (for example “${p.example}”). Pick the right one below.`
        : `${plural(p.count, "weight")} can't be read (for example “${p.example}”). Check the number format and unit below.`;
    case "unreadableDates":
      return p.betterFormat
        ? `${plural(p.count, "date")} can't be read as ${format}, but ${p.betterFormat} reads all of them (for example “${p.example}”). Pick the right order below.`
        : `${plural(p.count, "date")} don't match ${format} (for example “${p.example}”). Pick the right format below.`;
    case "unknownSexValues":
      return `Say whether ${quoted(p.values)} mean male or female (${plural(p.rows, "row")}).`;
    case "unknownCastratedValues":
      return `Say whether ${quoted(p.values)} mean castrated or not (${plural(p.rows, "row")}).`;
  }
}

function describeWarning(w: MappingWarning): string {
  switch (w.kind) {
    case "strayDates":
      return `${plural(w.count, "date")} can't be read (for example “${w.example}”). Those rows will be listed as errors in the next step.`;
    case "strayWeights":
      return `${plural(w.count, "weight")} can't be read (for example “${w.example}”). Those rows will be listed as errors in the next step.`;
    case "straySexValues":
      return `${plural(w.rows, "row")} ${w.rows === 1 ? "has" : "have"} a sex we don't recognise (${quoted(w.values)}). Choose a meaning below, or they'll be listed as errors in the next step.`;
    case "strayCastratedValues":
      return `${plural(w.rows, "row")} ${w.rows === 1 ? "has" : "have"} a castrated value we don't recognise (${quoted(w.values)}). Choose a meaning below, or they'll be listed as errors in the next step.`;
  }
}

/** "2024-04-03" -> "April 3, 2024", so the two readings of 03/04/2024 look different at a glance. */
function plainDate(iso: string | null): string {
  if (!iso) return "not a valid date";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const orderName = (f: DateFormat) => (f.startsWith("dd") ? "Day first" : "Month first");

const FORMAT_LABELS: Record<DateFormat, string> = {
  iso: "yyyy-MM-dd (2026-01-15)",
  "dd/MM/yyyy": "dd/MM/yyyy (day first, 15/01/2026)",
  "MM/dd/yyyy": "MM/dd/yyyy (month first, 01/15/2026)",
  "dd.MM.yyyy": "dd.MM.yyyy (day first, 15.01.2026)",
  "MM.dd.yyyy": "MM.dd.yyyy (month first, 01.15.2026)",
  "yyyy/MM/dd": "yyyy/MM/dd (2026/01/15)",
  "yyyy年M月d日": "yyyy年M月d日 (2026年1月15日)",
};

export function ImportMappingStep({
  headers,
  records,
  mapping,
  dateHint,
  numberHint,
  onChange,
  onContinue,
  onBack,
  busy,
}: {
  headers: string[];
  records: Record<string, string>[];
  mapping: ImportMapping;
  dateHint?: MappingSuggestion["dateHint"];
  numberHint?: MappingSuggestion["numberHint"];
  onChange: (m: ImportMapping) => void;
  onContinue: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const problems = useMemo(() => checkMapping(mapping, records), [mapping, records]);
  const warnings = useMemo(() => mappingWarnings(mapping, records), [mapping, records]);
  const preview = useMemo(() => applyMapping(records.slice(0, 3), mapping).rows, [records, mapping]);

  const sexSource = mapping.fields.sex?.source;
  const dateSource = mapping.fields.dateOfBirth?.source;
  const castratedSource = mapping.fields.castrated?.source;
  const format = mapping.transforms.dateFormat;
  const alternative = dateOrderAlternative(format);

  // Sex words in the file, unrecognised ones first so they are never hidden by the cap.
  const sexValues = useMemo(() => {
    if (!sexSource) return [];
    const translated = new Set(Object.keys(mapping.transforms.sexValues).map((k) => k.trim().toLowerCase()));
    const distinct = [...new Set(records.map((r) => readCell(r, sexSource)).filter(Boolean))];
    const unknown = (v: string) => !standardSex(v) && !translated.has(v.toLowerCase());
    return distinct.sort((a, b) => Number(unknown(b)) - Number(unknown(a))).slice(0, MAX_VALUES_SHOWN);
  }, [records, sexSource, mapping.transforms.sexValues]);

  // Castrated words, only from rows where it matters (not sows).
  const castratedValues = useMemo(() => {
    if (!castratedSource) return [];
    const toSex = sexResolver(mapping);
    const toCastrated = castratedResolver(mapping);
    const distinct = new Set<string>();
    for (const r of records) {
      const v = readCell(r, castratedSource);
      if (v && !isFemale(toSex(readCell(r, sexSource)))) distinct.add(v);
    }
    return [...distinct].sort((a, b) => Number(toCastrated(b) === undefined) - Number(toCastrated(a) === undefined)).slice(0, MAX_VALUES_SHOWN);
  }, [records, castratedSource, sexSource, mapping]);

  // Dates that read differently day-first vs month-first make the best examples for the confirmation.
  const orderExamples = useMemo(() => {
    if (!dateSource || !alternative) return [];
    const cells = records.map((r) => readCell(r, dateSource)).filter(Boolean);
    const differing = cells.filter((d) => {
      const a = parseDate(d, format);
      const b = parseDate(d, alternative);
      return a && b && a !== b;
    });
    return [...new Set(differing.length > 0 ? differing : cells)].slice(0, 2);
  }, [records, dateSource, format, alternative]);

  // Weights that read differently under each convention make the best examples for the confirmation.
  const weightSource = mapping.fields.weightKg?.source;
  const numberExamples = useMemo(
    () =>
      weightSource
        ? [...new Set(records.map((r) => readCell(r, weightSource)).filter(isAmbiguousNumber))].slice(0, 2)
        : [],
    [records, weightSource],
  );
  const numberConfirmed = mapping.transforms.numberFormatConfirmed;
  const needsNumberConfirm = problems.some((p) => p.kind === "confirmNumberFormat");
  const kgText = (n: number | null) => (n === null ? "not a valid number" : `${n} ${mapping.transforms.weightUnit}`);

  const dateSamples = useMemo(
    () => (dateSource ? records.map((r) => readCell(r, dateSource)).filter(Boolean).slice(0, 3) : []),
    [records, dateSource],
  );

  const setField = (field: ImportColumn, source: string | null) =>
    onChange({
      ...mapping,
      fields: { ...mapping.fields, [field]: { ...mapping.fields[field], source } },
      // A different date column may follow a different convention, so ask again.
      transforms:
        field === "dateOfBirth"
          ? { ...mapping.transforms, dateFormatConfirmed: false }
          : field === "weightKg"
            ? { ...mapping.transforms, numberFormatConfirmed: false }
            : mapping.transforms,
    });

  const setBreedDefault = (value: string) =>
    onChange({ ...mapping, fields: { ...mapping.fields, breed: { source: mapping.fields.breed?.source ?? null, default: value } } });

  const setTransform = (patch: Partial<ImportMapping["transforms"]>) =>
    onChange({ ...mapping, transforms: { ...mapping.transforms, ...patch } });

  const sexMeaning = sexResolver(mapping);
  const sexValueFor = (v: string): "MALE" | "FEMALE" | "" => {
    const out = sexMeaning(v);
    return out === "MALE" || out === "FEMALE" ? out : (standardSex(v) ?? "");
  };
  const setSexValue = (v: string, to: "MALE" | "FEMALE" | "") => {
    const key = v.toLowerCase();
    const kept = Object.entries(mapping.transforms.sexValues).filter(([k]) => k.trim().toLowerCase() !== key);
    setTransform({ sexValues: Object.fromEntries(to ? [...kept, [v, to]] : kept) });
  };

  const castratedMeaning = castratedResolver(mapping);
  const setCastratedValue = (v: string, to: "yes" | "no" | "") => {
    const key = v.toLowerCase();
    const kept = Object.entries(mapping.transforms.castratedValues).filter(([k]) => k.trim().toLowerCase() !== key);
    setTransform({ castratedValues: Object.fromEntries(to ? [...kept, [v, to === "yes"]] : kept) });
  };

  // Day-first always on the left, so the choice reads the same for every file.
  const pair: DateFormat[] = !alternative ? [] : format.startsWith("dd") ? [format, alternative] : [alternative, format];
  const confirmed = mapping.transforms.dateFormatConfirmed;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-soft">
        We matched what we could. Check each field, fix anything that looks off, then continue to the validation report.
      </p>

      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-rule bg-sunken px-4 py-3">
          {problems.map((p, i) => (
            <li key={i} className="field-error !mt-0">
              {describeProblem(p, format, mapping.transforms.numberFormat)}
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-rule px-4 py-3">
          {warnings.map((w, i) => (
            <li key={i} className="text-xs text-ink-faint">
              Heads up: {describeWarning(w)}
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

      {(sexValues.length > 0 || castratedValues.length > 0 || dateSource || mapping.fields.weightKg?.source) && (
        <div className="space-y-4 rounded-lg border border-rule p-4">
          {dateSource && pair.length === 2 && (
            <fieldset className={`rounded-lg border p-3 ${confirmed ? "border-rule" : "border-overdue"}`}>
              <legend className="field-label px-1">Confirm your date order *</legend>
              <p className="text-xs text-ink-faint">
                A date like 03/04/2024 is 3 April in most of the world and March 4 in the US. Pick the one your file uses. We
                never choose this for you.
              </p>
              {dateHint && pair.includes(dateHint.format) && <p className="mt-1 text-xs">Hint: {dateHint.reason}</p>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {pair.map((f) => {
                  const selected = confirmed && format === f;
                  return (
                    <label
                      key={f}
                      className={`cursor-pointer rounded-lg border p-3 text-sm ${selected ? "border-accent bg-sunken" : "border-rule"}`}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <input
                          type="radio"
                          name="date-order"
                          checked={selected}
                          onChange={() => setTransform({ dateFormat: f, dateFormatConfirmed: true })}
                        />
                        {orderName(f)} <span className="font-tag text-xs font-normal text-ink-faint">{f}</span>
                      </span>
                      {orderExamples.map((d) => (
                        <span key={d} className="mt-1 block text-xs text-ink-faint">
                          {d} → {plainDate(parseDate(d, f))}
                        </span>
                      ))}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

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

          {castratedValues.length > 0 && (
            <fieldset>
              <legend className="field-label">What your castrated values mean</legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {castratedValues.map((v) => {
                  const meaning = castratedMeaning(v);
                  return (
                    <label key={v} className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-tag">{v}</span>
                      <select
                        className={`select !w-auto ${meaning === undefined ? "input-error" : ""}`}
                        value={meaning === undefined ? "" : meaning ? "yes" : "no"}
                        onChange={(e) => setCastratedValue(v, e.target.value as "yes" | "no" | "")}
                        aria-label={`Castrated meaning of ${v}`}
                      >
                        <option value="">— choose —</option>
                        <option value="yes">Castrated</option>
                        <option value="no">Not castrated</option>
                      </select>
                    </label>
                  );
                })}
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
                value={format}
                onChange={(e) => setTransform({ dateFormat: e.target.value as DateFormat, dateFormatConfirmed: false })}
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
              {dateSamples.length > 0 && (
                <p className="mt-1 text-xs text-ink-faint">
                  {dateSamples.map((d) => `${d} → ${parseDate(d, format) ?? "unreadable"}`).join("  ·  ")}
                </p>
              )}
            </div>
          )}

          {weightSource && needsNumberConfirm && (
            <fieldset className={`rounded-lg border p-3 ${numberConfirmed ? "border-rule" : "border-overdue"}`}>
              <legend className="field-label px-1">Confirm how your weights are written *</legend>
              <p className="text-xs text-ink-faint">
                A weight like 1,200 is twelve hundred in Ghana, the UK and the US, and one point two in France and Spain. Pick the
                convention your file uses. We never choose this for you.
              </p>
              {numberHint && <p className="mt-1 text-xs">Hint: {numberHint.reason}</p>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {NUMBER_FORMATS.map((f) => {
                  const selected = numberConfirmed && mapping.transforms.numberFormat === f;
                  return (
                    <label
                      key={f}
                      className={`cursor-pointer rounded-lg border p-3 text-sm ${selected ? "border-accent bg-sunken" : "border-rule"}`}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <input
                          type="radio"
                          name="number-format"
                          checked={selected}
                          onChange={() => setTransform({ numberFormat: f, numberFormatConfirmed: true })}
                        />
                        {NUMBER_LABELS[f].name} <span className="font-tag text-xs font-normal text-ink-faint">{NUMBER_LABELS[f].code}</span>
                      </span>
                      {numberExamples.map((v) => (
                        <span key={v} className="mt-1 block text-xs text-ink-faint">
                          {v} → {kgText(parseNumber(weightDigits(v) ?? "", f))}
                        </span>
                      ))}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {weightSource && (
            <div>
              <label className="field-label" htmlFor="map-number-format">
                Number format
              </label>
              <select
                id="map-number-format"
                className="select"
                value={mapping.transforms.numberFormat}
                onChange={(e) => setTransform({ numberFormat: e.target.value as NumberFormat, numberFormatConfirmed: false })}
              >
                {NUMBER_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {NUMBER_LABELS[f].code} ({NUMBER_LABELS[f].name.toLowerCase()})
                  </option>
                ))}
              </select>
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
                  {["Tag", "Breed", "Sex", "Born", "Weight kg", "Castrated"].map((h) => (
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
                    <td className="font-tag text-xs">{r.dateOfBirth ? (confirmed || !alternative ? r.dateOfBirth : `${r.dateOfBirth} (unconfirmed)`) : "—"}</td>
                    <td className="font-tag text-xs">{r.weightKg || "—"}</td>
                    <td className="text-xs">{r.castrated || "—"}</td>
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
