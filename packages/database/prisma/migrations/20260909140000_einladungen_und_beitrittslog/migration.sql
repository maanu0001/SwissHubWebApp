-- Beitritt und Austritt als eigene Log-Kategorie, plus der Spiegel der
-- Discord-Einladungen.
--
-- Rein additiv: ein neuer Enum-Wert und eine neue Tabelle. Bestehende
-- Log-Kanaele bleiben unveraendert; solange fuer JOIN_LEAVE kein Kanal
-- eingerichtet ist, gehen Beitritte weiter nach MEMBERS.
ALTER TYPE "DiscordLogCategory" ADD VALUE IF NOT EXISTS 'JOIN_LEAVE';

CREATE TABLE "DiscordInvite" (
  "id"               TEXT NOT NULL,
  "guildId"          TEXT NOT NULL,
  "code"             TEXT NOT NULL,
  "channelId"        TEXT,
  "channelName"      TEXT,
  "inviterDiscordId" TEXT,
  "inviterUsername"  TEXT,
  "uses"             INTEGER NOT NULL DEFAULT 0,
  "maxUses"          INTEGER NOT NULL DEFAULT 0,
  "expiresAt"        TIMESTAMP(3),
  "discordCreatedAt" TIMESTAMP(3),
  "attributedJoins"  INTEGER NOT NULL DEFAULT 0,
  "revokedAt"        TIMESTAMP(3),
  "lastSeenAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiscordInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscordInvite_guildId_code_key" ON "DiscordInvite" ("guildId", "code");
CREATE INDEX "DiscordInvite_guildId_revokedAt_idx" ON "DiscordInvite" ("guildId", "revokedAt");
CREATE INDEX "DiscordInvite_inviterDiscordId_idx" ON "DiscordInvite" ("inviterDiscordId");
