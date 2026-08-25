-- CreateTable
CREATE TABLE "MemberNote" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetDiscordId" TEXT NOT NULL,
    "authorDiscordId" TEXT NOT NULL,
    "authorUsername" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "MemberNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberNote_guildId_targetDiscordId_createdAt_idx" ON "MemberNote"("guildId", "targetDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberNote_guildId_targetDiscordId_pinned_createdAt_idx" ON "MemberNote"("guildId", "targetDiscordId", "pinned", "createdAt");

-- CreateIndex
CREATE INDEX "MemberNote_authorDiscordId_idx" ON "MemberNote"("authorDiscordId");

-- CreateIndex
CREATE INDEX "MemberNote_createdAt_idx" ON "MemberNote"("createdAt");

