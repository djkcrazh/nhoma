import { db } from "@/server/db";
import { Ctx } from "@/server/auth/auth";

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export async function logAudit(ctx: Ctx, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      farmId: ctx.farmId,
      userId: ctx.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      before: entry.before ? JSON.stringify(entry.before) : null,
      after: entry.after ? JSON.stringify(entry.after) : null,
    },
  });
}

export async function recentActivity(farmId: string, limit = 15) {
  return db.auditLog.findMany({
    where: { farmId, action: { not: "LOGIN" } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true } } },
  });
}
