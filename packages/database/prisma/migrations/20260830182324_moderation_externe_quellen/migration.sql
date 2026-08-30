-- CreateEnum
CREATE TYPE "ModerationSource" AS ENUM ('WEBAPP', 'BOT', 'DISCORD', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ModerationActorType" AS ENUM ('HUMAN', 'BOT', 'SYSTEM', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "ModerationActionType" ADD VALUE 'TIMEOUT_UPDATE';

-- AlterTable
ALTER TABLE "BotStatus" ADD COLUMN     "auditLogAccess" BOOLEAN,
ADD COLUMN     "auditLogCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastAuditEntryId" TEXT;

-- AlterTable
ALTER TABLE "ModerationAction" ADD COLUMN     "actorType" "ModerationActorType" NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "detectedAt" TIMESTAMP(3),
ADD COLUMN     "discordAuditLogEntryId" TEXT,
ADD COLUMN     "source" "ModerationSource" NOT NULL DEFAULT 'WEBAPP';

-- CreateIndex
CREATE UNIQUE INDEX "ModerationAction_discordAuditLogEntryId_key" ON "ModerationAction"("discordAuditLogEntryId");

-- CreateIndex
CREATE INDEX "ModerationAction_source_createdAt_idx" ON "ModerationAction"("source", "createdAt");


-- Bestandszeilen einordnen.
--
-- Nur, was sich belegen laesst: die Zeitsteuerung traegt woertlich 'system'
-- als Handelnden, das ist eindeutig. Alles Uebrige behaelt die Vorgabe
-- WEBAPP - es entstand ueber SwissHub, und ob ueber Dashboard oder
-- Slash-Befehl wurde bis heute nicht festgehalten. Diese Unterscheidung
-- nachtraeglich zu erfinden waere eine Behauptung ueber die Vergangenheit.
UPDATE "ModerationAction"
SET "source" = 'SYSTEM', "actorType" = 'SYSTEM'
WHERE "actorDiscordId" = 'system';
