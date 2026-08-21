-- CreateEnum
CREATE TYPE "CommunicationSource" AS ENUM ('WEBAPP', 'SLASH_COMMAND');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('DRAFT', 'SENT', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "CommunicationRegistrationType" AS ENUM ('NONE', 'TEXT', 'TICKET', 'CHANNEL', 'URL');

-- CreateEnum
CREATE TYPE "CommunicationMentionType" AS ENUM ('NONE', 'EVERYONE', 'HERE', 'ROLE', 'USER');

-- AlterTable
ALTER TABLE "CommunicationMessage" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedByDiscordId" TEXT,
ADD COLUMN     "eventDateText" TEXT,
ADD COLUMN     "eventLocation" TEXT,
ADD COLUMN     "eventResponsibleId" TEXT,
ADD COLUMN     "eventStartsAt" TIMESTAMP(3),
ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "failureMessage" TEXT,
ADD COLUMN     "mentionTarget" TEXT,
ADD COLUMN     "mentionType" "CommunicationMentionType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "registrationType" "CommunicationRegistrationType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "registrationValue" TEXT,
ADD COLUMN     "source" "CommunicationSource" NOT NULL DEFAULT 'WEBAPP',
ADD COLUMN     "status" "CommunicationStatus" NOT NULL DEFAULT 'SENT';

-- CreateTable
CREATE TABLE "CommunicationDraft" (
    "id" TEXT NOT NULL,
    "type" "CommunicationType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "bannerUrl" TEXT,
    "discordChannelId" TEXT,
    "mentionType" "CommunicationMentionType" NOT NULL DEFAULT 'NONE',
    "mentionTarget" TEXT,
    "eventLocation" TEXT,
    "eventStartsAt" TIMESTAMP(3),
    "eventResponsibleId" TEXT,
    "registrationType" "CommunicationRegistrationType" NOT NULL DEFAULT 'NONE',
    "registrationValue" TEXT,
    "createdByDiscordId" TEXT NOT NULL,
    "createdByUsername" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunicationDraft_createdByDiscordId_updatedAt_idx" ON "CommunicationDraft"("createdByDiscordId", "updatedAt");

-- CreateIndex
CREATE INDEX "CommunicationDraft_updatedAt_idx" ON "CommunicationDraft"("updatedAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_status_sentAt_idx" ON "CommunicationMessage"("status", "sentAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_sentByDiscordId_idx" ON "CommunicationMessage"("sentByDiscordId");

