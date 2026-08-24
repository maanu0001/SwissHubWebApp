-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('PENDING', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_STAFF', 'RESOLVED', 'CLOSED', 'ARCHIVED', 'CREATION_FAILED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('DISCORD_PANEL', 'DISCORD_COMMAND', 'WEBAPP', 'ADMIN');

-- CreateEnum
CREATE TYPE "TicketMessageSource" AS ENUM ('DISCORD', 'WEBAPP', 'BOT', 'SYSTEM', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "TicketEventKind" AS ENUM ('CREATED', 'CLAIMED', 'ASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'TAG_ADDED', 'TAG_REMOVED', 'USER_ADDED', 'USER_REMOVED', 'CLOSED', 'REOPENED', 'ARCHIVED', 'CHANNEL_RECREATED', 'CHANNEL_MISSING', 'ESCALATED');

-- CreateEnum
CREATE TYPE "TicketActorSource" AS ENUM ('WEBAPP', 'DISCORD', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TicketFormFieldKind" AS ENUM ('SHORT_TEXT', 'LONG_TEXT');

-- CreateEnum
CREATE TYPE "TicketCloseBehaviour" AS ENUM ('DELETE_IMMEDIATELY', 'KEEP_24H', 'KEEP_7D', 'KEEP_FOREVER');

-- CreateEnum
CREATE TYPE "TicketTranscriptAudience" AS ENUM ('USER', 'STAFF');

-- CreateTable
CREATE TABLE "TicketCategory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "color" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "discordCategoryId" TEXT,
    "overflowCategoryId" TEXT,
    "supportRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pingSupport" BOOLEAN NOT NULL DEFAULT false,
    "defaultPriority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "channelNameTemplate" TEXT NOT NULL DEFAULT 'ticket-{number}-{username}',
    "welcomeMessage" TEXT,
    "closeMessage" TEXT,
    "maxOpenPerUser" INTEGER NOT NULL DEFAULT 0,
    "userCanClose" BOOLEAN NOT NULL DEFAULT true,
    "reminderAfterDays" INTEGER NOT NULL DEFAULT 0,
    "autoCloseAfterDays" INTEGER NOT NULL DEFAULT 0,
    "responseTargetHours" INTEGER NOT NULL DEFAULT 0,
    "resolutionTargetHours" INTEGER NOT NULL DEFAULT 0,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketFormField" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "kind" "TicketFormFieldKind" NOT NULL DEFAULT 'SHORT_TEXT',
    "label" TEXT NOT NULL,
    "placeholder" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minLength" INTEGER,
    "maxLength" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketFormField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPanel" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "thumbnailUrl" TEXT,
    "footerText" TEXT,
    "color" INTEGER,
    "discordChannelId" TEXT NOT NULL,
    "discordMessageId" TEXT,
    "buttonLabel" TEXT NOT NULL DEFAULT 'Ticket erstellen',
    "buttonEmoji" TEXT DEFAULT '🎫',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "missingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketPanelCategory" (
    "id" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketPanelCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "categoryId" TEXT,
    "subject" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "source" "TicketSource" NOT NULL DEFAULT 'DISCORD_PANEL',
    "creatorDiscordId" TEXT NOT NULL,
    "creatorUsername" TEXT NOT NULL,
    "assignedToDiscordId" TEXT,
    "assignedToUsername" TEXT,
    "assignedAt" TIMESTAMP(3),
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "channelMissing" BOOLEAN NOT NULL DEFAULT false,
    "formAnswers" JSONB NOT NULL DEFAULT '{}',
    "firstStaffResponseAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastMessageByStaff" BOOLEAN,
    "closedAt" TIMESTAMP(3),
    "closedByDiscordId" TEXT,
    "closeReason" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "channelPurgeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketParticipant" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "addedByDiscordId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "TicketParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "source" "TicketMessageSource" NOT NULL,
    "discordMessageId" TEXT,
    "authorDiscordId" TEXT,
    "authorUsername" TEXT,
    "authorAvatarHash" TEXT,
    "fromStaff" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "url" TEXT NOT NULL,
    "stored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTag" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTagAssignment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "addedByDiscordId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTagAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" "TicketEventKind" NOT NULL,
    "actorDiscordId" TEXT,
    "actorUsername" TEXT,
    "actorSource" "TicketActorSource" NOT NULL DEFAULT 'SYSTEM',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTranscript" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "audience" "TicketTranscriptAudience" NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketFeedback" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "givenByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketBlockEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "reason" TEXT NOT NULL,
    "blockedByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "TicketBlockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTemplate" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCounter" (
    "guildId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("guildId")
);

-- CreateIndex
CREATE INDEX "TicketCategory_guildId_active_sortOrder_idx" ON "TicketCategory"("guildId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "TicketFormField_categoryId_sortOrder_idx" ON "TicketFormField"("categoryId", "sortOrder");

-- CreateIndex
CREATE INDEX "TicketPanel_guildId_active_idx" ON "TicketPanel"("guildId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPanel_discordMessageId_key" ON "TicketPanel"("discordMessageId");

-- CreateIndex
CREATE INDEX "TicketPanelCategory_panelId_sortOrder_idx" ON "TicketPanelCategory"("panelId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TicketPanelCategory_panelId_categoryId_key" ON "TicketPanelCategory"("panelId", "categoryId");

-- CreateIndex
CREATE INDEX "Ticket_guildId_status_priority_idx" ON "Ticket"("guildId", "status", "priority");

-- CreateIndex
CREATE INDEX "Ticket_guildId_categoryId_status_idx" ON "Ticket"("guildId", "categoryId", "status");

-- CreateIndex
CREATE INDEX "Ticket_creatorDiscordId_createdAt_idx" ON "Ticket"("creatorDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_assignedToDiscordId_status_idx" ON "Ticket"("assignedToDiscordId", "status");

-- CreateIndex
CREATE INDEX "Ticket_status_lastMessageAt_idx" ON "Ticket"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Ticket_guildId_closedAt_idx" ON "Ticket"("guildId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_guildId_ticketNumber_key" ON "Ticket"("guildId", "ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_discordChannelId_key" ON "Ticket"("discordChannelId");

-- CreateIndex
CREATE INDEX "TicketParticipant_discordId_idx" ON "TicketParticipant"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketParticipant_ticketId_discordId_key" ON "TicketParticipant"("ticketId", "discordId");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_source_idx" ON "TicketMessage"("ticketId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "TicketMessage_discordMessageId_key" ON "TicketMessage"("discordMessageId");

-- CreateIndex
CREATE INDEX "TicketAttachment_messageId_idx" ON "TicketAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTag_guildId_name_key" ON "TicketTag"("guildId", "name");

-- CreateIndex
CREATE INDEX "TicketTagAssignment_tagId_idx" ON "TicketTagAssignment"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTagAssignment_ticketId_tagId_key" ON "TicketTagAssignment"("ticketId", "tagId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketTranscript_ticketId_idx" ON "TicketTranscript"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTranscript_ticketId_audience_key" ON "TicketTranscript"("ticketId", "audience");

-- CreateIndex
CREATE INDEX "TicketFeedback_createdAt_idx" ON "TicketFeedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketFeedback_ticketId_key" ON "TicketFeedback"("ticketId");

-- CreateIndex
CREATE INDEX "TicketBlockEntry_guildId_discordId_liftedAt_idx" ON "TicketBlockEntry"("guildId", "discordId", "liftedAt");

-- CreateIndex
CREATE INDEX "TicketTemplate_guildId_categoryId_idx" ON "TicketTemplate"("guildId", "categoryId");

-- AddForeignKey
ALTER TABLE "TicketFormField" ADD CONSTRAINT "TicketFormField_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketPanelCategory" ADD CONSTRAINT "TicketPanelCategory_panelId_fkey" FOREIGN KEY ("panelId") REFERENCES "TicketPanel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketPanelCategory" ADD CONSTRAINT "TicketPanelCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketParticipant" ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "TicketMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTagAssignment" ADD CONSTRAINT "TicketTagAssignment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTagAssignment" ADD CONSTRAINT "TicketTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TicketTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTranscript" ADD CONSTRAINT "TicketTranscript_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketFeedback" ADD CONSTRAINT "TicketFeedback_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTemplate" ADD CONSTRAINT "TicketTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
