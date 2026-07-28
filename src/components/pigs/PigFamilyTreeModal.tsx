"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/NhomaIcons";
import { getPigLineageAction } from "@/server/actions";
import type { getPigLineage } from "@/server/services/pig.service";

type Lineage = NonNullable<Awaited<ReturnType<typeof getPigLineage>>>;
type LineageNode = Lineage["self"];

export function PigFamilyTreeModal({
  open,
  onOpenChange,
  tagId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tagId: string;
}) {
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHistory([]);
    load(tagId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tagId]);

  async function load(nextTagId: string, pushCurrent?: string) {
    setLoading(true);
    setError(null);
    const res = await getPigLineageAction(nextTagId);
    setLoading(false);
    if (!res.ok || !res.data) {
      setError(res.ok ? "Pig not found." : res.error);
      return;
    }
    setLineage(res.data);
    if (pushCurrent) setHistory((h) => [...h, pushCurrent]);
  }

  function goTo(node: LineageNode | null) {
    if (!node || node.removed || !lineage) return;
    load(node.tagId, lineage.self.tagId);
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      load(prev);
      return h.slice(0, -1);
    });
  }

  const siblings = lineage?.siblings ?? [];
  const offspring = lineage?.offspring ?? [];

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Family tree"
      subtitle={lineage ? `${lineage.self.tagId} · ${lineage.self.breed}` : undefined}
    >
      <div className="flex min-h-[340px] flex-col">
        <div className="mb-3 flex items-center justify-between">
          <button
            className="btn btn-ghost btn-sm"
            onClick={goBack}
            disabled={history.length === 0 || loading}
          >
            <Icon.ChevronDown className="rotate-90" size={14} /> Back
          </button>
          {lineage && (
            <Link href={`/pigs/${lineage.self.tagId}`} className="btn btn-secondary btn-sm">
              View full profile
            </Link>
          )}
        </div>

        {error && <p className="rounded-lg bg-sunken px-4 py-3 text-sm text-overdue">{error}</p>}

        {lineage && !error && (
          <div key={lineage.self.id} className={`flex-1 space-y-1 ${loading ? "opacity-50" : "tree-snap"}`}>
            <div className="text-center text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
              Parents
            </div>
            <div className="tree-row justify-center">
              <TreeNode node={lineage.mother} fallbackLabel="Mother" onSelect={goTo} />
              <TreeNode node={lineage.father} fallbackLabel="Father" onSelect={goTo} />
            </div>

            <Connector />

            {/* This generation: self anchored on the left, siblings scroll alongside it */}
            <div className="flex items-start">
              <div className="tree-node-col">
                <TreeNode node={lineage.self} isSelf />
              </div>
              {siblings.length > 0 && (
                <>
                  <div className="tree-node-col__divider" aria-hidden />
                  <div className="tree-row tree-row--inline">
                    {siblings.map((s) => (
                      <TreeNode key={s.id} node={s} onSelect={goTo} />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Children stem directly below self, never below the siblings */}
            {offspring.length > 0 && (
              <>
                <div className="tree-node-col">
                  <Connector />
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">
                    Children ({offspring.length})
                  </div>
                </div>
                <div className="tree-row">
                  {offspring.map((c) => (
                    <TreeNode key={c.id} node={c} onSelect={goTo} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {!lineage && !error && (
          <div className="flex flex-1 items-center justify-center">
            <div className="skeleton h-12 w-40" />
          </div>
        )}
      </div>
    </Modal>
  );
}

function Connector() {
  return <div className="mx-auto h-5 w-px bg-[var(--rule-strong)]" aria-hidden />;
}

function TreeNode({
  node,
  fallbackLabel,
  isSelf,
  onSelect,
}: {
  node: LineageNode | null;
  fallbackLabel?: string;
  isSelf?: boolean;
  onSelect?: (node: LineageNode | null) => void;
}) {
  if (!node) {
    return (
      <div className="tree-node tree-node--empty">
        <div className="flex flex-col items-center gap-1.5">
          <div className="tree-node__ring">
            <Icon.Pigs size={20} />
          </div>
          <span className="text-center text-[10px] leading-tight text-ink-faint">{fallbackLabel ?? "Unknown"}</span>
        </div>
      </div>
    );
  }

  const sexSymbol = node.sex === "FEMALE" ? "♀" : "♂";
  const clickable = !isSelf && !node.removed && !!onSelect;

  const body = (
    <>
      <div className="tree-node__ring">
        <Icon.Pigs size={22} />
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
          style={{ background: "var(--ground-raised)", border: "1px solid var(--rule-strong)" }}
        >
          {sexSymbol}
        </span>
      </div>
      <span className="font-tag text-center text-[11px] font-semibold leading-tight">{node.tagId}</span>
      <span className="text-center text-[10px] leading-tight text-ink-faint">{node.ageLabel}</span>
    </>
  );

  return (
    <div className={`tree-node ${isSelf ? "tree-node--self" : ""}`}>
      {clickable ? (
        <button
          type="button"
          className="tree-node__btn"
          onClick={() => onSelect?.(node)}
          aria-label={`View ${node.tagId}'s family tree`}
        >
          <div className="relative flex flex-col items-center gap-1.5">{body}</div>
        </button>
      ) : (
        <div className="relative flex flex-col items-center gap-1.5">{body}</div>
      )}
    </div>
  );
}
