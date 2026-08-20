-- Jail: permanente Strafen, Vote Jail und Kommunikationsmodul.
--
-- Bestehende Daten bleiben vollständig erhalten:
--   * "JailEntry"."type" bekommt den Default TEMPORARY - alle bisherigen
--     (zeitlich begrenzten) Jails sind damit korrekt eingeordnet.
--   * "endsAt" und "durationSeconds" werden nur optional gemacht; die
--     vorhandenen Werte bleiben unverändert stehen.
--   * Es wird keine Zeile gelöscht und keine Spalte entfernt.

-- CreateEnum
CREATE TYPE "JailType" AS ENUM ('TEMPORARY', 'PERMANENT');

-- CreateEnum
CREATE TYPE "VoteJailStatus" AS ENUM ('ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('NEWS', 'EVENT', 'POLL');

-- AlterTable
ALTER TABLE "JailEntry" ADD COLUMN     "type" "JailType" NOT NULL DEFAULT 'TEMPORARY',
ALTER COLUMN "durationSeconds" DROP NOT NULL,
ALTER COLUMN "endsAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "VoteJail" (
    "id" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "targetUsername" TEXT NOT NULL,
    "targetDisplayName" TEXT,
    "targetAvatarHash" TEXT,
    "startedByDiscordId" TEXT NOT NULL,
    "startedByUsername" TEXT NOT NULL,
    "startedByAvatarHash" TEXT,
    "reason" TEXT,
    "status" "VoteJailStatus" NOT NULL DEFAULT 'ACTIVE',
    "requiredVotes" INTEGER NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "resultingJailMinutes" INTEGER NOT NULL,
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "resultingJailId" TEXT,
    "activeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VoteJail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteJailVote" (
    "id" TEXT NOT NULL,
    "voteJailId" TEXT NOT NULL,
    "voterDiscordId" TEXT NOT NULL,
    "voterUsername" TEXT,
    "voteNumber" INTEGER NOT NULL DEFAULT 1,
    "isAdminVote" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteJailVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "type" "CommunicationType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "discordChannelId" TEXT NOT NULL,
    "discordChannelName" TEXT,
    "discordMessageId" TEXT,
    "sentByDiscordId" TEXT NOT NULL,
    "sentByUsername" TEXT NOT NULL,
    "sentByAvatarHash" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedByDiscordId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoteJail_resultingJailId_key" ON "VoteJail"("resultingJailId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteJail_activeKey_key" ON "VoteJail"("activeKey");

-- CreateIndex
CREATE INDEX "VoteJail_status_expiresAt_idx" ON "VoteJail"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "VoteJail_targetDiscordId_createdAt_idx" ON "VoteJail"("targetDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "VoteJailVote_voteJailId_idx" ON "VoteJailVote"("voteJailId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteJailVote_voteJailId_voterDiscordId_voteNumber_key" ON "VoteJailVote"("voteJailId", "voterDiscordId", "voteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_idempotencyKey_key" ON "CommunicationMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommunicationMessage_sentAt_idx" ON "CommunicationMessage"("sentAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_type_sentAt_idx" ON "CommunicationMessage"("type", "sentAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_discordChannelId_idx" ON "CommunicationMessage"("discordChannelId");

-- CreateIndex
CREATE INDEX "JailEntry_type_idx" ON "JailEntry"("type");

-- AddForeignKey
ALTER TABLE "VoteJail" ADD CONSTRAINT "VoteJail_resultingJailId_fkey" FOREIGN KEY ("resultingJailId") REFERENCES "JailEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteJailVote" ADD CONSTRAINT "VoteJailVote_voteJailId_fkey" FOREIGN KEY ("voteJailId") REFERENCES "VoteJail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
