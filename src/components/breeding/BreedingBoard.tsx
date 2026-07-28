"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EarTag } from "@/components/ui/EarTag";
import { ConfirmDialog } from "@/components/ui/Modal";
import { RecordCrossingModal } from "./RecordCrossingModal";
import { FarrowModal } from "./FarrowModal";
import { closeBreedingAction } from "@/server/actions";
import { Icon } from "@/components/ui/NhomaIcons";

export interface Pregnancy {
  id: string;
  sowId: string;
  sowTag: string;
  sowBreed: string;
  boarId: string | null;
  boarTag: string | null;
  crossingDate: string;
  daysPregnant: number;
  daysRemaining: number;
  expectedFarrowingDate: string;
  isOverdue: boolean;
  overdueDays: number;
  gestationDays: number;
}

interface Litter {
  id: string;
  sowTag: string;
  farrowedAt: string;
  bornAlive: number;
  stillborn: number;
}

interface CrossReadyPig {
  id: string;
  tagId: string;
  breed: string;
  ageLabel: string;
  weightKg: number | null;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function BreedingBoard({
  pregnancies,
  litters,
  crossReady,
}: {
  pregnancies: Pregnancy[];
  litters: Litter[];
  crossReady: CrossReadyPig[];
}) {
  const router = useRouter();
  const [crossOpen, setCrossOpen] = useState(false);
  const [presetSow, setPresetSow] = useState<{ id: string; tagId: string } | null>(null);
  const [farrowing, setFarrowing] = useState<Pregnancy | null>(null);
  const [closing, setClosing] = useState<Pregnancy | null>(null);
  const [busy, setBusy] = useState(false);

  const overdue = pregnancies.filter((p) => p.isOverdue);
  const dueSoon = pregnancies.filter((p) => !p.isOverdue && p.daysRemaining <= 7);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Breeding</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {pregnancies.length} active pregnanc{pregnancies.length === 1 ? "y" : "ies"}
            {overdue.length > 0 && (
              <span className="ml-2 font-semibold text-overdue">· {overdue.length} overdue</span>
            )}
            {dueSoon.length > 0 && (
              <span className="ml-2 font-semibold text-due">· {dueSoon.length} due within a week</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn btn-secondary" href="/api/breeding/export" download>
            Export CSV
          </a>
          <button
            className="btn btn-primary"
            onClick={() => {
              setPresetSow(null);
              setCrossOpen(true);
            }}
          >
            <Icon.Breeding size={15} /> Record crossing
          </button>
        </div>
      </div>

      {/* Active pregnancies */}
      <section className="card p-5">
        <h2 className="mb-4 font-display text-base font-bold">Active pregnancies — due soonest first</h2>
        {pregnancies.length === 0 ? (
          <p className="rounded-lg bg-sunken px-4 py-8 text-center text-sm text-ink-faint">
            No active pregnancies. Record a crossing to start the 114-day countdown.
          </p>
        ) : (
          <div className="space-y-4">
            {pregnancies.map((p) => {
              const pct = Math.min(100, Math.round((p.daysPregnant / p.gestationDays) * 100));
              const barColor = p.isOverdue
                ? "var(--overdue)"
                : p.daysRemaining <= 7
                  ? "var(--due)"
                  : "var(--breeding)";
              return (
                <div
                  key={p.id}
                  className={`alert-stripe rounded-xl border border-rule p-4 ${
                    p.isOverdue
                      ? "alert-stripe--critical"
                      : p.daysRemaining <= 7
                        ? "alert-stripe--warning"
                        : "alert-stripe--info"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <EarTag tagId={p.sowTag} />
                    <span className="text-sm text-ink-soft">{p.sowBreed}</span>
                    {p.boarTag && (
                      <span className="text-xs text-ink-faint">
                        × <EarTag tagId={p.boarTag} neutral />
                      </span>
                    )}
                    <span className="ml-auto font-tag text-xs text-ink-faint">
                      crossed {fmtDate(p.crossingDate)} · due {fmtDate(p.expectedFarrowingDate)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex-1">
                      <div className="mb-1 flex justify-between font-tag text-[11px]">
                        <span className="text-ink-faint">day {p.daysPregnant} of {p.gestationDays}</span>
                        <span className={p.isOverdue ? "font-bold text-overdue" : p.daysRemaining <= 7 ? "font-bold text-due" : "text-ink-soft"}>
                          {p.isOverdue ? `+${p.overdueDays}d overdue` : `${p.daysRemaining}d remaining`}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn btn-primary btn-sm flex-1 sm:flex-none" onClick={() => setFarrowing(p)}>
                        Record farrowing
                      </button>
                      <button className="btn btn-ghost btn-sm text-overdue flex-1 sm:flex-none" onClick={() => setClosing(p)}>
                        Failed / lost
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ready for crossing */}
        <section className="card p-5">
          <h2 className="mb-3 font-display text-base font-bold">Sows ready for crossing</h2>
          {crossReady.length === 0 ? (
            <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-ink-faint">
              No sows currently eligible.
            </p>
          ) : (
            <div className="space-y-2">
              {crossReady.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border border-rule px-3 py-2">
                  <EarTag tagId={s.tagId} />
                  <span className="text-xs text-ink-soft">{s.breed}</span>
                  <span className="font-tag text-xs text-ink-faint">
                    {s.ageLabel}{s.weightKg != null && ` · ${s.weightKg} kg`}
                  </span>
                  <button
                    className="btn btn-secondary btn-sm ml-auto"
                    onClick={() => {
                      setPresetSow({ id: s.id, tagId: s.tagId });
                      setCrossOpen(true);
                    }}
                  >
                    Cross
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent litters */}
        <section className="card p-5">
          <h2 className="mb-3 font-display text-base font-bold">Recent litters</h2>
          {litters.length === 0 ? (
            <p className="rounded-lg bg-sunken px-4 py-6 text-center text-sm text-ink-faint">
              No litters recorded yet.
            </p>
          ) : (
            <div>
              {litters.map((l, i) => (
                <div key={l.id} className="ledger-row">
                  <span className="ledger-num">{String(litters.length - i).padStart(2, "0")}</span>
                  <EarTag tagId={l.sowTag} />
                  <span className="text-sm">
                    <span className="font-tag font-semibold text-ok">{l.bornAlive}</span> alive
                    {l.stillborn > 0 && (
                      <span className="text-ink-faint">, {l.stillborn} stillborn</span>
                    )}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">{fmtDate(l.farrowedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Modals */}
      {crossOpen && (
        <RecordCrossingModal open onOpenChange={setCrossOpen} presetSow={presetSow} />
      )}
      {farrowing && <FarrowModal pregnancy={farrowing} open onOpenChange={(o) => !o && setFarrowing(null)} />}
      {closing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setClosing(null)}
          title={`Close ${closing.sowTag}'s pregnancy?`}
          message="Marks the pregnancy as failed. The sow returns to the regular herd list and can be crossed again."
          danger
          busy={busy}
          confirmLabel="Mark failed"
          onConfirm={async () => {
            setBusy(true);
            const res = await closeBreedingAction({ breedingId: closing.id, status: "FAILED" });
            setBusy(false);
            setClosing(null);
            if (res.ok) toast.success(`${closing.sowTag}'s pregnancy closed`);
            else toast.error(res.error);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
