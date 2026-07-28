import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { logAudit } from "./audit.service";
import { ServiceError } from "./pig.service";

export async function listUsers(ctx: Ctx) {
  assertCan(ctx.role, "user:manage");
  return db.user.findMany({
    where: { farmId: ctx.farmId },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createUser(
  ctx: Ctx,
  input: { name: string; email: string; password: string; role: "ADMIN" | "FARM_USER" }
) {
  assertCan(ctx.role, "user:manage");
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ServiceError("DUPLICATE_EMAIL", "A user with this email already exists");
  const user = await db.user.create({
    data: {
      farmId: ctx.farmId,
      name: input.name,
      email,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: input.role,
    },
  });
  await logAudit(ctx, {
    action: "CREATE",
    entityType: "User",
    entityId: user.id,
    summary: `Created user ${user.name} (${input.role})`,
  });
  return { id: user.id };
}

export async function updateUser(
  ctx: Ctx,
  input: { userId: string; name?: string; email?: string; password?: string; role?: "ADMIN" | "FARM_USER"; isActive?: boolean }
) {
  assertCan(ctx.role, "user:manage");
  const user = await db.user.findFirst({ where: { id: input.userId, farmId: ctx.farmId } });
  if (!user) throw new ServiceError("NOT_FOUND", "User not found");

  // Never allow removing the last active admin
  if ((input.role === "FARM_USER" || input.isActive === false) && user.role === "ADMIN") {
    const admins = await db.user.count({
      where: { farmId: ctx.farmId, role: "ADMIN", isActive: true, id: { not: user.id } },
    });
    if (admins === 0)
      throw new ServiceError("INVALID_INPUT", "Cannot demote or deactivate the last admin");
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
      ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  await logAudit(ctx, {
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    summary: `Updated user ${user.name}`,
    before: { role: user.role, isActive: user.isActive },
    after: { role: input.role, isActive: input.isActive },
  });
}

export async function deleteUser(ctx: Ctx, userId: string) {
  assertCan(ctx.role, "user:manage");
  if (userId === ctx.userId)
    throw new ServiceError("INVALID_INPUT", "You cannot delete your own account");
  const user = await db.user.findFirst({ where: { id: userId, farmId: ctx.farmId } });
  if (!user) throw new ServiceError("NOT_FOUND", "User not found");
  if (user.role === "ADMIN") {
    const admins = await db.user.count({
      where: { farmId: ctx.farmId, role: "ADMIN", isActive: true, id: { not: userId } },
    });
    if (admins === 0) throw new ServiceError("INVALID_INPUT", "Cannot delete the last admin");
  }
  // Deactivate rather than hard-delete: audit history references the user
  await db.user.update({ where: { id: userId }, data: { isActive: false } });
  await logAudit(ctx, {
    action: "DELETE",
    entityType: "User",
    entityId: userId,
    summary: `Deactivated user ${user.name}`,
  });
}
