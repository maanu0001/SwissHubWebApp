-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('WAITING_FOR_MESSAGE', 'AI_ANALYZING', 'WAITING_FOR_REVIEW', 'VERIFIED', 'REJECTED', 'LEFT_SERVER', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "VerificationDecider" AS ENUM ('HUMAN', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "VerificationAiVerdict" AS ENUM ('LIKELY_SWISS_GERMAN', 'UNCLEAR', 'NOT_RECOGNISED', 'FAILED');

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarHash" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'WAITING_FOR_MESSAGE',
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "accountCreatedAt" TIMESTAMP(3),
    "latestMessage" TEXT,
    "latestMessageId" TEXT,
    "latestMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "aiVerdict" "VerificationAiVerdict",
    "aiConfidence" DOUBLE PRECISION,
    "aiReasonCode" TEXT,
    "aiModel" TEXT,
    "aiCheckedAt" TIMESTAMP(3),
    "aiError" TEXT,
    "aiAttempts" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" "VerificationDecider",
    "decidedByDiscordId" TEXT,
    "decidedByUsername" TEXT,
    "decisionReason" TEXT,
    "modChannelId" TEXT,
    "modMessageId" TEXT,
    "noteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "discordMessageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRequest_guildId_status_createdAt_idx" ON "VerificationRequest"("guildId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_guildId_discordId_createdAt_idx" ON "VerificationRequest"("guildId", "discordId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_guildId_decidedAt_idx" ON "VerificationRequest"("guildId", "decidedAt");

-- CreateIndex
CREATE INDEX "VerificationRequest_status_joinedAt_idx" ON "VerificationRequest"("status", "joinedAt");

-- CreateIndex
CREATE INDEX "VerificationMessage_requestId_createdAt_idx" ON "VerificationMessage"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationMessage_requestId_discordMessageId_key" ON "VerificationMessage"("requestId", "discordMessageId");

-- AddForeignKey
ALTER TABLE "VerificationMessage" ADD CONSTRAINT "VerificationMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
