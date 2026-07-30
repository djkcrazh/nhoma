import { requireCtx } from "@/server/auth/auth";
import { getSettings } from "@/server/services/settings.service";
import { listUsers } from "@/server/services/user.service";
import { listBreeds } from "@/server/services/breed.service";
import { getJoinCode, getFarmName } from "@/server/services/farm.service";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const [settings, users, breeds, joinCode, farmName] = await Promise.all([
    getSettings(ctx.farmId),
    listUsers(ctx),
    listBreeds(ctx),
    getJoinCode(ctx),
    getFarmName(ctx),
  ]);
  return (
    <div className="fade-up">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">Farm settings</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Thresholds drive automatic statuses; changes recompute the whole herd immediately.
        </p>
      </div>
      <SettingsPanel
        settings={settings}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
        breeds={breeds.map((b) => ({ id: b.id, name: b.name }))}
        currentUserId={ctx.userId}
        joinCode={joinCode}
        farmName={farmName}
      />
    </div>
  );
}
