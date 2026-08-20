-- CreateEnum
CREATE TYPE "JailSource" AS ENUM ('DASHBOARD', 'SLASH_COMMAND', 'VOTE_JAIL', 'IMPORT', 'AUTO_RESTORE');

-- CreateEnum
CREATE TYPE "JailLifecycle" AS ENUM ('PENDING', 'ACTIVE', 'RELEASED', 'EXPIRED', 'RESTORE_FAILED', 'PENDING_REJOIN', 'FAILED');

-- CreateEnum
CREATE TYPE "JailImportStatus" AS ENUM ('ANALYSED', 'CONFIRMED', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JailImportRowAction" AS ENUM ('IMPORT', 'SKIP_DUPLICATE', 'SKIP_RELEASED', 'SKIP_INVALID', 'CONFLICT');

-- AlterTable
ALTER TABLE "JailEntry" ADD COLUMN     "importId" TEXT,
ADD COLUMN     "leftGuildAt" TIMESTAMP(3),
ADD COLUMN     "legacyKey" TEXT,
ADD COLUMN     "lifecycle" "JailLifecycle" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reappliedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "silent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "JailSource" NOT NULL DEFAULT 'DASHBOARD',
ADD COLUMN     "voiceDisconnected" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "JailRoleSnapshot" (
    "id" TEXT NOT NULL,
    "jailId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "roleNameAtTime" TEXT,
    "rolePositionAtTime" INTEGER,
    "managedAtTime" BOOLEAN NOT NULL DEFAULT false,
    "kept" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" TIMESTAMP(3),
    "restoreFailedCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JailRoleSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteJailCooldown" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "lastVoteJailId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoteJailCooldown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JailImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileBytes" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" "JailImportStatus" NOT NULL DEFAULT 'ANALYSED',
    "schemaInfo" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importableRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "releasedRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "conflictRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "legacyBotStopped" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "reconcileSummary" JSONB,
    "uploadedByDiscordId" TEXT NOT NULL,
    "uploadedByUsername" TEXT NOT NULL,
    "confirmedByDiscordId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "JailImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JailImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "legacyKey" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "moderatorDiscordId" TEXT,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "permanent" BOOLEAN NOT NULL DEFAULT false,
    "gender" TEXT,
    "legacyStatus" TEXT,
    "action" "JailImportRowAction" NOT NULL,
    "note" TEXT,
    "jailId" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JailImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JailRoleSnapshot_jailId_idx" ON "JailRoleSnapshot"("jailId");

-- CreateIndex
CREATE INDEX "JailRoleSnapshot_roleId_idx" ON "JailRoleSnapshot"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "JailRoleSnapshot_jailId_roleId_key" ON "JailRoleSnapshot"("jailId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteJailCooldown_discordId_key" ON "VoteJailCooldown"("discordId");

-- CreateIndex
CREATE INDEX "VoteJailCooldown_expiresAt_idx" ON "VoteJailCooldown"("expiresAt");

-- CreateIndex
CREATE INDEX "JailImport_status_createdAt_idx" ON "JailImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JailImportRow_importId_action_idx" ON "JailImportRow"("importId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "JailImportRow_importId_legacyKey_key" ON "JailImportRow"("importId", "legacyKey");

-- CreateIndex
CREATE UNIQUE INDEX "JailEntry_legacyKey_key" ON "JailEntry"("legacyKey");

-- CreateIndex
CREATE INDEX "JailEntry_lifecycle_idx" ON "JailEntry"("lifecycle");

-- CreateIndex
CREATE INDEX "JailEntry_source_idx" ON "JailEntry"("source");

-- CreateIndex
CREATE INDEX "JailEntry_importId_idx" ON "JailEntry"("importId");

-- AddForeignKey
ALTER TABLE "JailEntry" ADD CONSTRAINT "JailEntry_importId_fkey" FOREIGN KEY ("importId") REFERENCES "JailImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JailRoleSnapshot" ADD CONSTRAINT "JailRoleSnapshot_jailId_fkey" FOREIGN KEY ("jailId") REFERENCES "JailEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JailImportRow" ADD CONSTRAINT "JailImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "JailImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Datenuebernahme
--
-- Bestehende Daten bleiben vollstaendig erhalten. Die neuen Spalten werden aus
-- dem vorhandenen Zustand abgeleitet, damit Listen und Filter sofort stimmen.
-- ---------------------------------------------------------------------------

-- Fachlicher Zustand aus Ausfuehrungsstatus und Freilassung ableiten.
UPDATE "JailEntry" SET "lifecycle" = (
  CASE
    WHEN "status" = 'FAILED' THEN 'FAILED'
    WHEN "releasedAt" IS NOT NULL AND "releaseType" = 'AUTOMATIC' THEN 'EXPIRED'
    WHEN "releasedAt" IS NOT NULL THEN 'RELEASED'
    WHEN "status" IN ('COMPLETED', 'PARTIAL') THEN 'ACTIVE'
    ELSE 'PENDING'
  END
)::"JailLifecycle";

-- Jails, die aus einer Abstimmung entstanden sind, entsprechend kennzeichnen.
UPDATE "JailEntry" e
SET "source" = 'VOTE_JAIL'
FROM "VoteJail" v
WHERE v."resultingJailId" = e."id";

-- Flachen Rollen-Snapshot in die strukturierte Relation uebernehmen.
-- Name und Position sind fuer Altdaten unbekannt und bleiben NULL - das ist
-- ehrlicher als ein erfundener Wert.
INSERT INTO "JailRoleSnapshot" ("id", "jailId", "roleId", "kept", "restoredAt")
SELECT
  gen_random_uuid()::text,
  e."id",
  r.role,
  r.role = ANY(e."keptRoleIds"),
  CASE WHEN r.role = ANY(e."restoredRoleIds") THEN e."releasedAt" ELSE NULL END
FROM "JailEntry" e, unnest(e."roleSnapshot") AS r(role)
ON CONFLICT ("jailId", "roleId") DO NOTHING;

UPDATE "JailRoleSnapshot" s
SET "restoreFailedCode" = 'UNKNOWN'
FROM "JailEntry" e
WHERE s."jailId" = e."id" AND s."roleId" = ANY(e."failedRoleIds");
