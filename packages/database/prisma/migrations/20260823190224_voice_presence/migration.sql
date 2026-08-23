-- CreateTable
CREATE TABLE "VoicePresence" (
    "discordId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoicePresence_pkey" PRIMARY KEY ("discordId")
);

-- CreateIndex
CREATE INDEX "VoicePresence_guildId_channelId_idx" ON "VoicePresence"("guildId", "channelId");
