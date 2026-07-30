"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import * as pigs from "@/server/services/pig.service";
import * as weights from "@/server/services/weight.service";
import * as breeding from "@/server/services/breeding.service";
import * as users from "@/server/services/user.service";
import * as settings from "@/server/services/settings.service";
import * as notifications from "@/server/services/notification.service";
import * as breeds from "@/server/services/breed.service";
import { db } from "@/server/db";
import { logAudit } from "@/server/services/audit.service";
import {
  pigCreateSchema, pigUpdateSchema, weightCreateSchema, breedingCreateSchema,
  farrowSchema, breedingCloseSchema, noteCreateSchema,
} from "@/lib/validations/pig";
import { userCreateSchema, userUpdateSchema, settingsUpdateSchema, onboardingSchema } from "@/lib/validations/user";
import { breedCreateSchema, breedRenameSchema } from "@/lib/validations/breed";
import { z } from "zod";
import { Sex } from "@/lib/domain/types";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof pigs.ServiceError) return { ok: false, error: e.message, code: e.code };
    if (e instanceof z.ZodError)
      return { ok: false, error: e.issues.map((i) => i.message).join("; "), code: "VALIDATION" };
    if (e instanceof Error && e.name === "PermissionError")
      return { ok: false, error: "You don't have permission for that action", code: "FORBIDDEN" };
    if (e instanceof Error && e.message === "UNAUTHENTICATED")
      return { ok: false, error: "Session expired — please sign in again", code: "UNAUTHENTICATED" };
    console.error("Action failed:", e);
    return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" };
  }
}

function revalidateAll() {
  for (const p of ["/dashboard", "/pigs", "/breeding", "/analytics", "/notifications"])
    revalidatePath(p);
}

// ---------- pigs ----------

export async function createPigAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = pigCreateSchema.parse(input);
    const pig = await pigs.createPig(ctx, data);
    revalidateAll();
    return { id: pig.id, tagId: pig.tagId };
  });
}

export async function updatePigAction(pigId: string, input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = pigUpdateSchema.parse(input);
    await pigs.updatePig(ctx, pigId, data);
    revalidateAll();
  });
}

export async function markSoldAction(pigId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await pigs.markSold(ctx, pigId, new Date());
    revalidateAll();
  });
}

export async function markDeadAction(pigId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await pigs.markDead(ctx, pigId, new Date());
    revalidateAll();
  });
}

export async function deletePigAction(pigId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await pigs.deletePig(ctx, pigId);
    revalidateAll();
  });
}

export async function bulkStatusAction(pigIds: string[], action: "SOLD" | "INACTIVE" | "DELETE") {
  return run(async () => {
    const ctx = await requireCtx();
    const res = await pigs.bulkUpdateStatus(ctx, pigIds, action);
    revalidateAll();
    return res;
  });
}

export async function listPigsAction(params: pigs.PigListParams) {
  return run(async () => {
    const ctx = await requireCtx();
    return pigs.listPigs(ctx, params);
  });
}

export async function searchPigOptionsAction(query: string, sex?: Sex) {
  return run(async () => {
    const ctx = await requireCtx();
    return pigs.searchPigOptions(ctx, query, sex);
  });
}

export async function getPigLineageAction(tagId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    return pigs.getPigLineage(ctx, tagId);
  });
}

export async function suggestTagAction() {
  return run(async () => {
    const ctx = await requireCtx();
    return pigs.suggestNextTagId(ctx);
  });
}

export async function checkTagAction(tagId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    assertCan(ctx.role, "pig:view");
    const existing = await db.pig.findFirst({
      where: { farmId: ctx.farmId, tagId },
      select: { id: true },
    });
    return { available: !existing };
  });
}

/** The farm's breed picklist — drives every Breed dropdown in the app. */
export async function listBreedsAction() {
  return run(async () => {
    const ctx = await requireCtx();
    const rows = await breeds.listBreeds(ctx);
    return rows.map((b) => b.name);
  });
}

// ---------- breeds (settings: edit picklist) ----------

