-- CreateEnum
CREATE TYPE "PremiumEntitlement" AS ENUM ('PREMIUM_ROLE', 'PREMIUM_STUEBLI_ROLE', 'PRIVATE_VOICE');

-- CreateEnum
CREATE TYPE "PremiumSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'PAYMENT_FAILED', 'CANCEL_AT_PERIOD_END', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PremiumPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PremiumSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "PremiumResourceType" AS ENUM ('PREMIUM_STUEBLI_VOICE');

-- CreateEnum
CREATE TYPE "PremiumResourceState" AS ENUM ('PENDING', 'ACTIVE', 'FAILED', 'REMOVING', 'REMOVED');

-- CreateEnum
CREATE TYPE "PremiumEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateTable
CREATE TABLE "PremiumProduct" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "features" JSONB NOT NULL DEFAULT '[]',
    "entitlements" "PremiumEntitlement"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "providerPriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "PremiumSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "activeUserKey" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "discordSyncStatus" "PremiumSyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PremiumSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "status" "PremiumPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "PremiumPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumPaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processingStatus" "PremiumEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PremiumPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PremiumDiscordResource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "guildId" TEXT NOT NULL,
    "resourceType" "PremiumResourceType" NOT NULL,
    "discordResourceId" TEXT,
    "discordCategoryId" TEXT,
    "name" TEXT,
    "state" "PremiumResourceState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,

    CONSTRAINT "PremiumDiscordResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PremiumProduct_slug_key" ON "PremiumProduct"("slug");

-- CreateIndex
CREATE INDEX "PremiumProduct_active_sortOrder_idx" ON "PremiumProduct"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "PremiumSubscription_userId_createdAt_idx" ON "PremiumSubscription"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PremiumSubscription_status_idx" ON "PremiumSubscription"("status");

-- CreateIndex
CREATE INDEX "PremiumSubscription_discordSyncStatus_idx" ON "PremiumSubscription"("discordSyncStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumSubscription_activeUserKey_key" ON "PremiumSubscription"("activeUserKey");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumSubscription_providerSubscriptionId_key" ON "PremiumSubscription"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "PremiumPayment_userId_createdAt_idx" ON "PremiumPayment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PremiumPayment_status_idx" ON "PremiumPayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumPayment_provider_providerPaymentId_key" ON "PremiumPayment"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "PremiumPaymentEvent_processingStatus_createdAt_idx" ON "PremiumPaymentEvent"("processingStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumPaymentEvent_provider_providerEventId_key" ON "PremiumPaymentEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "PremiumDiscordResource_state_idx" ON "PremiumDiscordResource"("state");

-- CreateIndex
CREATE INDEX "PremiumDiscordResource_discordResourceId_idx" ON "PremiumDiscordResource"("discordResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PremiumDiscordResource_userId_resourceType_key" ON "PremiumDiscordResource"("userId", "resourceType");

-- AddForeignKey
ALTER TABLE "PremiumSubscription" ADD CONSTRAINT "PremiumSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumSubscription" ADD CONSTRAINT "PremiumSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "PremiumProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumPayment" ADD CONSTRAINT "PremiumPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PremiumSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PremiumDiscordResource" ADD CONSTRAINT "PremiumDiscordResource_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PremiumSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
