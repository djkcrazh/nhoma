"use client";

// =============================================================================
// ImportEncodingPicker.tsx: shows how a non-UTF-8 file was read and lets a person correct it.
//
// Why it exists: for old Windows code pages the encoding is only GUESSED from the bytes
// (decode.ts), and a wrong guess still produces valid-looking text. "créée" saved as
// windows-1252 is the same bytes as one Chinese character, so the guess can change real notes
// without any error. We never choose silently: the file's own accented / Chinese text is
// shown under each reading and the person picks the one that looks right.
// =============================================================================

import { useMemo } from "react";
import { LEGACY_ENCODINGS, previewDecoding, type LegacyCsvEncoding } from "@/lib/import/decode";

const LABELS: Record<LegacyCsvEncoding, string> = {
  "windows-1252": "Western European (French, Spanish, …)",
  gb18030: "Chinese (GBK / GB18030)",
};

export function ImportEncodingPicker({
  bytes,
  encoding,
  onChange,
  disabled,
}: {
  bytes: Uint8Array;
  encoding: LegacyCsvEncoding;
  onChange: (e: LegacyCsvEncoding) => void;
  disabled: boolean;
}) {
  // What the file's accented / Chinese text looks like under each reading.
  const previews = useMemo(
    () => Object.fromEntries(LEGACY_ENCODINGS.map((e) => [e, previewDecoding(bytes, e)])) as Record<LegacyCsvEncoding, string[]>,
    [bytes],
  );

  return (
    <fieldset disabled={disabled} className="min-w-0 rounded-lg border border-rule p-3">
      <legend className="field-label px-1">Check how your file&apos;s text was read</legend>
      <p className="text-xs text-ink-faint">
        This file isn&apos;t in a standard format, so we guessed its character set. If the text below looks garbled, pick the other one.
        Switching re-reads the file and restarts the column matching.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {LEGACY_ENCODINGS.map((e) => (
          <label
            key={e}
            className={`cursor-pointer rounded-lg border p-3 text-sm ${encoding === e ? "border-accent bg-sunken" : "border-rule"}`}
          >
            <span className="flex items-center gap-2 font-semibold">
              <input type="radio" name="csv-encoding" checked={encoding === e} onChange={() => onChange(e)} />
              {LABELS[e]}
            </span>
            {previews[e].map((t) => (
              <span key={t} className="mt-1 block truncate text-xs text-ink-faint">
                {t}
              </span>
            ))}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