export async function listBreedsFullAction() {
  return run(async () => {
    const ctx = await requireCtx();
    const rows = await breeds.listBreeds(ctx);
    return rows.map((b) => ({ id: b.id, name: b.name }));
  });
}

export async function createBreedAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = breedCreateSchema.parse(input);
    const breed = await breeds.createBreed(ctx, data.name);
    revalidatePath("/settings");
    return { id: breed.id, name: breed.name };
  });
}

export async function renameBreedAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = breedRenameSchema.parse(input);
    await breeds.renameBreed(ctx, data.id, data.name);
    revalidateAll();
    revalidatePath("/settings");
  });
}

export async function deleteBreedAction(id: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await breeds.deleteBreed(ctx, id);
    revalidatePath("/settings");
  });
}

// ---------- weights ----------

export async function recordWeightAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = weightCreateSchema.parse(input);
    const res = await weights.recordWeight(ctx, data);
    revalidateAll();
    return { weightDropPct: res.weightDropPct };
  });
}

// ---------- breeding ----------

export async function recordCrossingAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = breedingCreateSchema.parse(input);
    await breeding.recordCrossing(ctx, data);
    revalidateAll();
  });
}

export async function recordFarrowingAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = farrowSchema.parse(input);
    const res = await breeding.recordFarrowing(ctx, data);
    revalidateAll();
    return { sowId: res.sow.id, sowTag: res.sow.tagId };
  });
}

export async function closeBreedingAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = breedingCloseSchema.parse(input);
    await breeding.closeBreeding(ctx, data.breedingId, data.status);
    revalidateAll();
  });
}

// ---------- notes ----------

export async function addNoteAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    assertCan(ctx.role, "note:create");
    const data = noteCreateSchema.parse(input);
    const pig = await db.pig.findFirst({ where: { id: data.pigId, farmId: ctx.farmId } });
    if (!pig) throw new pigs.ServiceError("NOT_FOUND", "Pig not found");
    await db.note.create({
      data: { farmId: ctx.farmId, pigId: data.pigId, authorId: ctx.userId, body: data.body },
    });
    await logAudit(ctx, {
      action: "NOTE",
      entityType: "Pig",
      entityId: data.pigId,
      summary: `Added note on ${pig.tagId}`,
    });
    revalidatePath(`/pigs/${pig.tagId}`);
  });
}

// ---------- users ----------

export async function createUserAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = userCreateSchema.parse(input);
    await users.createUser(ctx, data);
    revalidatePath("/settings/users");
  });
}

export async function updateUserAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = userUpdateSchema.parse(input);
    await users.updateUser(ctx, data);
    revalidatePath("/settings/users");
  });
}

export async function deleteUserAction(userId: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await users.deleteUser(ctx, userId);
    revalidatePath("/settings/users");
  });
}

// ---------- settings ----------

export async function updateSettingsAction(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const data = settingsUpdateSchema.parse(input);
    await settings.updateSettings(ctx, data);
    await notifications.reconcileFarm(ctx.farmId); // thresholds changed → statuses may flip
    revalidateAll();
  });
}

// ---------- notifications ----------

export async function markNotificationReadAction(id: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await notifications.markRead(ctx, id);
    revalidatePath("/notifications");
  });
}

export async function markAllNotificationsReadAction() {
  return run(async () => {
    const ctx = await requireCtx();
    await notifications.markAllRead(ctx);
    revalidatePath("/notifications");
  });
}

export async function dismissNotificationAction(id: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await notifications.dismiss(ctx, id);
    revalidatePath("/notifications");
  });
}

// ---------- import ----------

export async function importPigsAction(rows: unknown[], dryRun: boolean) {
  return run(async () => {
    const ctx = await requireCtx();
    const { importPigs } = await import("@/server/services/import.service");
    const res = await importPigs(ctx, rows as never, dryRun);
    if (!dryRun) revalidateAll();
    return res;
  });
}

// ---------- onboarding (no auth required — new farm signup via invite code) ----------

export async function redeemInviteAction(input: unknown) {
  return run(async () => {
    const data = onboardingSchema.parse(input);
    const { createFarmWithAdmin } = await import("@/server/services/farm.service");
    return createFarmWithAdmin(data);
  });
}
