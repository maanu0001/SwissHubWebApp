-- CreateEnum
CREATE TYPE "XpSource" AS ENUM ('MESSAGE', 'VOICE', 'GAME_WIN', 'GAME_LOSS', 'GAME_STAKE', 'GAME_REFUND', 'ADMIN', 'DECAY', 'BOOST', 'MIGRATION', 'SYSTEM');

-- CreateEnum
CREATE TYPE "XpGameKind" AS ENUM ('XP_BATTLE', 'XP_SSP', 'XP_TTT', 'XP_4GEWINNT');

-- CreateEnum
CREATE TYPE "XpGameStatus" AS ENUM ('PENDING', 'RUNNING', 'FINISHED', 'DRAW', 'DECLINED', 'TIMEOUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LevelImportStatus" AS ENUM ('ANALYSED', 'CONFIRMED', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "LevelImportKind" AS ENUM ('PROFILE', 'GAME_STATS', 'NO_XP_CHANNEL', 'CONFIG', 'GUILD_CONFIG', 'ENV_SETTING');

-- CreateEnum
CREATE TYPE "LevelImportAction" AS ENUM ('IMPORT', 'SKIP_DUPLICATE', 'SKIP_INVALID', 'SKIP_EMPTY', 'CONFLICT');

-- CreateTable
CREATE TABLE "LevelProfile" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarHash" TEXT,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceMinutes" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "lastDecayAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastVoiceAt" TIMESTAMP(3),
    "legacyImportSha" TEXT,
    "legacyImportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpTransaction" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "source" "XpSource" NOT NULL,
    "delta" INTEGER NOT NULL,
    "requestedDelta" INTEGER NOT NULL,
    "xpBefore" INTEGER NOT NULL,
    "xpAfter" INTEGER NOT NULL,
    "levelBefore" INTEGER NOT NULL,
    "levelAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "actorDiscordId" TEXT,
    "channelId" TEXT,
    "gameMatchId" TEXT,
    "importId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelGameMatch" (
    "id" TEXT NOT NULL,
    "kind" "XpGameKind" NOT NULL,
    "status" "XpGameStatus" NOT NULL DEFAULT 'PENDING',
    "challengerDiscordId" TEXT NOT NULL,
    "opponentDiscordId" TEXT NOT NULL,
    "bet" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "potHeld" BOOLEAN NOT NULL DEFAULT false,
    "winnerDiscordId" TEXT,
    "guildId" TEXT,
    "channelId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "activeChallengerKey" TEXT,
    "activeOpponentKey" TEXT,

    CONSTRAINT "LevelGameMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelGameStats" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "kind" "XpGameKind" NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "xpWon" INTEGER NOT NULL DEFAULT 0,
    "xpLost" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelGameStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelMilestoneRole" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelMilestoneRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileBytes" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" "LevelImportStatus" NOT NULL DEFAULT 'ANALYSED',
    "schemaInfo" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importableRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "conflictRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "legacyBotStopped" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByDiscordId" TEXT NOT NULL,
    "uploadedByUsername" TEXT NOT NULL,
    "confirmedByDiscordId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LevelImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LevelImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "kind" "LevelImportKind" NOT NULL,
    "legacyKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "action" "LevelImportAction" NOT NULL,
    "note" TEXT,
    "payload" JSONB NOT NULL,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LevelImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LevelProfile_discordId_key" ON "LevelProfile"("discordId");

-- CreateIndex
CREATE INDEX "LevelProfile_xp_idx" ON "LevelProfile"("xp");

-- CreateIndex
CREATE INDEX "LevelProfile_lastActivityAt_idx" ON "LevelProfile"("lastActivityAt");

-- CreateIndex
CREATE INDEX "LevelProfile_lastDecayAt_idx" ON "LevelProfile"("lastDecayAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpTransaction_idempotencyKey_key" ON "XpTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "XpTransaction_discordId_createdAt_idx" ON "XpTransaction"("discordId", "createdAt");

-- CreateIndex
CREATE INDEX "XpTransaction_source_createdAt_idx" ON "XpTransaction"("source", "createdAt");

-- CreateIndex
CREATE INDEX "XpTransaction_createdAt_idx" ON "XpTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "XpTransaction_gameMatchId_idx" ON "XpTransaction"("gameMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "LevelGameMatch_activeChallengerKey_key" ON "LevelGameMatch"("activeChallengerKey");

-- CreateIndex
CREATE UNIQUE INDEX "LevelGameMatch_activeOpponentKey_key" ON "LevelGameMatch"("activeOpponentKey");

-- CreateIndex
CREATE INDEX "LevelGameMatch_kind_status_idx" ON "LevelGameMatch"("kind", "status");

-- CreateIndex
CREATE INDEX "LevelGameMatch_status_expiresAt_idx" ON "LevelGameMatch"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LevelGameMatch_challengerDiscordId_createdAt_idx" ON "LevelGameMatch"("challengerDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "LevelGameMatch_opponentDiscordId_createdAt_idx" ON "LevelGameMatch"("opponentDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "LevelGameStats_kind_wins_idx" ON "LevelGameStats"("kind", "wins");

-- CreateIndex
CREATE UNIQUE INDEX "LevelGameStats_discordId_kind_key" ON "LevelGameStats"("discordId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LevelMilestoneRole_level_key" ON "LevelMilestoneRole"("level");

-- CreateIndex
CREATE INDEX "LevelMilestoneRole_enabled_level_idx" ON "LevelMilestoneRole"("enabled", "level");

-- CreateIndex
CREATE INDEX "LevelImport_status_createdAt_idx" ON "LevelImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LevelImport_fileSha256_idx" ON "LevelImport"("fileSha256");

-- CreateIndex
CREATE INDEX "LevelImportItem_importId_kind_action_idx" ON "LevelImportItem"("importId", "kind", "action");

-- CreateIndex
CREATE UNIQUE INDEX "LevelImportItem_importId_legacyKey_key" ON "LevelImportItem"("importId", "legacyKey");

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LevelProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_gameMatchId_fkey" FOREIGN KEY ("gameMatchId") REFERENCES "LevelGameMatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpTransaction" ADD CONSTRAINT "XpTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "LevelImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelGameStats" ADD CONSTRAINT "LevelGameStats_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LevelProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelImportItem" ADD CONSTRAINT "LevelImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "LevelImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

