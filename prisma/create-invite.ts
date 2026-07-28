/* Issues a one-time invite code for a new farm to sign up at /onboarding.
 * Usage: npm run invite:create -- --note "Acme Farms" [--expires-days 14]
 */
import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function generateCode() {
  return randomBytes(5).toString("hex").toUpperCase();
}

async function main() {
  const note = arg("note") ?? null;
  const expiresDays = arg("expires-days");
  const expiresAt = expiresDays ? new Date(Date.now() + Number(expiresDays) * 86_400_000) : null;

  const invite = await db.farmInvite.create({
    data: { code: generateCode(), note, expiresAt },
  });

  const base = process.env.APP_URL ?? "http://localhost:3000";
  console.log("Invite created:");
  console.log(`  code:   ${invite.code}`);
  console.log(`  note:   ${note ?? "(none)"}`);
  console.log(`  expires: ${expiresAt ? expiresAt.toISOString() : "never"}`);
  console.log(`  link:   ${base}/onboarding?code=${invite.code}`);
}

main().finally(() => db.$disconnect());
