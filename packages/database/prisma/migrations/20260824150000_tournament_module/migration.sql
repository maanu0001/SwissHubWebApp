-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECKIN_OPEN', 'CHECKIN_CLOSED', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TournamentMode" AS ENUM ('SOLO', 'TEAM');

-- CreateEnum
CREATE TYPE "TournamentAccessMode" AS ENUM ('OPEN', 'APPROVAL', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'ROUND_ROBIN', 'SWISS', 'GROUPS_THEN_ELIMINATION');

-- CreateEnum
CREATE TYPE "TournamentSeeding" AS ENUM ('RANDOM', 'MANUAL', 'REGISTRATION_ORDER', 'RATING');

-- CreateEnum
CREATE TYPE "TournamentStaffRole" AS ENUM ('OWNER', 'ADMIN', 'REFEREE', 'CASTER', 'OBSERVER');

-- CreateEnum
CREATE TYPE "TournamentRegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WAITLISTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentCheckinStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CHECKED_IN', 'MISSED', 'ADMIN_CONFIRMED');

-- CreateEnum
CREATE TYPE "TournamentTeamStatus" AS ENUM ('FORMING', 'REGISTERED', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "TournamentTeamMemberRole" AS ENUM ('CAPTAIN', 'PLAYER', 'SUBSTITUTE', 'COACH');

-- CreateEnum
CREATE TYPE "TournamentInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TournamentStageKind" AS ENUM ('GROUPS', 'SWISS', 'ROUND_ROBIN', 'WINNERS', 'LOSERS', 'GRAND_FINAL');

-- CreateEnum
CREATE TYPE "TournamentMatchStatus" AS ENUM ('PENDING', 'READY', 'SCHEDULED', 'LIVE', 'AWAITING_RESULT', 'DISPUTED', 'COMPLETED', 'FORFEIT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentResultReason" AS ENUM ('PLAYED', 'FORFEIT', 'NO_SHOW', 'BYE', 'ADMIN_DECISION');

-- CreateEnum
CREATE TYPE "TournamentStreamStatus" AS ENUM ('NOT_STREAMED', 'PLANNED', 'LIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "TournamentDisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TournamentPrizeStatus" AS ENUM ('PENDING', 'AWARDED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "TournamentResourceKind" AS ENUM ('MATCH_CHANNEL', 'ANNOUNCEMENT_MESSAGE', 'PARTICIPANT_ROLE', 'WINNER_ROLE');

-- CreateEnum
CREATE TYPE "TournamentCustomFieldKind" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'URL', 'SELECT');

-- CreateEnum
CREATE TYPE "TournamentEventKind" AS ENUM ('CREATED', 'PUBLISHED', 'REGISTRATION_OPENED', 'REGISTRATION_CLOSED', 'CHECKIN_OPENED', 'CHECKIN_CLOSED', 'BRACKET_GENERATED', 'BRACKET_RESEEDED', 'ROUND_STARTED', 'ROUND_COMPLETED', 'STARTED', 'PAUSED', 'RESUMED', 'COMPLETED', 'CANCELLED', 'ARCHIVED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED', 'REGISTRATION_WITHDRAWN', 'WAITLIST_PROMOTED', 'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DISQUALIFIED', 'MATCH_SCHEDULED', 'MATCH_RESULT_REPORTED', 'MATCH_RESULT_CONFIRMED', 'MATCH_RESULT_OVERRIDDEN', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'PRIZE_UPDATED', 'STAFF_CHANGED');

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "gameId" TEXT,
    "description" TEXT,
    "rules" TEXT,
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "rulesUrl" TEXT,
    "bannerUrl" TEXT,
    "logoUrl" TEXT,
    "accentColor" INTEGER,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "mode" "TournamentMode" NOT NULL DEFAULT 'TEAM',
    "access" "TournamentAccessMode" NOT NULL DEFAULT 'OPEN',
    "format" "TournamentFormat" NOT NULL DEFAULT 'SINGLE_ELIMINATION',
    "seeding" "TournamentSeeding" NOT NULL DEFAULT 'RANDOM',
    "minTeamSize" INTEGER NOT NULL DEFAULT 1,
    "maxTeamSize" INTEGER NOT NULL DEFAULT 5,
    "maxSubstitutes" INTEGER NOT NULL DEFAULT 0,
    "maxParticipants" INTEGER NOT NULL DEFAULT 0,
    "minParticipants" INTEGER NOT NULL DEFAULT 2,
    "registrationOpensAt" TIMESTAMP(3),
    "registrationClosesAt" TIMESTAMP(3),
    "checkinOpensAt" TIMESTAMP(3),
    "checkinClosesAt" TIMESTAMP(3),
    "rosterLockAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "estimatedEndAt" TIMESTAMP(3),
    "checkinRequired" BOOLEAN NOT NULL DEFAULT true,
    "autoRemoveMissedCheckin" BOOLEAN NOT NULL DEFAULT false,
    "groupCount" INTEGER NOT NULL DEFAULT 0,
    "advancePerGroup" INTEGER NOT NULL DEFAULT 2,
    "swissRounds" INTEGER NOT NULL DEFAULT 0,
    "pointsPerWin" INTEGER NOT NULL DEFAULT 3,
    "pointsPerDraw" INTEGER NOT NULL DEFAULT 1,
    "pointsPerLoss" INTEGER NOT NULL DEFAULT 0,
    "tiebreakers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultBestOf" INTEGER NOT NULL DEFAULT 1,
    "mapPool" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "serverRegion" TEXT,
    "announcementChannelId" TEXT,
    "matchCategoryId" TEXT,
    "staffCategoryId" TEXT,
    "streamChannelId" TEXT,
    "pingRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "participantRoleId" TEXT,
    "winnerRoleId" TEXT,
    "matchChannelRetentionHours" INTEGER NOT NULL DEFAULT 0,
    "createMatchChannels" BOOLEAN NOT NULL DEFAULT true,
    "twitchUrl" TEXT,
    "youtubeUrl" TEXT,
    "streamUrl" TEXT,
    "requiredRoleId" TEXT,
    "minLevel" INTEGER NOT NULL DEFAULT 0,
    "requiresPremium" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStaff" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "TournamentStaffRole" NOT NULL DEFAULT 'REFEREE',
    "addedByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStage" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "kind" "TournamentStageKind" NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "roundCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentGroup" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TournamentGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "discordId" TEXT,
    "username" TEXT,
    "teamId" TEXT,
    "seed" INTEGER,
    "eliminatedAt" TIMESTAMP(3),
    "placement" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentRegistration" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "participantId" TEXT,
    "teamId" TEXT,
    "status" "TournamentRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "waitlistPosition" INTEGER,
    "checkinStatus" "TournamentCheckinStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "checkedInAt" TIMESTAMP(3),
    "checkedInBy" TEXT,
    "rulesAcceptedAt" TIMESTAMP(3),
    "rulesVersion" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeam" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "logoUrl" TEXT,
    "captainDiscordId" TEXT NOT NULL,
    "captainUsername" TEXT NOT NULL,
    "status" "TournamentTeamStatus" NOT NULL DEFAULT 'FORMING',
    "rosterUnlockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "TournamentTeamMemberRole" NOT NULL DEFAULT 'PLAYER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTeamInvite" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" "TournamentTeamMemberRole" NOT NULL DEFAULT 'PLAYER',
    "status" "TournamentInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "TournamentTeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "groupId" TEXT,
    "matchNumber" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "participantAId" TEXT,
    "participantBId" TEXT,
    "winnerToMatchId" TEXT,
    "winnerToSlot" TEXT,
    "loserToMatchId" TEXT,
    "loserToSlot" TEXT,
    "status" "TournamentMatchStatus" NOT NULL DEFAULT 'PENDING',
    "bestOf" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "winnerId" TEXT,
    "loserId" TEXT,
    "resultReason" "TournamentResultReason" NOT NULL DEFAULT 'PLAYED',
    "readyA" BOOLEAN NOT NULL DEFAULT false,
    "readyB" BOOLEAN NOT NULL DEFAULT false,
    "discordChannelId" TEXT,
    "channelMissing" BOOLEAN NOT NULL DEFAULT false,
    "streamStatus" "TournamentStreamStatus" NOT NULL DEFAULT 'NOT_STREAMED',
    "streamUrl" TEXT,
    "vodUrl" TEXT,
    "highlightUrl" TEXT,
    "staffNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatchGame" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "map" TEXT,
    "scoreA" INTEGER NOT NULL DEFAULT 0,
    "scoreB" INTEGER NOT NULL DEFAULT 0,
    "winnerSlot" TEXT,

    CONSTRAINT "TournamentMatchGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentResultSubmission" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "reportedByDiscordId" TEXT NOT NULL,
    "reportedByUsername" TEXT NOT NULL,
    "scoreA" INTEGER NOT NULL,
    "scoreB" INTEGER NOT NULL,
    "reason" "TournamentResultReason" NOT NULL DEFAULT 'PLAYED',
    "games" JSONB NOT NULL DEFAULT '[]',
    "comment" TEXT,
    "evidenceUrl" TEXT,
    "evidenceFile" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByDiscordId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentResultSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentDispute" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "openedByDiscordId" TEXT NOT NULL,
    "openedByUsername" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TournamentDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "staffNote" TEXT,
    "resolvedByDiscordId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatchCaster" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CASTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentMatchCaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentPrize" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "placement" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "value" TEXT,
    "sponsorName" TEXT,
    "sponsorUrl" TEXT,
    "sponsorLogoUrl" TEXT,
    "status" "TournamentPrizeStatus" NOT NULL DEFAULT 'PENDING',
    "awardedParticipantId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentPrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentAnnouncement" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channelId" TEXT,
    "discordMessageId" TEXT,
    "communicationMessageId" TEXT,
    "sentByDiscordId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentResource" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "kind" "TournamentResourceKind" NOT NULL,
    "discordId" TEXT NOT NULL,
    "parentId" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "missingSince" TIMESTAMP(3),

    CONSTRAINT "TournamentResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentCustomField" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "kind" "TournamentCustomFieldKind" NOT NULL DEFAULT 'SHORT_TEXT',
    "label" TEXT NOT NULL,
    "description" TEXT,
    "placeholder" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxLength" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentCustomFieldResponse" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "TournamentCustomFieldResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEvent" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "kind" "TournamentEventKind" NOT NULL,
    "actorDiscordId" TEXT,
    "actorUsername" TEXT,
    "actorSource" TEXT NOT NULL DEFAULT 'SYSTEM',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatchCounter" (
    "tournamentId" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatchCounter_pkey" PRIMARY KEY ("tournamentId")
);

-- CreateTable
CREATE TABLE "TournamentBlockEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "username" TEXT,
    "reason" TEXT NOT NULL,
    "blockedByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "TournamentBlockEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tournament_guildId_status_startsAt_idx" ON "Tournament"("guildId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Tournament_guildId_gameId_idx" ON "Tournament"("guildId", "gameId");

-- CreateIndex
CREATE INDEX "Tournament_status_registrationClosesAt_idx" ON "Tournament"("status", "registrationClosesAt");

-- CreateIndex
CREATE INDEX "Tournament_status_checkinClosesAt_idx" ON "Tournament"("status", "checkinClosesAt");

-- CreateIndex
CREATE INDEX "Tournament_status_startsAt_idx" ON "Tournament"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_guildId_slug_key" ON "Tournament"("guildId", "slug");

-- CreateIndex
CREATE INDEX "TournamentStaff_discordId_idx" ON "TournamentStaff"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStaff_tournamentId_discordId_key" ON "TournamentStaff"("tournamentId", "discordId");

-- CreateIndex
CREATE INDEX "TournamentStage_tournamentId_sortOrder_idx" ON "TournamentStage"("tournamentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_tournamentId_kind_sortOrder_key" ON "TournamentStage"("tournamentId", "kind", "sortOrder");

-- CreateIndex
CREATE INDEX "TournamentGroup_tournamentId_idx" ON "TournamentGroup"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentGroup_stageId_name_key" ON "TournamentGroup"("stageId", "name");

-- CreateIndex
CREATE INDEX "TournamentGroupMember_participantId_idx" ON "TournamentGroupMember"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentGroupMember_groupId_participantId_key" ON "TournamentGroupMember"("groupId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_teamId_key" ON "TournamentParticipant"("teamId");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournamentId_seed_idx" ON "TournamentParticipant"("tournamentId", "seed");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournamentId_placement_idx" ON "TournamentParticipant"("tournamentId", "placement");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_discordId_key" ON "TournamentParticipant"("tournamentId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_participantId_key" ON "TournamentRegistration"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_teamId_key" ON "TournamentRegistration"("teamId");

-- CreateIndex
CREATE INDEX "TournamentRegistration_tournamentId_status_idx" ON "TournamentRegistration"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentRegistration_tournamentId_status_waitlistPosition_idx" ON "TournamentRegistration"("tournamentId", "status", "waitlistPosition");

-- CreateIndex
CREATE INDEX "TournamentRegistration_tournamentId_checkinStatus_idx" ON "TournamentRegistration"("tournamentId", "checkinStatus");

-- CreateIndex
CREATE INDEX "TournamentRegistration_discordId_idx" ON "TournamentRegistration"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentRegistration_tournamentId_discordId_key" ON "TournamentRegistration"("tournamentId", "discordId");

-- CreateIndex
CREATE INDEX "TournamentTeam_tournamentId_status_idx" ON "TournamentTeam"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentTeam_captainDiscordId_idx" ON "TournamentTeam"("captainDiscordId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeam_tournamentId_name_key" ON "TournamentTeam"("tournamentId", "name");

-- CreateIndex
CREATE INDEX "TournamentTeamMember_discordId_idx" ON "TournamentTeamMember"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTeamMember_teamId_discordId_key" ON "TournamentTeamMember"("teamId", "discordId");

-- CreateIndex
CREATE INDEX "TournamentTeamInvite_teamId_status_idx" ON "TournamentTeamInvite"("teamId", "status");

-- CreateIndex
CREATE INDEX "TournamentTeamInvite_discordId_status_idx" ON "TournamentTeamInvite"("discordId", "status");

-- CreateIndex
CREATE INDEX "TournamentTeamInvite_tournamentId_status_idx" ON "TournamentTeamInvite"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_status_idx" ON "TournamentMatch"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentMatch_tournamentId_scheduledAt_idx" ON "TournamentMatch"("tournamentId", "scheduledAt");

-- CreateIndex
CREATE INDEX "TournamentMatch_stageId_round_idx" ON "TournamentMatch"("stageId", "round");

-- CreateIndex
CREATE INDEX "TournamentMatch_status_scheduledAt_idx" ON "TournamentMatch"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_tournamentId_matchNumber_key" ON "TournamentMatch"("tournamentId", "matchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_stageId_round_position_key" ON "TournamentMatch"("stageId", "round", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_discordChannelId_key" ON "TournamentMatch"("discordChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatchGame_matchId_index_key" ON "TournamentMatchGame"("matchId", "index");

-- CreateIndex
CREATE INDEX "TournamentResultSubmission_matchId_createdAt_idx" ON "TournamentResultSubmission"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentResultSubmission_matchId_slot_idx" ON "TournamentResultSubmission"("matchId", "slot");

-- CreateIndex
CREATE INDEX "TournamentDispute_tournamentId_status_idx" ON "TournamentDispute"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "TournamentDispute_matchId_idx" ON "TournamentDispute"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatchCaster_matchId_discordId_key" ON "TournamentMatchCaster"("matchId", "discordId");

-- CreateIndex
CREATE INDEX "TournamentPrize_tournamentId_idx" ON "TournamentPrize"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentPrize_tournamentId_placement_key" ON "TournamentPrize"("tournamentId", "placement");

-- CreateIndex
CREATE INDEX "TournamentAnnouncement_tournamentId_sentAt_idx" ON "TournamentAnnouncement"("tournamentId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentAnnouncement_tournamentId_kind_key" ON "TournamentAnnouncement"("tournamentId", "kind");

-- CreateIndex
CREATE INDEX "TournamentResource_tournamentId_kind_idx" ON "TournamentResource"("tournamentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentResource_tournamentId_kind_discordId_key" ON "TournamentResource"("tournamentId", "kind", "discordId");

-- CreateIndex
CREATE INDEX "TournamentCustomField_tournamentId_sortOrder_idx" ON "TournamentCustomField"("tournamentId", "sortOrder");

-- CreateIndex
CREATE INDEX "TournamentCustomFieldResponse_registrationId_idx" ON "TournamentCustomFieldResponse"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentCustomFieldResponse_fieldId_registrationId_key" ON "TournamentCustomFieldResponse"("fieldId", "registrationId");

-- CreateIndex
CREATE INDEX "TournamentEvent_tournamentId_createdAt_idx" ON "TournamentEvent"("tournamentId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentEvent_tournamentId_kind_idx" ON "TournamentEvent"("tournamentId", "kind");

-- CreateIndex
CREATE INDEX "TournamentBlockEntry_guildId_discordId_liftedAt_idx" ON "TournamentBlockEntry"("guildId", "discordId", "liftedAt");

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "SpielersucheGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStaff" ADD CONSTRAINT "TournamentStaff_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGroup" ADD CONSTRAINT "TournamentGroup_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGroup" ADD CONSTRAINT "TournamentGroup_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGroupMember" ADD CONSTRAINT "TournamentGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TournamentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGroupMember" ADD CONSTRAINT "TournamentGroupMember_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TournamentParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TournamentParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeam" ADD CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamMember" ADD CONSTRAINT "TournamentTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamInvite" ADD CONSTRAINT "TournamentTeamInvite_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTeamInvite" ADD CONSTRAINT "TournamentTeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TournamentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_participantAId_fkey" FOREIGN KEY ("participantAId") REFERENCES "TournamentParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_participantBId_fkey" FOREIGN KEY ("participantBId") REFERENCES "TournamentParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "TournamentParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_loserId_fkey" FOREIGN KEY ("loserId") REFERENCES "TournamentParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatchGame" ADD CONSTRAINT "TournamentMatchGame_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResultSubmission" ADD CONSTRAINT "TournamentResultSubmission_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentDispute" ADD CONSTRAINT "TournamentDispute_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentDispute" ADD CONSTRAINT "TournamentDispute_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatchCaster" ADD CONSTRAINT "TournamentMatchCaster_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "TournamentMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentPrize" ADD CONSTRAINT "TournamentPrize_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentAnnouncement" ADD CONSTRAINT "TournamentAnnouncement_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentResource" ADD CONSTRAINT "TournamentResource_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCustomField" ADD CONSTRAINT "TournamentCustomField_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCustomFieldResponse" ADD CONSTRAINT "TournamentCustomFieldResponse_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "TournamentCustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentCustomFieldResponse" ADD CONSTRAINT "TournamentCustomFieldResponse_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "TournamentRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEvent" ADD CONSTRAINT "TournamentEvent_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

