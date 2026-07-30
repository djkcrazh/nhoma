-- Add a persistent, admin-shareable join code to each farm so workers can
-- self-serve onto an existing farm without an invite code.
ALTER TABLE "Farm" ADD COLUMN "joinCode" TEXT;

-- Backfill existing farms with a random 8-char uppercase hex code.
UPDATE "Farm" SET "joinCode" = upper(substr(md5(random()::text || "id"), 1, 8))
WHERE "joinCode" IS NULL;

ALTER TABLE "Farm" ALTER COLUMN "joinCode" SET NOT NULL;
CREATE UNIQUE INDEX "Farm_joinCode_key" ON "Farm"("joinCode");
