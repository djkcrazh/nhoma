"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EarTag } from "@/components/ui/EarTag";
import { ConfirmDialog } from "@/components/ui/Modal";
import { RecordWeightModal } from "./RecordWeightModal";
import { RecordCrossingModal } from "@/components/breeding/RecordCrossingModal";
import { EditPigModal } from "./EditPigModal";
import { WeightChart } from "./WeightChart";
import { PigFamilyTreeModal } from "./PigFamilyTreeModal";
import { useQuickAddStore } from "@/stores/quickAdd";
import { addNoteAction, markDeadAction, markSoldAction } from "@/server/actions";
import type { getPigByTag } from "@/server/services/pig.service";
import { Icon } from "@/components/ui/NhomaIcons";

type ProfilePig = NonNullable<Awaited<ReturnType<typeof getPigByTag>>>;

const SEVERITY_VARIANT: Record<string, string> = {
  critical: "overdue",
  warning: "due",
  success: "ok",
  info: "breeding",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

export function PigProfile({ pig, isAdmin }: { pig: ProfilePig; isAdmin: boolean }) {
  const router = useRouter();
  const openQuickAdd = useQuickAddStore((s) => s.open);
  const [weighOpen, setWeighOpen] = useState(false);
  const [crossOpen, setCrossOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [confirm, setConfirm] = useState<"sold" | "dead" | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const closed = pig.status === "SOLD" || pig.status === "DEAD";

  async function closePig(kind: "sold" | "dead") {
    setBusy(true);
    const res = kind === "sold" ? await markSoldAction(pig.id) : await markDeadAction(pig.id);
    setBusy(false);
    setConfirm(null);
    if (res.ok) {
      toast.success(`${pig.tagId} marked ${kind}`);
      router.refresh();
    } else toast.error(res.error);
  }

  async function submitNote() {
    if (!noteBody.trim()) return;
    setNoteBusy(true);
    const res = await addNoteAction({ pigId: pig.id, body: noteBody.trim() });
    setNoteBusy(false);
    if (res.ok) {
      setNoteBody("");
      toast.success("Note added");
      router.refresh();
    } else toast.error(res.error);
  }

  const g = pig.gestation;
  const gestPct = g ? Math.min(100, Math.round((g.daysPregnant / 114) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <Icon.Pigs size={30} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display font-tag text-2xl font-bold tracking-tight">{pig.tagId}</h1>
                <StatusBadge status={pig.status} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {pig.breed} · {pig.sex === "FEMALE" ? "♀ Female" : "♂ Male"} · {pig.ageLabel} old · born{" "}
                {fmtDate(pig.dateOfBirth)}
                {pig.sex === "MALE" && pig.castrated && " · castrated"}
              </p>
              {pig.warnings.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pig.warnings.map((w) => (
                    <span key={w.type} className={`status-badge status-badge--${SEVERITY_VARIANT[w.severity]}`}>
                      <span className="dot" />
                      {w.message}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          {!closed && (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => setWeighOpen(true)}>
                <Icon.Weight size={15} /> Record weight
              </button>
              {pig.sex === "FEMALE" && !g && (
                <button className="btn btn-secondary btn-sm" onClick={() => setCrossOpen(true)}>
                  <Icon.Breeding size={15} /> Record crossing
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}>
                <Icon.Edit size={15} /> Edit
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirm("sold")}>
                Mark sold
              </button>
              <button className="btn btn-ghost btn-sm text-overdue" onClick={() => setConfirm("dead")}>
                Mark dead
              </button>
            </div>
          )}
        </div>

        {/* Key figures strip */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-dashed border-rule pt-4 sm:grid-cols-4">
          <Figure label="Current weight" value={pig.weightKg != null ? `${pig.weightKg} kg` : "—"} sub={pig.lastWeighedAt ? `weighed ${fmtDate(pig.lastWeighedAt)}` : "never weighed"} />
          <Figure label="Age" value={pig.ageLabel} sub={`${pig.ageDays} days`} />
          <Figure
            label="Market ready"
            value={pig.marketReady ? "Yes ✓" : "Not yet"}
            sub={pig.breedingStock ? "kept as breeding stock" : undefined}
          />
          {g ? (
            <Figure
              label={g.isOverdue ? "Overdue" : "Days to farrowing"}
              value={g.isOverdue ? `+${g.overdueDays}d` : `${g.daysRemaining}d`}
              sub={`due ${fmtDate(g.expectedFarrowingDate)}`}
            />
          ) : (
            <Figure label="Offspring" value={String(pig.offspring.length)} sub={pig.siblings.length ? `${pig.siblings.length} siblings` : undefined} />
          )}
        </div>

        {/* Pregnancy progress bar */}
        {g && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between font-tag text-[11px] text-ink-faint">
              <span>crossed {fmtDate(pig.breedingHistory.find((b) => b.status === "ACTIVE")?.crossingDate ?? pig.dateOfBirth)}</span>
              <span className={g.isOverdue ? "font-bold text-overdue" : ""}>
                day {g.daysPregnant} of 114 {g.isOverdue && `(+${g.overdueDays} overdue)`}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${gestPct}%`,
                  background: g.isOverdue ? "var(--overdue)" : g.daysRemaining <= 7 ? "var(--due)" : "var(--breeding)",
                }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Tabs */}
      <Tabs.Root defaultValue="overview">
        <Tabs.List className="flex flex-wrap gap-1 border-b-2 border-rule" aria-label="Pig detail sections">
          {[
            ["overview", "Overview"],
            ["lineage", "Lineage"],
            ["breeding", `Breeding (${pig.breedingHistory.length + pig.siredBreedings.length})`],
            ["weights", `Weights (${pig.weightHistory.length})`],
            ["notes", `Notes (${pig.notes.length})`],
            ["activity", "Activity"],
          ].map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="rounded-t-lg px-4 py-2.5 text-sm font-semibold text-ink-faint transition-colors hover:text-ink data-[state=active]:-mb-0.5 data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-accent"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Overview */}
        <Tabs.Content value="overview" className="pt-4 outline-none">
          <div className="grid gap-4 md:grid-cols-2">
            <section className="card p-5">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
                Record
              </h3>
              <dl className="space-y-2.5 text-sm">
                <Row k="Tag ID"><span className="font-tag font-semibold">{pig.tagId}</span></Row>
                <Row k="Breed">{pig.breed}</Row>
                <Row k="Sex">{pig.sex === "FEMALE" ? "Female ♀" : "Male ♂"}</Row>
                <Row k="Born">{fmtDate(pig.dateOfBirth)}</Row>
                {pig.sex === "MALE" && <Row k="Castrated">{pig.castrated ? "Yes" : "No"}</Row>}
                <Row k="Breeding stock">{pig.breedingStock ? "Yes — excluded from market list" : "No"}</Row>
                {pig.soldAt && <Row k="Sold">{fmtDate(pig.soldAt)}</Row>}
                {pig.diedAt && <Row k="Died">{fmtDate(pig.diedAt)}</Row>}
                <Row k="On ledger since">{fmtDate(pig.createdAt)}</Row>
              </dl>
            </section>
            <section className="card p-5">
              <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
                Market status
              </h3>
              {pig.marketReady ? (
                <p className="alert-stripe alert-stripe--success rounded-lg bg-ok-soft px-4 py-3 text-sm">
                  Meets both thresholds — ready for market.
                </p>
              ) : (
                <p className="rounded-lg bg-sunken px-4 py-3 text-sm text-ink-soft">
                  {pig.breedingStock
                    ? "Flagged as breeding stock, so excluded from the market list."
                    : "Below the market weight and/or age thresholds set by your admin."}
                </p>
              )}
              <h3 className="mb-3 mt-5 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
                Latest weights
              </h3>
              {pig.weightHistory.length ? (
                <div>
                  {pig.weightHistory.slice(0, 4).map((w, i) => (
                    <div key={w.id} className="ledger-row">
                      <span className="ledger-num">{String(pig.weightHistory.length - i).padStart(2, "0")}</span>
                      <span className="font-tag text-sm font-semibold">{w.weightKg} kg</span>
                      <span className="ml-auto text-xs text-ink-faint">{fmtDate(w.measuredAt)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-faint">No weights recorded yet.</p>
              )}
            </section>
          </div>
        </Tabs.Content>

        {/* Lineage */}
        <Tabs.Content value="lineage" className="pt-4 outline-none">
          <div className="mb-4 flex justify-end">
            <button className="btn btn-secondary btn-sm" onClick={() => setTreeOpen(true)}>
              <Icon.FamilyTree size={15} /> View family tree
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <LineageCard title="Parents">
              {pig.mother || pig.father ? (
                <div className="space-y-2">
                  {pig.mother && (
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-xs text-ink-faint">Mother</span>
                      <EarTag tagId={pig.mother.tagId} removed={pig.mother.removed} />
                      <span className="text-xs text-ink-soft">{pig.mother.breed}</span>
                    </div>
                  )}
                  {pig.father && (
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-xs text-ink-faint">Father</span>
                      <EarTag tagId={pig.father.tagId} removed={pig.father.removed} />
                      <span className="text-xs text-ink-soft">{pig.father.breed}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-ink-faint">No parents recorded.</p>
              )}
            </LineageCard>
            <LineageCard title={`Siblings (${pig.siblings.length})`}>
              {pig.siblings.length ? (
                <MiniPigList pigs={pig.siblings} />
              ) : (
                <p className="text-sm text-ink-faint">No known siblings.</p>
              )}
            </LineageCard>
            <LineageCard title={`Offspring (${pig.offspring.length})`}>
              {pig.offspring.length ? (
                <MiniPigList pigs={pig.offspring} />
              ) : (
                <div>
                  <p className="text-sm text-ink-faint">No offspring on the ledger.</p>
                  {pig.sex === "FEMALE" && !closed && (
                    <button
                      className="btn btn-secondary btn-sm mt-3"
                      onClick={() =>
                        openQuickAdd({ motherId: pig.id, motherTag: pig.tagId, breed: pig.breed })
                      }
                    >
                      <Icon.Plus size={14} /> Add piglet with {pig.tagId} as mother
                    </button>
                  )}
                </div>
              )}
            </LineageCard>
          </div>
        </Tabs.Content>

        {/* Breeding */}
        <Tabs.Content value="breeding" className="pt-4 outline-none">
          <section className="card p-5">
            <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
              {pig.sex === "FEMALE" ? "Crossings as sow" : "Crossings as boar"}
            </h3>
            {pig.sex === "FEMALE" ? (
              pig.breedingHistory.length ? (
                <table className="data-table">
                  <thead>
                    <tr><th>Crossed</th><th>Boar</th><th>Outcome</th><th>Litter</th></tr>
                  </thead>
                  <tbody>
                    {pig.breedingHistory.map((b) => (
                      <tr key={b.id}>
                        <td className="font-tag text-xs">{fmtDate(b.crossingDate)}</td>
                        <td>{b.boarTag ? <EarTag tagId={b.boarTag} neutral /> : <span className="text-ink-faint">AI / unknown</span>}</td>
                        <td>
                          <span className={`status-badge status-badge--${b.status === "ACTIVE" ? "breeding" : b.status === "FARROWED" ? "ok" : "overdue"}`}>
                            <span className="dot" />{b.status.toLowerCase()}
                          </span>
                        </td>
                        <td className="text-sm">
                          {b.litter
                            ? `${b.litter.bornAlive} alive, ${b.litter.stillborn} stillborn — ${fmtDate(b.litter.farrowedAt)}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-ink-faint">No crossings recorded.</p>
              )
            ) : pig.siredBreedings.length ? (
              <table className="data-table">
                <thead>
                  <tr><th>Crossed</th><th>Sow</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {pig.siredBreedings.map((b) => (
                    <tr key={b.id}>
                      <td className="font-tag text-xs">{fmtDate(b.crossingDate)}</td>
                      <td><EarTag tagId={b.sowTag} neutral /></td>
                      <td>
                        <span className={`status-badge status-badge--${b.status === "ACTIVE" ? "breeding" : b.status === "FARROWED" ? "ok" : "overdue"}`}>
                          <span className="dot" />{b.status.toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-ink-faint">Has not sired any recorded crossings.</p>
            )}
          </section>
        </Tabs.Content>

        {/* Weights */}
        <Tabs.Content value="weights" className="pt-4 outline-none">
          <section className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink-soft">
                Weight history
              </h3>
              {!closed && (
                <button className="btn btn-primary btn-sm" onClick={() => setWeighOpen(true)}>
                  <Icon.Plus size={14} /> Add weight
                </button>
              )}
            </div>
            {pig.weightHistory.length > 1 && <WeightChart data={pig.weightHistory} />}
            {pig.weightHistory.length ? (
              <div className="mt-4">
                {pig.weightHistory.map((w, i) => {
                  const prev = pig.weightHistory[i + 1];
                  const delta = prev ? w.weightKg - prev.weightKg : null;
                  return (
                    <div key={w.id} className="ledger-row">
                      <span className="ledger-num">{String(pig.weightHistory.length - i).padStart(2, "0")}</span>
                      <span className="font-tag text-sm font-semibold">{w.weightKg} kg</span>
                      {delta !== null && (
                        <span className={`font-tag text-xs ${delta >= 0 ? "text-ok" : "text-overdue"}`}>
                          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-ink-faint">{fmtDate(w.measuredAt)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No weights recorded yet.</p>
            )}
          </section>
        </Tabs.Content>

        {/* Notes */}
        <Tabs.Content value="notes" className="pt-4 outline-none">
          <section className="card p-5">
            {!closed && (
              <div className="mb-4 flex gap-2">
                <input
                  className="input"
                  placeholder="Write a note…"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitNote()}
                />
                <button className="btn btn-primary" onClick={submitNote} disabled={noteBusy || !noteBody.trim()}>
                  Add
                </button>
              </div>
            )}
            {pig.notes.length ? (
              <div>
                {pig.notes.map((n, i) => (
                  <div key={n.id} className="ledger-row">
                    <span className="ledger-num">{String(pig.notes.length - i).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">{n.author} · {fmtDate(n.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No notes yet.</p>
            )}
          </section>
        </Tabs.Content>

        {/* Activity */}
        <Tabs.Content value="activity" className="pt-4 outline-none">
          <section className="card p-5">
            {pig.activity.length ? (
              <div>
                {pig.activity.map((a, i) => (
                  <div key={a.id} className="ledger-row">
                    <span className="ledger-num">{String(pig.activity.length - i).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{a.summary}</p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {a.user} · {new Date(a.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="verb-stamp self-start text-ink-faint">{a.action}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No recorded activity.</p>
            )}
          </section>
        </Tabs.Content>
      </Tabs.Root>

      {/* Modals */}
      {weighOpen && (
        <RecordWeightModal pig={pig} open onOpenChange={setWeighOpen} />
      )}
      {crossOpen && (
        <RecordCrossingModal open onOpenChange={setCrossOpen} presetSow={{ id: pig.id, tagId: pig.tagId }} />
      )}
      {editOpen && <EditPigModal pig={pig} open onOpenChange={setEditOpen} isAdmin={isAdmin} />}
      {treeOpen && <PigFamilyTreeModal open onOpenChange={setTreeOpen} tagId={pig.tagId} />}
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={`Mark ${pig.tagId} as ${confirm}?`}
          message={
            pig.gestation
              ? "This sow has an active pregnancy — it will be closed as failed."
              : confirm === "sold"
                ? "The pig moves to the sold ledger."
                : "This records a death on the ledger."
          }
          danger={confirm === "dead"}
          busy={busy}
          confirmLabel="Yes, continue"
          onConfirm={() => closePig(confirm)}
        />
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="font-tag text-[10px] font-semibold uppercase tracking-widest text-ink-faint">{label}</div>
      <div className="font-display mt-0.5 text-lg font-bold">{value}</div>
      {sub && <div className="text-[11px] text-ink-faint">{sub}</div>}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-rule pb-2 last:border-none">
      <dt className="text-ink-faint">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function LineageCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wide text-ink-soft">{title}</h3>
      {children}
    </section>
  );
}

function MiniPigList({
  pigs,
}: {
  pigs: { id: string; tagId: string; sex: string; ageLabel: string; status: string }[];
}) {
  return (
    <div className="max-h-64 space-y-1.5 overflow-y-auto">
      {pigs.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <EarTag tagId={p.tagId} />
          <span className="text-xs text-ink-faint">{p.sex === "FEMALE" ? "♀" : "♂"} {p.ageLabel}</span>
          <span className="ml-auto"><StatusBadge status={p.status} /></span>
        </div>
      ))}
    </div>
  );
}
