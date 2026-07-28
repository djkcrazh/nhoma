"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { recordFarrowingAction } from "@/server/actions";
import { useQuickAddStore } from "@/stores/quickAdd";
import type { Pregnancy } from "./BreedingBoard";

export function FarrowModal({
  pregnancy,
  open,
  onOpenChange,
}: {
  pregnancy: Pregnancy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const openQuickAdd = useQuickAddStore((s) => s.open);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [alive, setAlive] = useState("");
  const [stillborn, setStillborn] = useState("0");
  const [busy, setBusy] = useState(false);

  async function submit(thenAddPiglets: boolean) {
    const a = Number(alive);
    const s = Number(stillborn || 0);
    if (isNaN(a) || a < 0 || !alive) {
      toast.error("Enter the number born alive");
      return;
    }
    setBusy(true);
    const res = await recordFarrowingAction({
      breedingId: pregnancy.id,
      farrowedAt: date,
      bornAlive: a,
      stillborn: s,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${pregnancy.sowTag} farrowed — ${a} alive`);
    router.refresh();
    onOpenChange(false);
    if (thenAddPiglets && a > 0) {
      // Pre-fill Quick Add for rapid consecutive piglet entry
      openQuickAdd({
        breed: pregnancy.sowBreed,
        dateOfBirth: date,
        motherId: pregnancy.sowId,
        motherTag: pregnancy.sowTag,
        fatherId: pregnancy.boarId ?? undefined,
        fatherTag: pregnancy.boarTag ?? undefined,
      });
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Record farrowing — ${pregnancy.sowTag}`}
      subtitle={`Day ${pregnancy.daysPregnant} of ${pregnancy.gestationDays}${pregnancy.isOverdue ? ` (+${pregnancy.overdueDays} overdue)` : ""}`}
    >
      <div className="space-y-4">
        <div>
          <label className="field-label" htmlFor="fw-date">Farrowing date</label>
          <input
            id="fw-date"
            type="date"
            className="input font-tag"
            value={date}
            min={pregnancy.crossingDate.slice(0, 10)}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="fw-alive">Born alive</label>
            <input
              id="fw-alive"
              className="input font-tag text-lg"
              inputMode="numeric"
              autoFocus
              value={alive}
              onChange={(e) => setAlive(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="fw-still">Stillborn</label>
            <input
              id="fw-still"
              className="input font-tag text-lg"
              inputMode="numeric"
              value={stillborn}
              onChange={(e) => setStillborn(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-dashed border-rule pt-4">
          <button className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-secondary" onClick={() => submit(false)} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="btn btn-primary" onClick={() => submit(true)} disabled={busy}>
            {busy ? "Saving…" : "Save & add piglets →"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
