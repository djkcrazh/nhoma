import { db } from "@/server/db";
import { DEFAULT_SETTINGS, FarmSettings } from "@/lib/domain/types";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";

const KEY_MAP: Record<keyof FarmSettings, string> = {
  marketMinWeightKg: "market.minWeightKg",
  marketMinAgeDays: "market.minAgeDays",
  breedingMinAgeDaysFemale: "breeding.minAgeDaysFemale",
  breedingMinWeightKgFemale: "breeding.minWeightKgFemale",
  gestationDays: "gestation.days",
  pigletMaxAgeDays: "piglet.maxAgeDays",
  staleWeightDays: "alerts.staleWeightDays",
  overdueGraceDays: "alerts.overdueGraceDays",
};

export async function getSettings(farmId: string): Promise<FarmSettings> {
  const rows = await db.setting.findMany({ where: { farmId } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const result = { ...DEFAULT_SETTINGS };
  for (const [field, key] of Object.entries(KEY_MAP) as [keyof FarmSettings, string][]) {
    const raw = byKey.get(key);
    if (raw === undefined) continue;
    const parsed = Number(JSON.parse(raw));
    if (Number.isFinite(parsed)) result[field] = parsed;
  }
  return result;
}

export async function updateSettings(ctx: Ctx, input: Partial<FarmSettings>) {
  assertCan(ctx.role, "settings:manage");
  const before = await getSettings(ctx.farmId);
  for (const [field, value] of Object.entries(input) as [keyof FarmSettings, number][]) {
    const key = KEY_MAP[field];
    if (!key || value === undefined) continue;
    await db.setting.upsert({
      where: { farmId_key: { farmId: ctx.farmId, key } },
      create: { farmId: ctx.farmId, key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
  }
  const after = await getSettings(ctx.farmId);
  await logAudit(ctx, {
    action: "UPDATE",
    entityType: "Settings",
    entityId: ctx.farmId,
    summary: "Updated farm thresholds",
    before,
    after,
  });
  return after;
}
