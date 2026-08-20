-- CreateEnum
CREATE TYPE "SpielersucheStatus" AS ENUM ('OPEN', 'COMPLETE', 'CLOSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SpielersucheSource" AS ENUM ('DASHBOARD', 'SLASH_COMMAND', 'LEGACY_IMPORT');

-- CreateEnum
CREATE TYPE "SpielersucheImportStatus" AS ENUM ('ANALYSED', 'CONFIRMED', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SpielersucheImportKind" AS ENUM ('SETTINGS', 'GAME', 'MATCH', 'PARTICIPANT', 'USAGE', 'VOICE_SESSION', 'ROLE_PING');

-- CreateEnum
CREATE TYPE "SpielersucheImportAction" AS ENUM ('IMPORT', 'SKIP_DUPLICATE', 'SKIP_INVALID', 'SKIP_OTHER_GUILD', 'CONFLICT');

-- CreateTable
CREATE TABLE "SpielersucheGame" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "maxSquadSize" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "legacyId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByDiscordId" TEXT,

    CONSTRAINT "SpielersucheGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheMatch" (
    "id" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "creatorUsername" TEXT NOT NULL,
    "creatorDisplayName" TEXT,
    "creatorAvatarHash" TEXT,
    "gameId" TEXT,
    "gameName" TEXT NOT NULL,
    "pingRoleId" TEXT,
    "rolePinged" BOOLEAN NOT NULL DEFAULT false,
    "bannerUrl" TEXT,
    "requestedPlayers" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "SpielersucheStatus" NOT NULL DEFAULT 'OPEN',
    "source" "SpielersucheSource" NOT NULL DEFAULT 'SLASH_COMMAND',
    "channelId" TEXT,
    "messageId" TEXT,
    "voiceChannelId" TEXT,
    "voiceChannelName" TEXT,
    "maxSquadSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedByDiscordId" TEXT,
    "closeReason" TEXT,
    "activeCreatorKey" TEXT,
    "idempotencyKey" TEXT,
    "legacyId" INTEGER,
    "importId" TEXT,

    CONSTRAINT "SpielersucheMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheParticipant" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarHash" TEXT,
    "isCreator" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "SpielersucheParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheRolePing" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "pingedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpielersucheRolePing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheUsage" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "command" TEXT NOT NULL DEFAULT 'spielersuche',
    "source" "SpielersucheSource" NOT NULL DEFAULT 'SLASH_COMMAND',
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "legacyId" INTEGER,

    CONSTRAINT "SpielersucheUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheVoiceSession" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "matchId" TEXT,
    "voiceChannelId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "legacyId" INTEGER,

    CONSTRAINT "SpielersucheVoiceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileBytes" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" "SpielersucheImportStatus" NOT NULL DEFAULT 'ANALYSED',
    "schemaInfo" JSONB,
    "sourceGuildId" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importableRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "otherGuildRows" INTEGER NOT NULL DEFAULT 0,
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

    CONSTRAINT "SpielersucheImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpielersucheImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "kind" "SpielersucheImportKind" NOT NULL,
    "legacyKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "action" "SpielersucheImportAction" NOT NULL,
    "note" TEXT,
    "payload" JSONB NOT NULL,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpielersucheImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheGame_nameKey_key" ON "SpielersucheGame"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheGame_legacyId_key" ON "SpielersucheGame"("legacyId");

-- CreateIndex
CREATE INDEX "SpielersucheGame_enabled_name_idx" ON "SpielersucheGame"("enabled", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheMatch_messageId_key" ON "SpielersucheMatch"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheMatch_activeCreatorKey_key" ON "SpielersucheMatch"("activeCreatorKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheMatch_idempotencyKey_key" ON "SpielersucheMatch"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheMatch_legacyId_key" ON "SpielersucheMatch"("legacyId");

-- CreateIndex
CREATE INDEX "SpielersucheMatch_status_expiresAt_idx" ON "SpielersucheMatch"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SpielersucheMatch_creatorDiscordId_createdAt_idx" ON "SpielersucheMatch"("creatorDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "SpielersucheMatch_gameId_idx" ON "SpielersucheMatch"("gameId");

-- CreateIndex
CREATE INDEX "SpielersucheMatch_voiceChannelId_idx" ON "SpielersucheMatch"("voiceChannelId");

-- CreateIndex
CREATE INDEX "SpielersucheMatch_createdAt_idx" ON "SpielersucheMatch"("createdAt");

-- CreateIndex
CREATE INDEX "SpielersucheParticipant_discordId_joinedAt_idx" ON "SpielersucheParticipant"("discordId", "joinedAt");

-- CreateIndex
CREATE INDEX "SpielersucheParticipant_matchId_leftAt_idx" ON "SpielersucheParticipant"("matchId", "leftAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheParticipant_matchId_discordId_key" ON "SpielersucheParticipant"("matchId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheRolePing_gameId_key" ON "SpielersucheRolePing"("gameId");

-- CreateIndex
CREATE INDEX "SpielersucheRolePing_pingedAt_idx" ON "SpielersucheRolePing"("pingedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheUsage_legacyId_key" ON "SpielersucheUsage"("legacyId");

-- CreateIndex
CREATE INDEX "SpielersucheUsage_discordId_usedAt_idx" ON "SpielersucheUsage"("discordId", "usedAt");

-- CreateIndex
CREATE INDEX "SpielersucheUsage_usedAt_idx" ON "SpielersucheUsage"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheVoiceSession_legacyId_key" ON "SpielersucheVoiceSession"("legacyId");

-- CreateIndex
CREATE INDEX "SpielersucheVoiceSession_discordId_joinedAt_idx" ON "SpielersucheVoiceSession"("discordId", "joinedAt");

-- CreateIndex
CREATE INDEX "SpielersucheVoiceSession_voiceChannelId_leftAt_idx" ON "SpielersucheVoiceSession"("voiceChannelId", "leftAt");

-- CreateIndex
CREATE INDEX "SpielersucheVoiceSession_matchId_idx" ON "SpielersucheVoiceSession"("matchId");

-- CreateIndex
CREATE INDEX "SpielersucheImport_status_createdAt_idx" ON "SpielersucheImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SpielersucheImportItem_importId_kind_action_idx" ON "SpielersucheImportItem"("importId", "kind", "action");

-- CreateIndex
CREATE UNIQUE INDEX "SpielersucheImportItem_importId_legacyKey_key" ON "SpielersucheImportItem"("importId", "legacyKey");

-- AddForeignKey
ALTER TABLE "SpielersucheMatch" ADD CONSTRAINT "SpielersucheMatch_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "SpielersucheGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielersucheMatch" ADD CONSTRAINT "SpielersucheMatch_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SpielersucheImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielersucheParticipant" ADD CONSTRAINT "SpielersucheParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "SpielersucheMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielersucheRolePing" ADD CONSTRAINT "SpielersucheRolePing_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "SpielersucheGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielersucheVoiceSession" ADD CONSTRAINT "SpielersucheVoiceSession_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "SpielersucheMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpielersucheImportItem" ADD CONSTRAINT "SpielersucheImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SpielersucheImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

