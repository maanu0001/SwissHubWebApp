-- CreateEnum
CREATE TYPE "MusicBotType" AS ENUM ('CONTROLLER', 'WORKER');

-- CreateEnum
CREATE TYPE "MusicBotStatus" AS ENUM ('OFFLINE', 'FREE', 'BUSY', 'CONNECTING', 'DEGRADED', 'DRAINING', 'DISABLED');

-- CreateEnum
CREATE TYPE "MusicSessionStatus" AS ENUM ('STARTING', 'ACTIVE', 'DEGRADED', 'ENDED');

-- CreateEnum
CREATE TYPE "MusicLoopMode" AS ENUM ('OFF', 'TRACK', 'QUEUE');

-- CreateEnum
CREATE TYPE "MusicSessionEndReason" AS ENUM ('MANUAL', 'IDLE_TIMEOUT', 'ALONE_TIMEOUT', 'WORKER_OFFLINE', 'ADMIN_FORCED', 'MODULE_DISABLED', 'STALE_RECONCILED');

-- CreateEnum
CREATE TYPE "MusicCommandKind" AS ENUM ('PLAY', 'PAUSE', 'RESUME', 'SKIP', 'STOP', 'LEAVE', 'JOIN', 'SET_VOLUME', 'SET_LOOP', 'QUEUE_ADD', 'QUEUE_REMOVE', 'QUEUE_MOVE', 'QUEUE_SHUFFLE');

-- CreateEnum
CREATE TYPE "MusicCommandStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "MusicBotInstance" (
    "id" TEXT NOT NULL,
    "type" "MusicBotType" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "discordUserId" TEXT,
    "avatarHash" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "MusicBotStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicBotInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicSession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "voiceChannelName" TEXT,
    "botInstanceId" TEXT,
    "status" "MusicSessionStatus" NOT NULL DEFAULT 'STARTING',
    "activeChannelKey" TEXT,
    "activeBotKey" TEXT,
    "loopMode" "MusicLoopMode" NOT NULL DEFAULT 'OFF',
    "volume" INTEGER NOT NULL DEFAULT 50,
    "currentItemId" TEXT,
    "trackStartedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aloneSince" TIMESTAMP(3),
    "listenerCount" INTEGER NOT NULL DEFAULT 0,
    "startedByDiscordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "MusicSessionEndReason",

    CONSTRAINT "MusicSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicQueueItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTrackId" TEXT,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "webpageUrl" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "thumbnailUrl" TEXT,
    "requestedByDiscordUserId" TEXT,
    "requestedByUsername" TEXT,
    "unavailable" BOOLEAN NOT NULL DEFAULT false,
    "unavailableError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicPlaybackHistory" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "guildId" TEXT NOT NULL,
    "voiceChannelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "webpageUrl" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "thumbnailUrl" TEXT,
    "requestedByDiscordUserId" TEXT,
    "requestedByUsername" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedSeconds" INTEGER NOT NULL DEFAULT 0,
    "skipped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MusicPlaybackHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicCommand" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "botInstanceId" TEXT NOT NULL,
    "kind" "MusicCommandKind" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "MusicCommandStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByDiscordUserId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'web',
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MusicBotInstance_status_enabled_idx" ON "MusicBotInstance"("status", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "MusicBotInstance_key_key" ON "MusicBotInstance"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MusicBotInstance_discordUserId_key" ON "MusicBotInstance"("discordUserId");

-- CreateIndex
CREATE INDEX "MusicSession_guildId_status_idx" ON "MusicSession"("guildId", "status");

-- CreateIndex
CREATE INDEX "MusicSession_status_lastActivityAt_idx" ON "MusicSession"("status", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "MusicSession_activeChannelKey_key" ON "MusicSession"("activeChannelKey");

-- CreateIndex
CREATE UNIQUE INDEX "MusicSession_activeBotKey_key" ON "MusicSession"("activeBotKey");

-- CreateIndex
CREATE INDEX "MusicQueueItem_sessionId_position_idx" ON "MusicQueueItem"("sessionId", "position");

-- CreateIndex
CREATE INDEX "MusicPlaybackHistory_guildId_playedAt_idx" ON "MusicPlaybackHistory"("guildId", "playedAt");

-- CreateIndex
CREATE INDEX "MusicPlaybackHistory_sessionId_idx" ON "MusicPlaybackHistory"("sessionId");

-- CreateIndex
CREATE INDEX "MusicCommand_botInstanceId_status_createdAt_idx" ON "MusicCommand"("botInstanceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MusicCommand_sessionId_createdAt_idx" ON "MusicCommand"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "MusicSession" ADD CONSTRAINT "MusicSession_botInstanceId_fkey" FOREIGN KEY ("botInstanceId") REFERENCES "MusicBotInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicQueueItem" ADD CONSTRAINT "MusicQueueItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MusicSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicPlaybackHistory" ADD CONSTRAINT "MusicPlaybackHistory_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MusicSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicCommand" ADD CONSTRAINT "MusicCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MusicSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
