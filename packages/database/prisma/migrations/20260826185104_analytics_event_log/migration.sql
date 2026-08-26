-- Analytics: das Ereignisprotokoll des Discord-Servers.
--
-- Rein additiv: drei neue Tabellen und drei neue Aufzählungstypen. Keine
-- bestehende Tabelle wird angefasst, nichts wird gelöscht oder umbenannt.
-- Auf einer laufenden Installation ist das ein reines Hinzufügen; die
-- Anwendung läuft während der Migration weiter.
--
-- `DiscordEvent` ist der eigentliche Verlauf, `DiscordMessageSnapshot` der
-- letzte bekannte Stand einer Nachricht (Discord liefert ihn beim Löschen
-- nicht mit), `DiscordEventMedia` das Verzeichnis der archivierten Dateien.

-- CreateEnum
CREATE TYPE "DiscordEventCategory" AS ENUM ('MESSAGE', 'VOICE', 'MEMBER', 'ROLE', 'CHANNEL', 'SERVER');

-- CreateEnum
CREATE TYPE "DiscordEventSeverity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DiscordActorSource" AS ENUM ('GATEWAY', 'AUDIT_LOG', 'WEBAPP', 'UNKNOWN');

-- CreateTable
CREATE TABLE "DiscordEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "category" "DiscordEventCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "DiscordEventSeverity" NOT NULL DEFAULT 'INFO',
    "actorDiscordId" TEXT,
    "actorUsername" TEXT,
    "actorSource" "DiscordActorSource" NOT NULL DEFAULT 'UNKNOWN',
    "subjectDiscordId" TEXT,
    "subjectUsername" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "messageId" TEXT,
    "contentBefore" TEXT,
    "contentAfter" TEXT,
    "moderationActionId" TEXT,
    "bulkId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordMessageSnapshot" (
    "messageId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "replyToMessageId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordMessageSnapshot_pkey" PRIMARY KEY ("messageId")
);

-- CreateTable
CREATE TABLE "DiscordEventMedia" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordEventMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_occurredAt_idx" ON "DiscordEvent"("guildId", "occurredAt");

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_category_occurredAt_idx" ON "DiscordEvent"("guildId", "category", "occurredAt");

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_type_occurredAt_idx" ON "DiscordEvent"("guildId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_actorDiscordId_occurredAt_idx" ON "DiscordEvent"("guildId", "actorDiscordId", "occurredAt");

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_subjectDiscordId_occurredAt_idx" ON "DiscordEvent"("guildId", "subjectDiscordId", "occurredAt");

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_channelId_occurredAt_idx" ON "DiscordEvent"("guildId", "channelId", "occurredAt");

-- CreateIndex
CREATE INDEX "DiscordEvent_guildId_messageId_idx" ON "DiscordEvent"("guildId", "messageId");

-- CreateIndex
CREATE INDEX "DiscordEvent_bulkId_idx" ON "DiscordEvent"("bulkId");

-- CreateIndex
CREATE INDEX "DiscordEvent_moderationActionId_idx" ON "DiscordEvent"("moderationActionId");

-- CreateIndex
CREATE INDEX "DiscordMessageSnapshot_guildId_postedAt_idx" ON "DiscordMessageSnapshot"("guildId", "postedAt");

-- CreateIndex
CREATE INDEX "DiscordMessageSnapshot_guildId_channelId_postedAt_idx" ON "DiscordMessageSnapshot"("guildId", "channelId", "postedAt");

-- CreateIndex
CREATE INDEX "DiscordMessageSnapshot_guildId_authorDiscordId_postedAt_idx" ON "DiscordMessageSnapshot"("guildId", "authorDiscordId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordEventMedia_storageKey_key" ON "DiscordEventMedia"("storageKey");

-- CreateIndex
CREATE INDEX "DiscordEventMedia_guildId_createdAt_idx" ON "DiscordEventMedia"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscordEventMedia_expiresAt_deletedAt_idx" ON "DiscordEventMedia"("expiresAt", "deletedAt");

-- CreateIndex
CREATE INDEX "DiscordEventMedia_sha256_idx" ON "DiscordEventMedia"("sha256");

-- AddForeignKey
ALTER TABLE "DiscordEventMedia" ADD CONSTRAINT "DiscordEventMedia_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DiscordEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
