-- CreateEnum
CREATE TYPE "AutomationKind" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'AWAITING_APPROVAL', 'SUCCESS', 'SKIPPED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationStepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'NO_OP', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "AutomationJobKind" AS ENUM ('SCHEDULE', 'RESUME', 'RETRY');

-- CreateEnum
CREATE TYPE "AutomationJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'DEAD');

-- CreateEnum
CREATE TYPE "AutomationConcurrency" AS ENUM ('ALLOW', 'SKIP_IF_RUNNING', 'QUEUE');

-- CreateEnum
CREATE TYPE "AutomationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AutomationEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "guildId" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "actorId" TEXT,
    "subjectId" TEXT,
    "entityId" TEXT,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "AutomationKind" NOT NULL DEFAULT 'USER',
    "systemKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "conditions" JSONB,
    "steps" JSONB NOT NULL,
    "concurrency" "AutomationConcurrency" NOT NULL DEFAULT 'ALLOW',
    "concurrencyKey" TEXT,
    "maxRunsPerMinute" INTEGER NOT NULL DEFAULT 60,
    "archivedAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" "AutomationRunStatus",
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "versionId" TEXT,
    "version" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" TEXT NOT NULL,
    "eventId" TEXT,
    "eventType" TEXT,
    "correlationId" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB NOT NULL,
    "error" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationStepRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "label" TEXT,
    "status" "AutomationStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,

    CONSTRAINT "AutomationStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "kind" "AutomationJobKind" NOT NULL,
    "status" "AutomationJobStatus" NOT NULL DEFAULT 'PENDING',
    "automationId" TEXT,
    "runId" TEXT,
    "guildId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "payload" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationApproval" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "status" "AutomationApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedByName" TEXT,
    "reason" TEXT,
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,

    CONSTRAINT "AutomationApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationEvent_processedAt_occurredAt_idx" ON "AutomationEvent"("processedAt", "occurredAt");

-- CreateIndex
CREATE INDEX "AutomationEvent_type_occurredAt_idx" ON "AutomationEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "AutomationEvent_correlationId_idx" ON "AutomationEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AutomationEvent_occurredAt_idx" ON "AutomationEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Automation_systemKey_key" ON "Automation"("systemKey");

-- CreateIndex
CREATE INDEX "Automation_guildId_enabled_triggerType_idx" ON "Automation"("guildId", "enabled", "triggerType");

-- CreateIndex
CREATE INDEX "Automation_enabled_triggerType_archivedAt_idx" ON "Automation"("enabled", "triggerType", "archivedAt");

-- CreateIndex
CREATE INDEX "Automation_guildId_archivedAt_idx" ON "Automation"("guildId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_automationId_version_key" ON "AutomationVersion"("automationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_idempotencyKey_key" ON "AutomationRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_guildId_status_createdAt_idx" ON "AutomationRun"("guildId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_status_createdAt_idx" ON "AutomationRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_correlationId_idx" ON "AutomationRun"("correlationId");

-- CreateIndex
CREATE INDEX "AutomationStepRun_runId_idx" ON "AutomationStepRun"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationStepRun_runId_index_key" ON "AutomationStepRun"("runId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationJob_dedupeKey_key" ON "AutomationJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "AutomationJob_status_runAt_idx" ON "AutomationJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "AutomationJob_automationId_status_idx" ON "AutomationJob"("automationId", "status");

-- CreateIndex
CREATE INDEX "AutomationApproval_status_requestedAt_idx" ON "AutomationApproval"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "AutomationApproval_guildId_status_idx" ON "AutomationApproval"("guildId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationApproval_runId_stepIndex_key" ON "AutomationApproval"("runId", "stepIndex");

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationStepRun" ADD CONSTRAINT "AutomationStepRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationApproval" ADD CONSTRAINT "AutomationApproval_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
