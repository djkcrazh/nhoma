import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { DEFAULT_BREEDS } from "@/lib/domain/types";
import { ServiceError } from "./pig.service";

/**
 * Redeems an invite code by creating a new Farm with its first ADMIN user.
 * This is the seam for public self-serve signup later: relax/remove the
 * invite-code lookup below and the rest of the flow is unchanged.
 */
export async function createFarmWithAdmin(input: {
  code: string;
  farmName: string;
  adminName: string;
  email: string;
  password: string;
}) {
  const email = input.email.toLowerCase();
  const invite = await db.farmInvite.findUnique({ where: { code: input.code.trim() } });
  if (!invite) throw new ServiceError("INVALID_INPUT", "Invite code not found");
  if (invite.usedAt) throw new ServiceError("INVALID_INPUT", "Invite code has already been used");
  if (invite.expiresAt && invite.expiresAt < new Date())
    throw new ServiceError("INVALID_INPUT", "Invite code has expired");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ServiceError("DUPLICATE_EMAIL", "A user with this email already exists");

  const farm = await db.$transaction(async (tx) => {
    const farm = await tx.farm.create({ data: { name: input.farmName } });
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
    await tx.farmInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedByFarmId: farm.id },
    });
    await tx.auditLog.create({
      data: {
        farmId: farm.id,
        userId: admin.id,
        action: "CREATE",
        entityType: "Farm",
        entityId: farm.id,
        summary: `Farm "${input.farmName}" created via invite`,
      },
    });
    return farm;
  });

  return { farmId: farm.id, email };
}
