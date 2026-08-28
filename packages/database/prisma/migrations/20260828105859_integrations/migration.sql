-- CreateEnum
CREATE TYPE "IntegrationScope" AS ENUM ('GLOBAL', 'GUILD');

-- CreateEnum
CREATE TYPE "IntegrationHealth" AS ENUM ('CONNECTED', 'DEGRADED', 'NOT_CONFIGURED', 'ERROR');

-- CreateEnum
CREATE TYPE "IntegrationBotKind" AS ENUM ('SYSTEM', 'MUSIC_CONTROLLER', 'MUSIC_WORKER');

-- CreateTable
CREATE TABLE "IntegrationSecret" (
    "id" TEXT NOT NULL,
    "scope" "IntegrationScope" NOT NULL DEFAULT 'GLOBAL',
    "guildId" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "envelope" TEXT NOT NULL DEFAULT 'v1',
    "hint" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationBot" (
    "id" TEXT NOT NULL,
    "kind" "IntegrationBotKind" NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clientId" TEXT,
    "botUsername" TEXT,
    "botUserId" TEXT,
    "status" "IntegrationHealth" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "IntegrationBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationStatus" (
    "provider" TEXT NOT NULL,
    "status" "IntegrationHealth" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "detail" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationStatus_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE INDEX "IntegrationSecret_provider_idx" ON "IntegrationSecret"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSecret_scope_guildId_provider_key_key" ON "IntegrationSecret"("scope", "guildId", "provider", "key");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationBot_slug_key" ON "IntegrationBot"("slug");

-- CreateIndex
CREATE INDEX "IntegrationBot_kind_position_idx" ON "IntegrationBot"("kind", "position");
