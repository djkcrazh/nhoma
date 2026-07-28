"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { recordWeightAction } from "@/server/actions";

export function RecordWeightModal({
  pig,
  open,
  onOpenChange,
}: {
  pig: { id: string; tagId: string; weightKg?: number | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [weight, setWeight] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const w = Number(weight);
    if (!weight || isNaN(w) || w <= 0) {
      setError("Enter a positive weight");
      return;
    }
    setBusy(true);
    const res = await recordWeightAction({ pigId: pig.id, weightKg: w, measuredAt: date });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.data.weightDropPct) {
      toast.warning(
        `Recorded — note: ${res.data.weightDropPct.toFixed(0)}% below the previous weight`
      );
    } else {
      toast.success(`${pig.tagId}: ${w} kg recorded`);
    }
    router.refresh();
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Record weight — ${pig.tagId}`}
      subtitle={pig.weightKg != null ? `Last recorded: ${pig.weightKg} kg` : "No previous weight"}
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="rw-weight">Weight (kg)</label>
            <input
              id="rw-weight"
              className={`input font-tag text-lg ${error ? "input-error" : ""}`}
              inputMode="decimal"
              autoFocus
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                setError(null);
              }}
            />
            {error && <p className="field-error">{error}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="rw-date">Measured on</label>
            <input
              id="rw-date"
              type="date"
              className="input font-tag"
              max={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-dashed border-rule pt-4">
          <button className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save weight"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
