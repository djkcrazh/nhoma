"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { PigPicker } from "./PigPicker";
import { listBreedsAction, updatePigAction } from "@/server/actions";

interface EditablePig {
  id: string;
  tagId: string;
  breed: string;
  sex: "MALE" | "FEMALE";
  dateOfBirth: string;
  mother: { id: string; tagId: string } | null;
  father: { id: string; tagId: string } | null;
  castrated: boolean | null;
  readyForCrossing: boolean;
  breedingStock: boolean;
  status: string;
}

export function EditPigModal({
  pig,
  open,
  onOpenChange,
}: {
  pig: EditablePig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [tagId, setTagId] = useState(pig.tagId);
  const [breed, setBreed] = useState(pig.breed);
  const [breeds, setBreeds] = useState<string[]>([]);
  const [dob, setDob] = useState(pig.dateOfBirth.slice(0, 10));
  const [mother, setMother] = useState(pig.mother);
  const [father, setFather] = useState(pig.father);
  const [castrated, setCastrated] = useState(!!pig.castrated);
  const [readyForCrossing, setReadyForCrossing] = useState(pig.readyForCrossing);
  const [breedingStock, setBreedingStock] = useState(pig.breedingStock);
  const [inactive, setInactive] = useState(pig.status === "INACTIVE");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listBreedsAction().then((res) => {
      if (res.ok) setBreeds(res.data);
    });
  }, []);

  async function submit() {
    if (!breed.trim()) {
      toast.error("Breed is required");
      return;
    }
    setBusy(true);
    const res = await updatePigAction(pig.id, {
      tagId: tagId.trim(),
      breed: breed.trim(),
      dateOfBirth: dob,
      motherId: mother?.id ?? null,
      fatherId: father?.id ?? null,
      ...(pig.sex === "MALE" ? { castrated } : {}),
      readyForCrossing,
      breedingStock,
      ...(inactive !== (pig.status === "INACTIVE")
        ? { status: inactive ? ("INACTIVE" as const) : ("HEALTHY" as const) }
        : {}),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`${tagId} updated`);
    router.refresh();
    onOpenChange(false);
    if (tagId.trim() !== pig.tagId) router.push(`/pigs/${encodeURIComponent(tagId.trim())}`);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Edit ${pig.tagId}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Tag ID</label>
            <input className="input font-tag" value={tagId} onChange={(e) => setTagId(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="field-label">Breed</label>
            <select className="select" value={breed} onChange={(e) => setBreed(e.target.value)}>
              {!breeds.includes(breed) && breed && <option value={breed}>{breed}</option>}
              <option value="">Select breed…</option>
              {breeds.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="field-label">Date of birth</label>
          <input
            type="date"
            className="input font-tag"
            value={dob}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDob(e.target.value)}
          />
        </div>
        {/* Stacked on phones — see QuickAddModal for the reasoning. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PigPicker label="Mother" sex="FEMALE" value={mother} onChange={setMother} excludeId={pig.id} />
          <PigPicker label="Father" sex="MALE" value={father} onChange={setFather} excludeId={pig.id} />
        </div>
        <div className="space-y-2 rounded-lg bg-sunken p-3.5">
          {pig.sex === "MALE" && (
            <Check label="Castrated" checked={castrated} onChange={setCastrated} />
          )}
          {pig.sex === "FEMALE" && (
            <Check label="Ready for crossing (manual flag)" checked={readyForCrossing} onChange={setReadyForCrossing} />
          )}
          <Check label="Breeding stock — never list as market ready" checked={breedingStock} onChange={setBreedingStock} />
          <Check label="Inactive — hide from active lists" checked={inactive} onChange={setInactive} />
        </div>
        <div className="flex justify-end gap-2 border-t border-dashed border-rule pt-4">
          <button className="btn btn-ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        className="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
