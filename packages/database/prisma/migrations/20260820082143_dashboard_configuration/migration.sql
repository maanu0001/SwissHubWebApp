-- AlterTable
ALTER TABLE "ModuleState" ADD COLUMN     "configVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "guildId" TEXT NOT NULL,
    "name" TEXT,
    "iconHash" TEXT,
    "ownerId" TEXT,
    "memberCount" INTEGER,
    "presenceCount" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "setupCompletedAt" TIMESTAMP(3),
    "setupCompletedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordRoleCache" (
    "roleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "managed" BOOLEAN NOT NULL DEFAULT false,
    "hoist" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT NOT NULL DEFAULT '0',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DiscordRoleCache_pkey" PRIMARY KEY ("roleId")
);

-- CreateTable
CREATE TABLE "DiscordChannelCache" (
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "nsfw" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DiscordChannelCache_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
CREATE TABLE "ConfigRevision" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "revision" BIGINT NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "reason" TEXT,

    CONSTRAINT "ConfigRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "roles" INTEGER NOT NULL DEFAULT 0,
    "channels" INTEGER NOT NULL DEFAULT 0,
    "removedRoles" INTEGER NOT NULL DEFAULT 0,
    "removedChannels" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "triggeredBy" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE INDEX "DiscordRoleCache_position_idx" ON "DiscordRoleCache"("position");

-- CreateIndex
CREATE INDEX "DiscordRoleCache_deletedAt_idx" ON "DiscordRoleCache"("deletedAt");

-- CreateIndex
CREATE INDEX "DiscordChannelCache_type_idx" ON "DiscordChannelCache"("type");

-- CreateIndex
CREATE INDEX "DiscordChannelCache_deletedAt_idx" ON "DiscordChannelCache"("deletedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");
