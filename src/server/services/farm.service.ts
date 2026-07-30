import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";
import { assertCan } from "@/server/auth/permissions";
import { DEFAULT_BREEDS } from "@/lib/domain/types";
import { ServiceError } from "./pig.service";

function generateJoinCode() {
  return randomBytes(4).toString("hex").toUpperCase(); // 8 chars, matches the backfilled format
}

async function uniqueJoinCode() {
  // Collision odds at 2^32 codes are negligible, but a farm's join code is
  // permanent, so it's cheap insurance to actually check.
  for (let i = 0; i < 5; i++) {
    const code = generateJoinCode();
    if (!(await db.farm.findUnique({ where: { joinCode: code }, select: { id: true } }))) return code;
  }
  throw new ServiceError("INTERNAL", "Could not generate a unique join code, try again");
}

/** Public self-serve signup: creates a new Farm with its first ADMIN user, no invite needed. */
export async function createFarmWithAdmin(input: {
  farmName: string;
  adminName: string;
  email: string;
  password: string;
}) {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ServiceError("DUPLICATE_EMAIL", "A user with this email already exists");

  const joinCode = await uniqueJoinCode();
  const farm = await db.$transaction(async (tx) => {
    const farm = await tx.farm.create({ data: { name: input.farmName, joinCode } });
    const admin = await tx.user.create({
      data: {
        farmId: farm.id,
        name: input.adminName,
        email,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: "ADMIN",
      },
    });
    for (const name of DEFAULT_BREEDS) {
      await tx.breed.create({ data: { farmId: farm.id, name } });
    }
    await tx.auditLog.create({
      data: {
        farmId: farm.id,
        userId: admin.id,
        action: "CREATE",
        entityType: "Farm",
        entityId: farm.id,
        summary: `Farm "${input.farmName}" created`,
      },
    });
    return farm;
  });

  return { farmId: farm.id, email };
}

/** Public self-serve signup: joins an existing farm as a FARM_USER via its join code. */
export async function joinFarmAsWorker(input: {
  joinCode: string;
  name: string;
  email: string;
  password: string;
}) {
  const email = input.email.toLowerCase();
  const farm = await db.farm.findUnique({ where: { joinCode: input.joinCode.trim().toUpperCase() } });
  if (!farm) throw new ServiceError("INVALID_INPUT", "Farm code not found");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ServiceError("DUPLICATE_EMAIL", "A user with this email already exists");

  const user = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        farmId: farm.id,
        name: input.name,
        email,
        passwordHash: await bcrypt.hash(input.password, 12),
        role: "FARM_USER",
      },
    });
    await tx.auditLog.create({
      data: {
        farmId: farm.id,
        userId: user.id,
        action: "CREATE",
        entityType: "User",
        entityId: user.id,
        summary: `${input.name} joined the farm`,
      },
    });
    return user;
  });

  return { farmId: farm.id, email: user.email };
}

/** Admin-only: reveal the farm's current join code so it can be shared with workers. */
export async function getJoinCode(ctx: Ctx) {
  assertCan(ctx.role, "user:manage");
  const farm = await db.farm.findUniqueOrThrow({ where: { id: ctx.farmId }, select: { joinCode: true } });
  return farm.joinCode;
}

/** Admin-only: invalidate the old join code (e.g. it leaked) and issue a new one. */
export async function regenerateJoinCode(ctx: Ctx) {
  assertCan(ctx.role, "user:manage");
  const joinCode = await uniqueJoinCode();
  await db.farm.update({ where: { id: ctx.farmId }, data: { joinCode } });
  return joinCode;
}
