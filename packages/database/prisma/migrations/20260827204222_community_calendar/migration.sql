-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarLocationKind" AS ENUM ('DISCORD', 'ONLINE', 'OFFLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "CalendarRegistrationStatus" AS ENUM ('CONFIRMED', 'WAITLIST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarNoticeKind" AS ENUM ('ANNOUNCEMENT', 'REMINDER', 'UPDATE', 'CANCELLED');

-- CreateTable
CREATE TABLE "CalendarCategory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#83060A',
    "icon" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT,
    "categoryId" TEXT,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Zurich',
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "locationKind" "CalendarLocationKind" NOT NULL DEFAULT 'DISCORD',
    "locationChannelId" TEXT,
    "locationVoiceId" TEXT,
    "locationUrl" TEXT,
    "locationName" TEXT,
    "locationAddress" TEXT,
    "bannerUrl" TEXT,
    "iconUrl" TEXT,
    "createdByDiscordId" TEXT NOT NULL,
    "organizerDiscordIds" TEXT[],
    "contactNote" TEXT,
    "registrationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "registrationClosesAt" TIMESTAMP(3),
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowSelfCancel" BOOLEAN NOT NULL DEFAULT true,
    "cancelDeadlineAt" TIMESTAMP(3),
    "participantsPublic" BOOLEAN NOT NULL DEFAULT true,
    "announceOnDiscord" BOOLEAN NOT NULL DEFAULT false,
    "announcementChannelId" TEXT,
    "mentionRoleId" TEXT,
    "discordMessageId" TEXT,
    "discordMessageMissing" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarQuestion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hint" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "choices" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CalendarQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarRegistration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "status" "CalendarRegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "waitlistPosition" INTEGER,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "promotedAt" TIMESTAMP(3),
    "promotionNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "CalendarRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarAnswer" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "CalendarAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarReminder" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "channelId" TEXT,
    "mentionRoleId" TEXT,
    "mentionRegistrants" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "discordMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarNotice" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "CalendarNoticeKind" NOT NULL,
    "channelId" TEXT,
    "discordMessageId" TEXT,
    "sentByDiscordId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarCategory_guildId_active_position_idx" ON "CalendarCategory"("guildId", "active", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarCategory_guildId_slug_key" ON "CalendarCategory"("guildId", "slug");

-- CreateIndex
CREATE INDEX "CalendarEvent_guildId_status_startAt_idx" ON "CalendarEvent"("guildId", "status", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_guildId_startAt_idx" ON "CalendarEvent"("guildId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_guildId_endAt_idx" ON "CalendarEvent"("guildId", "endAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_guildId_categoryId_startAt_idx" ON "CalendarEvent"("guildId", "categoryId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_status_startAt_idx" ON "CalendarEvent"("status", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_guildId_slug_key" ON "CalendarEvent"("guildId", "slug");

-- CreateIndex
CREATE INDEX "CalendarQuestion_eventId_position_idx" ON "CalendarQuestion"("eventId", "position");

-- CreateIndex
CREATE INDEX "CalendarRegistration_eventId_status_registeredAt_idx" ON "CalendarRegistration"("eventId", "status", "registeredAt");

-- CreateIndex
CREATE INDEX "CalendarRegistration_eventId_status_waitlistPosition_idx" ON "CalendarRegistration"("eventId", "status", "waitlistPosition");

-- CreateIndex
CREATE INDEX "CalendarRegistration_discordId_registeredAt_idx" ON "CalendarRegistration"("discordId", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarRegistration_eventId_discordId_key" ON "CalendarRegistration"("eventId", "discordId");

-- CreateIndex
CREATE INDEX "CalendarAnswer_questionId_idx" ON "CalendarAnswer"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarAnswer_registrationId_questionId_key" ON "CalendarAnswer"("registrationId", "questionId");

-- CreateIndex
CREATE INDEX "CalendarReminder_sentAt_dueAt_idx" ON "CalendarReminder"("sentAt", "dueAt");

-- CreateIndex
CREATE INDEX "CalendarReminder_eventId_idx" ON "CalendarReminder"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarReminder_eventId_minutesBefore_key" ON "CalendarReminder"("eventId", "minutesBefore");

-- CreateIndex
CREATE INDEX "CalendarNotice_eventId_sentAt_idx" ON "CalendarNotice"("eventId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarNotice_eventId_kind_key" ON "CalendarNotice"("eventId", "kind");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CalendarCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarQuestion" ADD CONSTRAINT "CalendarQuestion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarRegistration" ADD CONSTRAINT "CalendarRegistration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarAnswer" ADD CONSTRAINT "CalendarAnswer_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "CalendarRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarAnswer" ADD CONSTRAINT "CalendarAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CalendarQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarReminder" ADD CONSTRAINT "CalendarReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarNotice" ADD CONSTRAINT "CalendarNotice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
