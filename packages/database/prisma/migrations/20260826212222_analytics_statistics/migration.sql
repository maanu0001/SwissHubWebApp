-- Analytics: die Statistik.
--
-- Rein additiv: sieben neue Tabellen und ein neuer Aufzählungstyp. Keine
-- bestehende Tabelle wird angefasst, nichts gelöscht oder umbenannt.
--
-- Warum eigene Tabellen und nicht eine Auswertung über `DiscordEvent`: die
-- Ereignistabelle wächst auf Millionen Zeilen, und eine Statistikseite, die
-- sie bei jedem Aufruf durchrechnet, wird mit der Zeit unbenutzbar. Die
-- Zahlen entstehen deshalb beim Aufzeichnen und werden hier fortgeschrieben.
--
-- Alle `day`-Spalten tragen Kalendertage in Europe/Zurich.

-- CreateEnum
CREATE TYPE "AnalyticsChannelKind" AS ENUM ('TEXT', 'VOICE');

-- CreateTable
CREATE TABLE "AnalyticsTracking" (
    "guildId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messagesSince" TIMESTAMP(3),
    "voiceSince" TIMESTAMP(3),
    "backfilledUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsTracking_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "AnalyticsVoiceSegment" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "parentId" TEXT,
    "isAfk" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "seconds" INTEGER,

    CONSTRAINT "AnalyticsVoiceSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsHourly" (
    "guildId" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "voiceSessions" INTEGER NOT NULL DEFAULT 0,
    "joins" INTEGER NOT NULL DEFAULT 0,
    "leaves" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsHourly_pkey" PRIMARY KEY ("guildId","hourStart")
);

-- CreateTable
CREATE TABLE "AnalyticsDaily" (
    "guildId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "voiceSessions" INTEGER NOT NULL DEFAULT 0,
    "joins" INTEGER NOT NULL DEFAULT 0,
    "leaves" INTEGER NOT NULL DEFAULT 0,
    "memberCount" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("guildId","day")
);

-- CreateTable
CREATE TABLE "AnalyticsUserDaily" (
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "voiceSessions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsUserDaily_pkey" PRIMARY KEY ("guildId","discordId","day")
);

-- CreateTable
CREATE TABLE "AnalyticsChannelDaily" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" "AnalyticsChannelKind" NOT NULL,
    "channelName" TEXT,
    "parentId" TEXT,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsChannelDaily_pkey" PRIMARY KEY ("guildId","channelId","day")
);

-- CreateTable
CREATE TABLE "AnalyticsMemberProfile" (
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "firstActivityAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsMemberProfile_pkey" PRIMARY KEY ("guildId","discordId")
);

-- CreateIndex
CREATE INDEX "AnalyticsVoiceSegment_guildId_discordId_joinedAt_idx" ON "AnalyticsVoiceSegment"("guildId", "discordId", "joinedAt");

-- CreateIndex
CREATE INDEX "AnalyticsVoiceSegment_guildId_channelId_joinedAt_idx" ON "AnalyticsVoiceSegment"("guildId", "channelId", "joinedAt");

-- CreateIndex
CREATE INDEX "AnalyticsVoiceSegment_guildId_joinedAt_idx" ON "AnalyticsVoiceSegment"("guildId", "joinedAt");

-- CreateIndex
CREATE INDEX "AnalyticsVoiceSegment_guildId_leftAt_idx" ON "AnalyticsVoiceSegment"("guildId", "leftAt");

-- CreateIndex
CREATE INDEX "AnalyticsVoiceSegment_sessionId_idx" ON "AnalyticsVoiceSegment"("sessionId");

-- CreateIndex
CREATE INDEX "AnalyticsHourly_guildId_hourStart_idx" ON "AnalyticsHourly"("guildId", "hourStart");

-- CreateIndex
CREATE INDEX "AnalyticsDaily_guildId_day_idx" ON "AnalyticsDaily"("guildId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsUserDaily_guildId_day_idx" ON "AnalyticsUserDaily"("guildId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsUserDaily_guildId_discordId_day_idx" ON "AnalyticsUserDaily"("guildId", "discordId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsChannelDaily_guildId_day_idx" ON "AnalyticsChannelDaily"("guildId", "day");

-- CreateIndex
CREATE INDEX "AnalyticsChannelDaily_guildId_kind_day_idx" ON "AnalyticsChannelDaily"("guildId", "kind", "day");

-- CreateIndex
CREATE INDEX "AnalyticsMemberProfile_guildId_joinedAt_idx" ON "AnalyticsMemberProfile"("guildId", "joinedAt");

-- CreateIndex
CREATE INDEX "AnalyticsMemberProfile_guildId_leftAt_idx" ON "AnalyticsMemberProfile"("guildId", "leftAt");

-- CreateIndex
CREATE INDEX "AnalyticsMemberProfile_guildId_firstActivityAt_idx" ON "AnalyticsMemberProfile"("guildId", "firstActivityAt");
