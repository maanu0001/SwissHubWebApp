-- CreateEnum
CREATE TYPE "TemporaryVoiceSource" AS ENUM ('VOICE_HUB', 'PLAYER_SEARCH', 'TOURNAMENT', 'EVENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VoiceAccessKind" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "VoiceHubEventKind" AS ENUM ('VOICE_CREATED', 'VOICE_DELETED', 'VOICE_RENAMED', 'VOICE_LIMIT_CHANGED', 'VOICE_LOCKED', 'VOICE_UNLOCKED', 'VOICE_HIDDEN', 'VOICE_SHOWN', 'MEMBER_ALLOWED', 'MEMBER_DENIED', 'MEMBER_KICKED', 'OWNER_TRANSFERRED', 'OWNER_AUTO_TRANSFERRED');

-- CreateTable
CREATE TABLE "VoicePreset" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameTemplate" TEXT NOT NULL DEFAULT '🔊 {username}''s Talk',
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "maxUserLimit" INTEGER NOT NULL DEFAULT 99,
    "bitrate" INTEGER,
    "lockedDefault" BOOLEAN NOT NULL DEFAULT false,
    "hiddenDefault" BOOLEAN NOT NULL DEFAULT false,
    "targetCategoryId" TEXT,
    "allowedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deleteGraceSeconds" INTEGER NOT NULL DEFAULT 30,
    "renameCooldownSeconds" INTEGER NOT NULL DEFAULT 300,
    "ownerModeration" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceHub" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discordChannelId" TEXT NOT NULL,
    "targetCategoryId" TEXT NOT NULL,
    "overflowCategoryId" TEXT,
    "presetId" TEXT NOT NULL,
    "allowedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryVoiceChannel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordChannelId" TEXT,
    "hubId" TEXT,
    "presetId" TEXT,
    "source" "TemporaryVoiceSource" NOT NULL DEFAULT 'VOICE_HUB',
    "externalRef" TEXT,
    "ownerDiscordId" TEXT NOT NULL,
    "ownerUsername" TEXT NOT NULL,
    "ownerLeftAt" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "userLimit" INTEGER NOT NULL DEFAULT 0,
    "bitrate" INTEGER,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "gameName" TEXT,
    "controlMessageId" TEXT,
    "lastRenamedAt" TIMESTAMP(3),
    "deleteScheduledAt" TIMESTAMP(3),
    "peakMembers" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TemporaryVoiceChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporaryVoiceAccess" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "kind" "VoiceAccessKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemporaryVoiceAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceUserPreference" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "preferredName" TEXT,
    "preferredLimit" INTEGER,
    "preferredBitrate" INTEGER,
    "applyPreferences" BOOLEAN NOT NULL DEFAULT false,
    "autoAllowTrusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceUserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceTrustedMember" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerDiscordId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceTrustedMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceHubEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT,
    "hubId" TEXT,
    "kind" "VoiceHubEventKind" NOT NULL,
    "actorDiscordId" TEXT,
    "targetDiscordId" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceHubEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoicePreset_guildId_sortOrder_idx" ON "VoicePreset"("guildId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "VoicePreset_guildId_name_key" ON "VoicePreset"("guildId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceHub_discordChannelId_key" ON "VoiceHub"("discordChannelId");

-- CreateIndex
CREATE INDEX "VoiceHub_guildId_enabled_idx" ON "VoiceHub"("guildId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceHub_guildId_name_key" ON "VoiceHub"("guildId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryVoiceChannel_discordChannelId_key" ON "TemporaryVoiceChannel"("discordChannelId");

-- CreateIndex
CREATE INDEX "TemporaryVoiceChannel_guildId_closedAt_idx" ON "TemporaryVoiceChannel"("guildId", "closedAt");

-- CreateIndex
CREATE INDEX "TemporaryVoiceChannel_guildId_ownerDiscordId_closedAt_idx" ON "TemporaryVoiceChannel"("guildId", "ownerDiscordId", "closedAt");

-- CreateIndex
CREATE INDEX "TemporaryVoiceChannel_deleteScheduledAt_idx" ON "TemporaryVoiceChannel"("deleteScheduledAt");

-- CreateIndex
CREATE INDEX "TemporaryVoiceChannel_hubId_idx" ON "TemporaryVoiceChannel"("hubId");

-- CreateIndex
CREATE INDEX "TemporaryVoiceChannel_source_closedAt_idx" ON "TemporaryVoiceChannel"("source", "closedAt");

-- CreateIndex
CREATE INDEX "TemporaryVoiceChannel_guildId_createdAt_idx" ON "TemporaryVoiceChannel"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "TemporaryVoiceAccess_channelId_kind_idx" ON "TemporaryVoiceAccess"("channelId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TemporaryVoiceAccess_channelId_discordId_key" ON "TemporaryVoiceAccess"("channelId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceUserPreference_guildId_discordId_key" ON "VoiceUserPreference"("guildId", "discordId");

-- CreateIndex
CREATE INDEX "VoiceTrustedMember_guildId_ownerDiscordId_idx" ON "VoiceTrustedMember"("guildId", "ownerDiscordId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceTrustedMember_guildId_ownerDiscordId_discordId_key" ON "VoiceTrustedMember"("guildId", "ownerDiscordId", "discordId");

-- CreateIndex
CREATE INDEX "VoiceHubEvent_guildId_createdAt_idx" ON "VoiceHubEvent"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceHubEvent_channelId_createdAt_idx" ON "VoiceHubEvent"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceHubEvent_guildId_kind_createdAt_idx" ON "VoiceHubEvent"("guildId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "VoiceHub" ADD CONSTRAINT "VoiceHub_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "VoicePreset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryVoiceChannel" ADD CONSTRAINT "TemporaryVoiceChannel_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "VoiceHub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryVoiceChannel" ADD CONSTRAINT "TemporaryVoiceChannel_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "VoicePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporaryVoiceAccess" ADD CONSTRAINT "TemporaryVoiceAccess_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TemporaryVoiceChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ein Beitritt, ein Talk.
--
-- Discord schickt `VoiceStateUpdate` durchaus mehrfach, und zwei Ereignisse
-- kurz hintereinander erzeugten sonst zwei Kanaele. Der Teilindex laesst je
-- Hub genau einen offenen Talk pro Person zu; der zweite Versuch scheitert an
-- der Datenbank statt an einer Prüfung, die zwischen Lesen und Schreiben
-- ueberholt werden kann.
--
-- Bewusst ein Teilindex: geschlossene Talks bleiben als Zeile stehen, und ohne
-- die Bedingung koennte niemand je einen zweiten Talk im selben Hub eroeffnen.
CREATE UNIQUE INDEX "TemporaryVoiceChannel_offen_je_hub"
  ON "TemporaryVoiceChannel" ("guildId", "ownerDiscordId", "hubId")
  WHERE "closedAt" IS NULL AND "hubId" IS NOT NULL;

