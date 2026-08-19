-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('USER', 'TEAM', 'MODERATOR', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "JailReleaseType" AS ENUM ('AUTOMATIC', 'MANUAL', 'RECONCILED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('JAIL_CREATE', 'JAIL_RELEASE', 'JAIL_EXTEND');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReconciliationMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "globalName" TEXT,
    "avatarHash" TEXT,
    "appRole" "AppRole" NOT NULL DEFAULT 'USER',
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "firstLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordIdentityCache" (
    "discordId" TEXT NOT NULL,
    "userId" TEXT,
    "isMember" BOOLEAN NOT NULL DEFAULT false,
    "roleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nickname" TEXT,
    "joinedGuildAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordIdentityCache_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "ManagedRole" (
    "id" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "keepOnJail" BOOLEAN NOT NULL DEFAULT false,
    "moderationLevel" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ModuleState" (
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ModuleState_pkey" PRIMARY KEY ("moduleId")
);

-- CreateTable
CREATE TABLE "JailEntry" (
    "id" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "targetUsername" TEXT NOT NULL,
    "targetDisplayName" TEXT,
    "moderatorDiscordId" TEXT NOT NULL,
    "moderatorUsername" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releaseType" "JailReleaseType",
    "releasedByDiscordId" TEXT,
    "releasedByUsername" TEXT,
    "roleSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keptRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "restoredRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "releaseStatus" "ActionStatus",
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "activeKey" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JailEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "type" "ModerationActionType" NOT NULL,
    "module" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "actorUsername" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "targetUsername" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'COMPLETED',
    "referenceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "module" TEXT,
    "actorDiscordId" TEXT,
    "actorUsername" TEXT,
    "targetDiscordId" TEXT,
    "targetLabel" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipHash" TEXT,
    "userAgent" TEXT,
    "previousHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'LOW',
    "discordId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "path" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "bucket" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("bucket","windowStart")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "actorDiscordId" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BotStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "online" BOOLEAN NOT NULL DEFAULT false,
    "wsPingMs" INTEGER,
    "guildMemberCount" INTEGER,
    "botUserId" TEXT,
    "botUsername" TEXT,
    "version" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "mode" "ReconciliationMode" NOT NULL DEFAULT 'AUTOMATIC',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "checked" INTEGER NOT NULL DEFAULT 0,
    "drift" INTEGER NOT NULL DEFAULT 0,
    "repaired" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscordIdentityCache_userId_key" ON "DiscordIdentityCache"("userId");

-- CreateIndex
CREATE INDEX "DiscordIdentityCache_fetchedAt_idx" ON "DiscordIdentityCache"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedRole_discordRoleId_key" ON "ManagedRole"("discordRoleId");

-- CreateIndex
CREATE INDEX "RolePermission_permission_idx" ON "RolePermission"("permission");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_discordRoleId_permission_key" ON "RolePermission"("discordRoleId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "JailEntry_activeKey_key" ON "JailEntry"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "JailEntry_idempotencyKey_key" ON "JailEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "JailEntry_targetDiscordId_startedAt_idx" ON "JailEntry"("targetDiscordId", "startedAt");

-- CreateIndex
CREATE INDEX "JailEntry_endsAt_idx" ON "JailEntry"("endsAt");

-- CreateIndex
CREATE INDEX "JailEntry_status_idx" ON "JailEntry"("status");

-- CreateIndex
CREATE INDEX "JailEntry_moderatorDiscordId_idx" ON "JailEntry"("moderatorDiscordId");

-- CreateIndex
CREATE INDEX "ModerationAction_targetDiscordId_createdAt_idx" ON "ModerationAction"("targetDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_actorDiscordId_createdAt_idx" ON "ModerationAction"("actorDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_createdAt_idx" ON "ModerationAction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_sequence_key" ON "AuditLog"("sequence");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_module_createdAt_idx" ON "AuditLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorDiscordId_createdAt_idx" ON "AuditLog"("actorDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetDiscordId_createdAt_idx" ON "AuditLog"("targetDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_success_createdAt_idx" ON "AuditLog"("success", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_discordId_createdAt_idx" ON "SecurityEvent"("discordId", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimitCounter_expiresAt_idx" ON "RateLimitCounter"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_scope_actorDiscordId_idx" ON "IdempotencyRecord"("scope", "actorDiscordId");

-- CreateIndex
CREATE INDEX "ReconciliationRun_module_startedAt_idx" ON "ReconciliationRun"("module", "startedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscordIdentityCache" ADD CONSTRAINT "DiscordIdentityCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_discordRoleId_fkey" FOREIGN KEY ("discordRoleId") REFERENCES "ManagedRole"("discordRoleId") ON DELETE CASCADE ON UPDATE CASCADE;

