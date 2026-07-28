"use client";

import { useEffect, useRef, useState } from "react";
import { searchPigOptionsAction } from "@/server/actions";
import { Sex } from "@/lib/domain/types";
import { Icon } from "@/components/ui/NhomaIcons";

interface Option {
  id: string;
  tagId: string;
  breed: string;
}

/** Async autocomplete for selecting a pig (parent, sow, boar) by tag ID. */
export function PigPicker({
  label,
  sex,
  value,
  onChange,
  placeholder,
  excludeId,
}: {
  label: string;
  sex?: Sex;
  value: { id: string; tagId: string } | null;
  onChange: (v: { id: string; tagId: string } | null) => void;
  placeholder?: string;
  excludeId?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!open) return;
    timer.current = setTimeout(async () => {
      const res = await searchPigOptionsAction(query.trim(), sex);
      if (res.ok) {
        setOptions((res.data as Option[]).filter((o) => o.id !== excludeId));
        setHighlight(0);
      }
    }, 150);
  }, [query, open, sex, excludeId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <label className="field-label">{label}</label>
      {value ? (
        <div className="flex min-h-10 items-center gap-2 rounded-[10px] border border-rule-strong bg-raised px-3 py-1.5">
          <span className="ear-tag">{value.tagId}</span>
          <button
            type="button"
            className="ml-auto text-ink-faint hover:text-overdue"
            onClick={() => onChange(null)}
            aria-label={`Clear ${label}`}
          >
            <Icon.Close size={13} />
          </button>
        </div>
      ) : (
        <input
          className="input"
          placeholder={placeholder ?? "Type a tag ID…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || options.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              const o = options[highlight];
              if (o) { onChange({ id: o.id, tagId: o.tagId }); setQuery(""); setOpen(false); }
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
      )}
      {open && !value && options.length > 0 && (
        <div
          className="card absolute left-0 right-0 top-full z-50 mt-1.5 max-h-52 overflow-y-auto overflow-x-hidden p-1"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          {options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm ${i === highlight ? "bg-sunken" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => { onChange({ id: o.id, tagId: o.tagId }); setQuery(""); setOpen(false); }}
            >
              {/* Tag is the identifier and never shrinks; breed is secondary and
                  ellipsizes so a narrow column can't overflow the panel. */}
              <span className="ear-tag shrink-0">{o.tagId}</span>
              <span className="min-w-0 truncate text-xs text-ink-soft">{o.breed}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
