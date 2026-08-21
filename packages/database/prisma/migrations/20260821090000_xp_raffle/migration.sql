-- CreateEnum
CREATE TYPE "XpRaffleStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ENTRY_OPEN', 'ENTRY_CLOSED', 'DRAWING', 'WINNER_PENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "XpRaffleEntryModel" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "XpRaffleEntryStatus" AS ENUM ('ACTIVE', 'REFUNDED', 'DISQUALIFIED', 'WINNER');

-- CreateEnum
CREATE TYPE "XpRafflePrizeKind" AS ENUM ('EXTERNAL_PRIZE', 'XP_PRIZE', 'ROLE_PRIZE', 'TEXT_ONLY');

-- CreateEnum
CREATE TYPE "XpRaffleRefundReason" AS ENUM ('RAFFLE_CANCELLED', 'ENTRY_REMOVED', 'MINIMUM_NOT_REACHED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XpSource" ADD VALUE 'RAFFLE_ENTRY';
ALTER TYPE "XpSource" ADD VALUE 'RAFFLE_REFUND';
ALTER TYPE "XpSource" ADD VALUE 'RAFFLE_PRIZE';

-- CreateTable
CREATE TABLE "XpRaffle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "bannerPath" TEXT,
    "bannerUrl" TEXT,
    "prizeKind" "XpRafflePrizeKind" NOT NULL DEFAULT 'EXTERNAL_PRIZE',
    "prizeDescription" TEXT NOT NULL,
    "prizeXp" INTEGER,
    "prizeRoleId" TEXT,
    "status" "XpRaffleStatus" NOT NULL DEFAULT 'DRAFT',
    "entryModel" "XpRaffleEntryModel" NOT NULL,
    "fixedEntryXp" INTEGER,
    "percentageBasisPoints" INTEGER,
    "minimumEntryXp" INTEGER,
    "maximumEntryXp" INTEGER,
    "minimumParticipants" INTEGER NOT NULL DEFAULT 2,
    "maximumParticipants" INTEGER,
    "entryStartsAt" TIMESTAMP(3),
    "entryEndsAt" TIMESTAMP(3),
    "drawScheduledAt" TIMESTAMP(3),
    "autoDraw" BOOLEAN NOT NULL DEFAULT false,
    "participantsPublic" BOOLEAN NOT NULL DEFAULT true,
    "autoAnnounceWinner" BOOLEAN NOT NULL DEFAULT true,
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "discordMessageMissing" BOOLEAN NOT NULL DEFAULT false,
    "winnerMessageId" TEXT,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "potXp" INTEGER NOT NULL DEFAULT 0,
    "createdByDiscordId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "entryOpenedAt" TIMESTAMP(3),
    "entryClosedAt" TIMESTAMP(3),
    "drawStartedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedDrawId" TEXT,

    CONSTRAINT "XpRaffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpRaffleEntry" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "xpBeforeEntry" INTEGER NOT NULL,
    "entryXp" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" "XpRaffleEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "removalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XpRaffleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpRaffleDraw" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "participantCount" INTEGER NOT NULL,
    "totalWeight" INTEGER NOT NULL,
    "winnerEntryId" TEXT NOT NULL,
    "winnerDiscordId" TEXT NOT NULL,
    "drawnTicket" INTEGER NOT NULL,
    "entropy" TEXT NOT NULL,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "animationSeed" TEXT NOT NULL,
    "redrawReason" TEXT,
    "excludedEntryIds" TEXT[],
    "startedByDiscordId" TEXT NOT NULL,
    "confirmedByDiscordId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpRaffleDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XpRaffleRefund" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "XpRaffleRefundReason" NOT NULL,
    "note" TEXT,
    "actorDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XpRaffleRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "XpRaffle_confirmedDrawId_key" ON "XpRaffle"("confirmedDrawId");

-- CreateIndex
CREATE INDEX "XpRaffle_status_entryEndsAt_idx" ON "XpRaffle"("status", "entryEndsAt");

-- CreateIndex
CREATE INDEX "XpRaffle_status_drawScheduledAt_idx" ON "XpRaffle"("status", "drawScheduledAt");

-- CreateIndex
CREATE INDEX "XpRaffle_createdAt_idx" ON "XpRaffle"("createdAt");

-- CreateIndex
CREATE INDEX "XpRaffleEntry_raffleId_status_idx" ON "XpRaffleEntry"("raffleId", "status");

-- CreateIndex
CREATE INDEX "XpRaffleEntry_discordId_createdAt_idx" ON "XpRaffleEntry"("discordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpRaffleEntry_raffleId_discordId_key" ON "XpRaffleEntry"("raffleId", "discordId");

-- CreateIndex
CREATE INDEX "XpRaffleDraw_raffleId_createdAt_idx" ON "XpRaffleDraw"("raffleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "XpRaffleDraw_raffleId_version_key" ON "XpRaffleDraw"("raffleId", "version");

-- CreateIndex
CREATE INDEX "XpRaffleRefund_raffleId_idx" ON "XpRaffleRefund"("raffleId");

-- CreateIndex
CREATE UNIQUE INDEX "XpRaffleRefund_entryId_key" ON "XpRaffleRefund"("entryId");

-- AddForeignKey
ALTER TABLE "XpRaffle" ADD CONSTRAINT "XpRaffle_confirmedDrawId_fkey" FOREIGN KEY ("confirmedDrawId") REFERENCES "XpRaffleDraw"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpRaffleEntry" ADD CONSTRAINT "XpRaffleEntry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "XpRaffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpRaffleDraw" ADD CONSTRAINT "XpRaffleDraw_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "XpRaffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpRaffleDraw" ADD CONSTRAINT "XpRaffleDraw_winnerEntryId_fkey" FOREIGN KEY ("winnerEntryId") REFERENCES "XpRaffleEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpRaffleRefund" ADD CONSTRAINT "XpRaffleRefund_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "XpRaffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XpRaffleRefund" ADD CONSTRAINT "XpRaffleRefund_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "XpRaffleEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

