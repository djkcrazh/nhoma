import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { ServiceError } from "./pig.service";
import { logAudit } from "./audit.service";

/**
 * The farm's breed picklist. This is the single source of truth for the Breed
 * dropdown everywhere in the app — Settings edits it, forms read from it.
 */
export async function listBreeds(ctx: Ctx) {
  assertCan(ctx.role, "pig:view");
  return db.breed.findMany({
    where: { farmId: ctx.farmId },
    orderBy: { name: "asc" },
  });
}

export async function createBreed(ctx: Ctx, name: string) {
  assertCan(ctx.role, "settings:manage");
  const trimmed = name.trim();
  const existing = await db.breed.findUnique({
    where: { farmId_name: { farmId: ctx.farmId, name: trimmed } },
  });
  if (existing) throw new ServiceError("DUPLICATE_BREED", `"${trimmed}" is already a breed option`);
  const breed = await db.breed.create({ data: { farmId: ctx.farmId, name: trimmed } });
  await logAudit(ctx, {
    action: "CREATE",
    entityType: "Breed",
    entityId: breed.id,
    summary: `Added breed option "${trimmed}"`,
  });
  return breed;
}

export async function renameBreed(ctx: Ctx, id: string, name: string) {
  assertCan(ctx.role, "settings:manage");
  const breed = await db.breed.findFirst({ where: { id, farmId: ctx.farmId } });
  if (!breed) throw new ServiceError("NOT_FOUND", "Breed not found");
  const trimmed = name.trim();
  const clash = await db.breed.findUnique({
    where: { farmId_name: { farmId: ctx.farmId, name: trimmed } },
  });
  if (clash && clash.id !== id)
    throw new ServiceError("DUPLICATE_BREED", `"${trimmed}" is already a breed option`);

  await db.$transaction([
    db.breed.update({ where: { id }, data: { name: trimmed } }),
    // Keep existing pigs' breed text in sync with the renamed option.
    db.pig.updateMany({ where: { farmId: ctx.farmId, breed: breed.name }, data: { breed: trimmed } }),
  ]);
  await logAudit(ctx, {
    action: "UPDATE",
    entityType: "Breed",
    entityId: id,
    summary: `Renamed breed "${breed.name}" to "${trimmed}"`,
    before: { name: breed.name },
    after: { name: trimmed },
  });
}

export async function deleteBreed(ctx: Ctx, id: string) {
  assertCan(ctx.role, "settings:manage");
  const breed = await db.breed.findFirst({ where: { id, farmId: ctx.farmId } });
  if (!breed) throw new ServiceError("NOT_FOUND", "Breed not found");
  await db.breed.delete({ where: { id } });
  await logAudit(ctx, {
    action: "DELETE",
    entityType: "Breed",
    entityId: id,
    summary: `Removed breed option "${breed.name}"`,
  });
}
