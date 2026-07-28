"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { PigPicker } from "./PigPicker";
import { Icon } from "@/components/ui/NhomaIcons";
import { useQuickAddStore } from "@/stores/quickAdd";
import {
  checkTagAction,
  createPigAction,
  listBreedsAction,
  suggestTagAction,
} from "@/server/actions";

const DOB_SHORTCUTS = [
  { label: "Today", days: 0 },
  { label: "Yesterday", days: 1 },
  { label: "1 wk ago", days: 7 },
  { label: "1 mo ago", days: 30 },
];

function isoDaysAgo(days: number) {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function QuickAddModal() {
  const router = useRouter();
  const { isOpen, defaults, close, setDefaults } = useQuickAddStore();

  const [tagId, setTagId] = useState("");
  const [tagStatus, setTagStatus] = useState<"idle" | "checking" | "ok" | "taken">("idle");
  const [breed, setBreed] = useState("");
  const [breeds, setBreeds] = useState<string[]>([]);
  const [sex, setSex] = useState<"MALE" | "FEMALE" | null>(null);
  const [dob, setDob] = useState(isoDaysAgo(0));
  const [weight, setWeight] = useState("");
  const [mother, setMother] = useState<{ id: string; tagId: string } | null>(null);
  const [father, setFather] = useState<{ id: string; tagId: string } | null>(null);
  const [castrated, setCastrated] = useState(false);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const tagRef = useRef<HTMLInputElement>(null);
  const tagCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialize = useCallback(async () => {
    setBreed(defaults.breed ?? "");
    setDob(defaults.dateOfBirth ?? isoDaysAgo(0));
    setMother(defaults.motherId ? { id: defaults.motherId, tagId: defaults.motherTag ?? "" } : null);
    setFather(defaults.fatherId ? { id: defaults.fatherId, tagId: defaults.fatherTag ?? "" } : null);
    setSex(null);
    setWeight("");
    setCastrated(false);
    setNotes("");
    setErrors({});
    const [tagRes, breedRes] = await Promise.all([suggestTagAction(), listBreedsAction()]);
    if (tagRes.ok) {
      setTagId(tagRes.data);
      setTagStatus("ok");
    }
    if (breedRes.ok) setBreeds(breedRes.data);
    setTimeout(() => tagRef.current?.select(), 60);
  }, [defaults]);

  useEffect(() => {
    if (!isOpen) return;
    // Deferred so opening the modal doesn't cascade a synchronous re-render
    const t = setTimeout(() => {
      setAddedCount(0);
      initialize();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Live duplicate detection, debounced from the input handler
  function onTagChange(value: string) {
    const next = value.toUpperCase();
    setTagId(next);
    if (tagCheckTimer.current) clearTimeout(tagCheckTimer.current);
    if (!next.trim()) {
      setTagStatus("idle");
      return;
    }
    setTagStatus("checking");
    tagCheckTimer.current = setTimeout(async () => {
      const res = await checkTagAction(next.trim());
      if (res.ok) setTagStatus(res.data.available ? "ok" : "taken");
    }, 250);
  }

  async function submit(addAnother: boolean) {
    const errs: Record<string, string> = {};
    if (!tagId.trim()) errs.tagId = "Required";
    if (tagStatus === "taken") errs.tagId = "This tag ID already exists";
    if (!breed.trim()) errs.breed = "Required";
    if (!sex) errs.sex = "Choose a sex";
    if (!dob) errs.dob = "Required";
    else if (new Date(dob) > new Date()) errs.dob = "Cannot be in the future";
    if (weight && (isNaN(Number(weight)) || Number(weight) <= 0)) errs.weight = "Must be a positive number";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setBusy(true);
    const res = await createPigAction({
      tagId: tagId.trim(),
      breed: breed.trim(),
      sex,
      dateOfBirth: dob,
      motherId: mother?.id ?? null,
      fatherId: father?.id ?? null,
      weightKg: weight ? Number(weight) : null,
      castrated: sex === "MALE" ? castrated : null,
      notes: notes || undefined,
    });
    setBusy(false);

    if (!res.ok) {
      toast.error(res.error);
      if (res.code === "DUPLICATE_TAG_ID") setTagStatus("taken");
      return;
    }

    toast.success(`Added ${res.data.tagId}`, {
      action: { label: "View", onClick: () => router.push(`/pigs/${res.data.tagId}`) },
    });
    router.refresh();

    if (addAnother) {
      // Sticky defaults: keep breed / DOB / parents for fast litter entry
      setDefaults({
        breed: breed.trim(),
        dateOfBirth: dob,
        motherId: mother?.id,
        motherTag: mother?.tagId,
        fatherId: father?.id,
        fatherTag: father?.tagId,
      });
      setAddedCount((c) => c + 1);
      setSex(null);
      setWeight("");
      setCastrated(false);
      setNotes("");
      setErrors({});
      const tagRes = await suggestTagAction();
      if (tagRes.ok) {
        setTagId(tagRes.data);
        setTagStatus("ok");
      }
      setTimeout(() => tagRef.current?.select(), 60);
    } else {
      close();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit(true);
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault();
      submit(false);
    }
  }

  return (
    <Modal
      open={isOpen}
      onOpenChange={(o) => !o && close()}
      title="Add pig"
      subtitle={
        addedCount > 0
          ? `${addedCount} added this session — breed, birth date and parents are kept`
          : "Enter ↵ saves · ⌘↵ saves & adds another"
      }
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="qa-tag">Tag ID</label>
            <div className="relative">
              <input
                id="qa-tag"
                ref={tagRef}
                className={`input font-tag ${errors.tagId ? "input-error" : ""}`}
                value={tagId}
                onChange={(e) => onTagChange(e.target.value)}
                autoComplete="off"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs">
                {tagStatus === "checking" && <span className="text-ink-faint">…</span>}
                {tagStatus === "ok" && tagId && <Icon.Check className="text-ok" size={13} />}
                {tagStatus === "taken" && <span className="text-overdue">taken</span>}
              </span>
            </div>
            {errors.tagId && <p className="field-error">{errors.tagId}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="qa-breed">Breed</label>
            <select
              id="qa-breed"
              className={`select ${errors.breed ? "input-error" : ""}`}
              value={breed}
              onChange={(e) => setBreed(e.target.value)}
            >
              <option value="">Select breed…</option>
              {breeds.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            {errors.breed && <p className="field-error">{errors.breed}</p>}
          </div>
        </div>

        <div>
          <span className="field-label">Sex</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Sex">
            {(["FEMALE", "MALE"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={sex === s}
                onClick={() => setSex(s)}
                className={`btn ${sex === s ? "btn-primary" : "btn-secondary"} justify-center text-base`}
              >
                {s === "FEMALE" ? "♀ Female" : "♂ Male"}
              </button>
            ))}
          </div>
          {errors.sex && <p className="field-error">{errors.sex}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="qa-dob">Date of birth</label>
            <input
              id="qa-dob"
              type="date"
              className={`input font-tag ${errors.dob ? "input-error" : ""}`}
              value={dob}
              max={isoDaysAgo(0)}
              onChange={(e) => setDob(e.target.value)}
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {DOB_SHORTCUTS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={`rounded-full border px-2 py-0.5 font-tag text-[10.5px] transition-colors ${
                    dob === isoDaysAgo(s.days)
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-rule-strong text-ink-faint hover:text-ink"
                  }`}
                  onClick={() => setDob(isoDaysAgo(s.days))}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {errors.dob && <p className="field-error">{errors.dob}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="qa-weight">Weight (kg) — optional</label>
            <input
              id="qa-weight"
              className={`input font-tag ${errors.weight ? "input-error" : ""}`}
              inputMode="decimal"
              placeholder="e.g. 12.5"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            {errors.weight && <p className="field-error">{errors.weight}</p>}
            {sex === "MALE" && (
              <label className="mt-2.5 flex items-center gap-2 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={castrated}
                  onChange={(e) => setCastrated(e.target.checked)}
                />
                Castrated
              </label>
            )}
          </div>
        </div>

        {/* Stacked on phones: a half-width column is too narrow for the
            autocomplete panel to show tag + breed without truncating. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PigPicker label="Mother — optional" sex="FEMALE" value={mother} onChange={setMother} />
          <PigPicker label="Father — optional" sex="MALE" value={father} onChange={setFather} />
        </div>

        <div>
          <label className="field-label" htmlFor="qa-notes">Note — optional</label>
          <textarea
            id="qa-notes"
            className="input min-h-16 resize-y"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth remembering about this pig"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-dashed border-rule pt-4">
          <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => submit(true)}
            disabled={busy}
            title="⌘⏎"
          >
            {busy ? "Saving…" : "Save & add another"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => submit(false)}
            disabled={busy}
            title="⏎"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
