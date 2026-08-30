-- CreateEnum
CREATE TYPE "DiscordLogCategory" AS ENUM ('MODERATION', 'MESSAGES', 'VOICE', 'MEMBERS', 'ADMIN');

-- CreateEnum
CREATE TYPE "DiscordLogHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'INVALID', 'DISABLED');

-- CreateEnum
CREATE TYPE "DiscordLogDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "DiscordLogChannel" (
    "category" "DiscordLogCategory" NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "health" "DiscordLogHealth" NOT NULL DEFAULT 'HEALTHY',
    "healthNote" TEXT,
    "checkedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordLogChannel_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "DiscordLogDelivery" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "category" "DiscordLogCategory" NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "DiscordLogDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "discordMessageId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordLogDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscordLogChannel_guildId_idx" ON "DiscordLogChannel"("guildId");

-- CreateIndex
CREATE INDEX "DiscordLogChannel_channelId_idx" ON "DiscordLogChannel"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLogDelivery_dedupeKey_key" ON "DiscordLogDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "DiscordLogDelivery_status_runAt_idx" ON "DiscordLogDelivery"("status", "runAt");

-- CreateIndex
CREATE INDEX "DiscordLogDelivery_channelId_createdAt_idx" ON "DiscordLogDelivery"("channelId", "createdAt");

