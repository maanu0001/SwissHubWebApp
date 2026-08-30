-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'WAITING_FOR_APPLICANT', 'WAITING_FOR_STAFF', 'ESCALATED', 'DECISION_PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'RESOLVED_EXTERNALLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "AppealPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AppealDecisionKind" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "AppealMessageAuthor" AS ENUM ('APPLICANT', 'STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AppealVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AppealEventKind" AS ENUM ('CREATED', 'SUBMITTED', 'ASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'STAFF_MESSAGE', 'APPLICANT_MESSAGE', 'INTERNAL_COMMENT', 'ESCALATED', 'DECISION_PROPOSED', 'DECISION_CONFIRMED', 'APPROVED', 'REJECTED', 'UNBAN_ATTEMPTED', 'UNBAN_SUCCEEDED', 'UNBAN_FAILED', 'WITHDRAWN', 'EXPIRED', 'SANCTION_LIFTED_EXTERNALLY', 'CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "caseYear" INTEGER NOT NULL,
    "applicantDiscordId" TEXT NOT NULL,
    "applicantUsername" TEXT NOT NULL,
    "applicantAvatarHash" TEXT,
    "status" "AppealStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "AppealPriority" NOT NULL DEFAULT 'NORMAL',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "banSnapshot" JSONB NOT NULL DEFAULT '{}',
    "sanctionActionId" TEXT,
    "assignedToDiscordId" TEXT,
    "assignedToUsername" TEXT,
    "assignedAt" TIMESTAMP(3),
    "publicDecision" TEXT,
    "internalDecision" TEXT,
    "decisionKind" "AppealDecisionKind",
    "decidedAt" TIMESTAMP(3),
    "decidedByDiscordId" TEXT,
    "decidedByUsername" TEXT,
    "proposedByDiscordId" TEXT,
    "proposedByUsername" TEXT,
    "proposedAt" TIMESTAMP(3),
    "unbanStatus" "ActionStatus",
    "unbanAttemptAt" TIMESTAMP(3),
    "unbanError" TEXT,
    "nextEligibleAt" TIMESTAMP(3),
    "finalRejection" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "waitingUntil" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealCounter" (
    "guildId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppealCounter_pkey" PRIMARY KEY ("guildId","year")
);

-- CreateTable
CREATE TABLE "AppealMessage" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "author" "AppealMessageAuthor" NOT NULL,
    "authorDiscordId" TEXT,
    "authorUsername" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "AppealMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealInternalComment" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "AppealInternalComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealAttachment" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "messageId" TEXT,
    "uploadedByDiscordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AppealAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealEvent" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "kind" "AppealEventKind" NOT NULL,
    "visibility" "AppealVisibility" NOT NULL DEFAULT 'INTERNAL',
    "actorDiscordId" TEXT,
    "actorUsername" TEXT,
    "publicLabel" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appeal_guildId_status_createdAt_idx" ON "Appeal"("guildId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Appeal_applicantDiscordId_createdAt_idx" ON "Appeal"("applicantDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "Appeal_guildId_assignedToDiscordId_status_idx" ON "Appeal"("guildId", "assignedToDiscordId", "status");

-- CreateIndex
CREATE INDEX "Appeal_status_waitingUntil_idx" ON "Appeal"("status", "waitingUntil");

-- CreateIndex
CREATE INDEX "Appeal_guildId_status_priority_idx" ON "Appeal"("guildId", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Appeal_guildId_caseYear_caseNumber_key" ON "Appeal"("guildId", "caseYear", "caseNumber");

-- CreateIndex
CREATE INDEX "AppealMessage_appealId_createdAt_idx" ON "AppealMessage"("appealId", "createdAt");

-- CreateIndex
CREATE INDEX "AppealInternalComment_appealId_createdAt_idx" ON "AppealInternalComment"("appealId", "createdAt");

-- CreateIndex
CREATE INDEX "AppealAttachment_appealId_createdAt_idx" ON "AppealAttachment"("appealId", "createdAt");

-- CreateIndex
CREATE INDEX "AppealAttachment_messageId_idx" ON "AppealAttachment"("messageId");

-- CreateIndex
CREATE INDEX "AppealEvent_appealId_createdAt_idx" ON "AppealEvent"("appealId", "createdAt");

-- CreateIndex
CREATE INDEX "AppealEvent_appealId_visibility_createdAt_idx" ON "AppealEvent"("appealId", "visibility", "createdAt");

-- AddForeignKey
ALTER TABLE "AppealMessage" ADD CONSTRAINT "AppealMessage_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealInternalComment" ADD CONSTRAINT "AppealInternalComment_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealAttachment" ADD CONSTRAINT "AppealAttachment_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealAttachment" ADD CONSTRAINT "AppealAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AppealMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealEvent" ADD CONSTRAINT "AppealEvent_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
