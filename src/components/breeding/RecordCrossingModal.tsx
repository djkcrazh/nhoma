"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { PigPicker } from "@/components/pigs/PigPicker";
import { recordCrossingAction } from "@/server/actions";

export function RecordCrossingModal({
  open,
  onOpenChange,
  presetSow,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetSow?: { id: string; tagId: string } | null;
}) {
  const router = useRouter();
  const [sow, setSow] = useState<{ id: string; tagId: string } | null>(presetSow ?? null);
  const [boar, setBoar] = useState<{ id: string; tagId: string } | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const due = new Date(new Date(date).getTime() + 114 * 86_400_000);

  async function submit() {
    if (!sow) {
      toast.error("Choose a sow");
      return;
    }
    setBusy(true);
    const res = await recordCrossingAction({
      sowId: sow.id,
      boarId: boar?.id ?? null,
      crossingDate: date,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${sow.tagId} crossed — due ${due.toLocaleDateString("en", { month: "short", day: "numeric" })}`);
    router.refresh();
    onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Record crossing"
      subtitle="Gestation runs exactly 114 days from the crossing date"
    >
      <div className="space-y-4">
        <PigPicker label="Sow (female)" sex="FEMALE" value={sow} onChange={setSow} />
        <PigPicker
          label="Boar — optional (AI / off-farm allowed)"
          sex="MALE"
          value={boar}
          onChange={setBoar}
          excludeId={sow?.id}
        />
        <div>
          <label className="field-label" htmlFor="rc-date">Crossing date</label>
          <input
            id="rc-date"
            type="date"
            className="input font-tag"
            max={new Date().toISOString().slice(0, 10)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <p className="mt-1.5 text-xs text-ink-faint">
            Expected farrowing:{" "}
            <span className="font-tag font-semibold text-breeding">
              {due.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </span>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-dashed border-rule pt-4">
          <button className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !sow}>
            {busy ? "Saving…" : "Record crossing"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
