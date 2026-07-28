"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FarmSettings } from "@/lib/domain/types";
import { Modal, ConfirmDialog } from "@/components/ui/Modal";
import {
  createBreedAction,
  createUserAction,
  deleteBreedAction,
  deleteUserAction,
  renameBreedAction,
  updateSettingsAction,
  updateUserAction,
} from "@/server/actions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface BreedRow {
  id: string;
  name: string;
}

const THRESHOLD_FIELDS: {
  key: keyof FarmSettings;
  label: string;
  unit: string;
  help: string;
}[] = [
  { key: "marketMinWeightKg", label: "Market weight", unit: "kg", help: "Minimum weight before a pig counts as market ready" },
  { key: "marketMinAgeDays", label: "Market age", unit: "days", help: "Minimum age before a pig counts as market ready" },
  { key: "breedingMinWeightKgFemale", label: "Breeding weight (sows)", unit: "kg", help: "Minimum weight before a sow is breeding-eligible" },
  { key: "breedingMinAgeDaysFemale", label: "Breeding age (sows)", unit: "days", help: "Minimum age before a sow is breeding-eligible" },
  { key: "pigletMaxAgeDays", label: "Piglet cutoff", unit: "days", help: "Pigs younger than this show as piglets" },
  { key: "staleWeightDays", label: "Stale weight alert", unit: "days", help: "Warn when a pig hasn't been weighed for this long" },
  { key: "overdueGraceDays", label: "Overdue grace", unit: "days", help: "Days past 114 before a pregnancy is flagged overdue" },
];

