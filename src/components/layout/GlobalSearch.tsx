"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchPigOptionsAction } from "@/server/actions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Icon } from "@/components/ui/NhomaIcons";

interface Option {
  id: string;
  tagId: string;
  breed: string;
  sex: string;
  status: string;
}

export function GlobalSearch({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [openList, setOpenList] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setOptions([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const res = await searchPigOptionsAction(value.trim());
      if (res.ok) {
        setOptions(res.data as Option[]);
        setOpenList(true);
        setHighlight(0);
      }
    }, 180);
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpenList(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(tagId: string) {
    setOpenList(false);
    setQuery("");
    router.push(`/pigs/${encodeURIComponent(tagId)}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!openList || options.length === 0) {
      if (e.key === "Enter" && query.trim()) {
        router.push(`/pigs?search=${encodeURIComponent(query.trim())}`);
        setOpenList(false);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(options[highlight].tagId);
    } else if (e.key === "Escape") {
      setOpenList(false);
    }
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
        <Icon.Search size={16} />
      </span>
      <input
        ref={inputRef}
        className="input"
        style={{ paddingLeft: "2.5rem", paddingRight: "3.25rem" }}
        placeholder="Search tag, breed, parent…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => options.length && setOpenList(true)}
        onKeyDown={onKeyDown}
        aria-label="Global search"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-rule-strong bg-sunken px-1.5 py-0.5 font-tag text-[10px] text-ink-faint max-sm:hidden">
        ⌘K
      </kbd>

      {openList && options.length > 0 && (
        <div className="card absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden p-1.5" style={{ boxShadow: "var(--shadow-lg)" }}>
          {options.map((o, i) => (
            <button
              key={o.id}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                i === highlight ? "bg-sunken" : ""
              }`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => go(o.tagId)}
            >
              <span className="ear-tag">{o.tagId}</span>
              <span className="text-ink-soft">{o.breed}</span>
              <span className="text-xs text-ink-faint">{o.sex === "MALE" ? "♂" : "♀"}</span>
              <span className="ml-auto">
                <StatusBadge status={o.status} />
              </span>
            </button>
          ))}
          <button
            className="mt-1 w-full rounded-lg border-t border-dashed border-rule px-3 py-2 text-left text-xs text-ink-faint hover:bg-sunken"
            onClick={() => {
              router.push(`/pigs?search=${encodeURIComponent(query.trim())}`);
              setOpenList(false);
            }}
          >
            Search all fields for “{query.trim()}” →
          </button>
        </div>
      )}
    </div>
  );
}