export function SettingsPanel({
  settings,
  users,
  breeds,
  currentUserId,
}: {
  settings: FarmSettings;
  users: UserRow[];
  breeds: BreedRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, String(settings[f.key])]))
  );
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [userModal, setUserModal] = useState<"create" | UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveThresholds() {
    setSavingThresholds(true);
    const res = await updateSettingsAction(
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))
    );
    setSavingThresholds(false);
    if (res.ok) {
      toast.success("Thresholds saved — herd statuses recomputed");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="space-y-6">
      {/* Thresholds */}
      <section className="card p-5">
        <h2 className="mb-1 font-display text-base font-bold">Automation thresholds</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Gestation is fixed at <span className="font-tag font-semibold">114 days</span>.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {THRESHOLD_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="field-label" htmlFor={`s-${f.key}`}>
                {f.label} ({f.unit})
              </label>
              <input
                id={`s-${f.key}`}
                className="input font-tag"
                inputMode="decimal"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
              <p className="mt-1 text-[11px] text-ink-faint">{f.help}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end border-t border-dashed border-rule pt-4">
          <button className="btn btn-primary" onClick={saveThresholds} disabled={savingThresholds}>
            {savingThresholds ? "Saving…" : "Save thresholds"}
          </button>
        </div>
      </section>

      {/* Breeds */}
      <BreedManager breeds={breeds} />

      {/* Users */}
      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">Users</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setUserModal("create")}>
            ＋ Add user
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold">
                    {u.name}
                    {u.id === currentUserId && <span className="ml-1.5 text-xs text-ink-faint">(you)</span>}
                  </td>
                  <td className="font-tag text-xs">{u.email}</td>
                  <td>
                    <span className={`status-badge ${u.role === "ADMIN" ? "status-badge--accent" : "status-badge--neutral"}`}>
                      <span className="dot" />
                      {u.role === "ADMIN" ? "Admin" : "Farm user"}
                    </span>
                  </td>
                  <td>
                    {u.isActive ? (
                      <span className="text-xs text-ok">active</span>
                    ) : (
                      <span className="text-xs text-ink-faint">deactivated</span>
                    )}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => setUserModal(u)}>
                      Edit
                    </button>
                    {u.id !== currentUserId && u.isActive && (
                      <button className="btn btn-ghost btn-sm text-overdue" onClick={() => setDeleting(u)}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {userModal && (
        <UserModal
          user={userModal === "create" ? null : userModal}
          onClose={() => setUserModal(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Deactivate ${deleting.name}?`}
          message="They will no longer be able to sign in. Their history stays on the audit ledger."
          danger
          busy={busy}
          confirmLabel="Deactivate"
          onConfirm={async () => {
            setBusy(true);
            const res = await deleteUserAction(deleting.id);
            setBusy(false);
            setDeleting(null);
            if (res.ok) toast.success(`${deleting.name} deactivated`);
            else toast.error(res.error);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BreedManager({ breeds }: { breeds: BreedRow[] }) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleting, setDeleting] = useState<BreedRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function addBreed() {
    const name = newName.trim();
    if (!name) return;
    setAddBusy(true);
    const res = await createBreedAction({ name });
    setAddBusy(false);
    if (res.ok) {
      toast.success(`Added breed "${name}"`);
      setNewName("");
      router.refresh();
    } else toast.error(res.error);
  }

  async function saveRename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    setRenameBusy(true);
    const res = await renameBreedAction({ id, name });
    setRenameBusy(false);
    if (res.ok) {
      toast.success("Breed renamed");
      setRenamingId(null);
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-base font-bold">Breeds</h2>
      </div>
      <p className="mb-4 text-sm text-ink-soft">
        These options are exactly what the Breed dropdown offers when adding or editing a pig.
      </p>

      <div className="space-y-1.5">
        {breeds.map((b) => {
          const isRenaming = renamingId === b.id;
          return (
            <div key={b.id} className="flex items-center gap-2 rounded-lg border border-rule px-3 py-2">
              {isRenaming ? (
                <>
                  <input
                    className="input h-8 flex-1 py-1 text-sm"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveRename(b.id)}
                    autoFocus
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => saveRename(b.id)}
                    disabled={renameBusy}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setRenamingId(null)} disabled={renameBusy}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{b.name}</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setRenamingId(b.id);
                      setRenameValue(b.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn-ghost btn-sm text-overdue"
                    onClick={() => setDeleting(b)}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2 border-t border-dashed border-rule pt-4">
        <input
          className="input"
          placeholder="New breed name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addBreed()}
        />
        <button className="btn btn-secondary" onClick={addBreed} disabled={addBusy || !newName.trim()}>
          {addBusy ? "Adding…" : "Add breed"}
        </button>
      </div>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Remove "${deleting.name}"?`}
          message="It disappears from the dropdown. Pigs already assigned this breed keep it on their record."
          danger
          busy={deleteBusy}
          confirmLabel="Remove"
          onConfirm={async () => {
            setDeleteBusy(true);
            const res = await deleteBreedAction(deleting.id);
            setDeleteBusy(false);
            setDeleting(null);
            if (res.ok) toast.success(`Removed "${deleting.name}"`);
            else toast.error(res.error);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function UserModal({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role ?? "FARM_USER");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const res = user
      ? await updateUserAction({
          userId: user.id,
          name,
          email,
          ...(password ? { password } : {}),
          role: role as "ADMIN" | "FARM_USER",
          isActive,
        })
      : await createUserAction({ name, email, password, role });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(user ? "User updated" : `Invited ${name}`);
    router.refresh();
    onClose();
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={user ? `Edit ${user.name}` : "Add user"}>
      <div className="space-y-4">
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="field-label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{user ? "New password (leave blank to keep)" : "Password"}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <span className="field-label">Role</span>
          <div className="grid grid-cols-2 gap-2">
            {(["FARM_USER", "ADMIN"] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`btn ${role === r ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setRole(r)}
              >
                {r === "ADMIN" ? "Admin" : "Farm user"}
              </button>
            ))}
          </div>
        </div>
        {user && (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Account active
          </label>
        )}
        <div className="flex justify-end gap-2 border-t border-dashed border-rule pt-4">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || !name || !email || (!user && password.length < 8)}
          >
            {busy ? "Saving…" : user ? "Save changes" : "Create user"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
