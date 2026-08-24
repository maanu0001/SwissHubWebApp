import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { spielersuche } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import {
  CustomFieldsAdmin,
  type FeldArt,
} from '@/modules/tournaments/components/custom-fields-admin';
import { TournamentForm } from '@/modules/tournaments/components/tournament-form';
import { fuerZeitfeld } from '@/modules/tournaments/zeitfeld';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turnier bearbeiten' };
export const dynamic = 'force-dynamic';

/**
 * Ein Turnier bearbeiten.
 *
 * Dasselbe Formular wie beim Anlegen. Was sich nach dem Start noch ändern
 * lässt, entscheidet der Server: eine Formatänderung mitten im Turnier würde
 * das bestehende Bracket bedeutungslos machen.
 */
export default async function TurnierBearbeitenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const { zugriff } = await ladeTurnierMitZugriff(context, id);

  if (!zugriff.manage) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Du kannst dieses Turnier nicht bearbeiten.',
    });
  }

  const [turnier, felder, antworten, spiele, optionen] = await Promise.all([
    prisma.tournament.findUniqueOrThrow({ where: { id } }),
    prisma.tournamentCustomField.findMany({
      where: { tournamentId: id },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.tournamentCustomFieldResponse.count({ where: { field: { tournamentId: id } } }),
    spielersuche.listGames({ includeDisabled: false }).catch(() => []),
    loadDiscordOptions(),
  ]);

  return (
    <div className="space-y-8">
    <TournamentForm
      csrfToken={csrfTokenFor(context)}
      tournamentId={id}
      spiele={spiele.map((spiel) => ({ id: spiel.id, name: spiel.name }))}
      roles={optionen.roles}
      channels={optionen.channels}
      werte={{
        name: turnier.name,
        slug: turnier.slug,
        gameName: turnier.gameName,
        gameId: turnier.gameId,
        description: turnier.description ?? '',
        rules: turnier.rules ?? '',
        mode: turnier.mode,
        access: turnier.access,
        format: turnier.format,
        seeding: turnier.seeding,
        minTeamSize: turnier.minTeamSize,
        maxTeamSize: turnier.maxTeamSize,
        maxSubstitutes: turnier.maxSubstitutes,
        maxParticipants: turnier.maxParticipants,
        minParticipants: turnier.minParticipants,
        registrationOpensAt: fuerZeitfeld(turnier.registrationOpensAt),
        registrationClosesAt: fuerZeitfeld(turnier.registrationClosesAt),
        checkinOpensAt: fuerZeitfeld(turnier.checkinOpensAt),
        checkinClosesAt: fuerZeitfeld(turnier.checkinClosesAt),
        rosterLockAt: fuerZeitfeld(turnier.rosterLockAt),
        startsAt: fuerZeitfeld(turnier.startsAt),
        estimatedEndAt: fuerZeitfeld(turnier.estimatedEndAt),
        checkinRequired: turnier.checkinRequired,
        autoRemoveMissedCheckin: turnier.autoRemoveMissedCheckin,
        groupCount: turnier.groupCount,
        advancePerGroup: turnier.advancePerGroup,
        swissRounds: turnier.swissRounds,
        pointsPerWin: turnier.pointsPerWin,
        pointsPerDraw: turnier.pointsPerDraw,
        pointsPerLoss: turnier.pointsPerLoss,
        tiebreakers: turnier.tiebreakers,
        defaultBestOf: turnier.defaultBestOf,
        mapPool: turnier.mapPool.join(', '),
        serverRegion: turnier.serverRegion ?? '',
        bannerUrl: turnier.bannerUrl ?? '',
        logoUrl: turnier.logoUrl ?? '',
        announcementChannelId: turnier.announcementChannelId ?? '',
        matchCategoryId: turnier.matchCategoryId ?? '',
        staffCategoryId: turnier.staffCategoryId ?? '',
        streamChannelId: turnier.streamChannelId ?? '',
        pingRoleIds: turnier.pingRoleIds,
        matchChannelRetentionHours: turnier.matchChannelRetentionHours,
        createMatchChannels: turnier.createMatchChannels,
        twitchUrl: turnier.twitchUrl ?? '',
        youtubeUrl: turnier.youtubeUrl ?? '',
        streamUrl: turnier.streamUrl ?? '',
        requiredRoleId: turnier.requiredRoleId ?? '',
        minLevel: turnier.minLevel,
        requiresPremium: turnier.requiresPremium,
      }}
    />

      <CustomFieldsAdmin
        tournamentId={id}
        csrfToken={csrfTokenFor(context)}
        gesperrt={antworten > 0}
        felder={felder.map((feld) => ({
          kind: feld.kind as FeldArt,
          label: feld.label,
          description: feld.description,
          placeholder: feld.placeholder,
          required: feld.required,
          options: feld.options,
          maxLength: feld.maxLength,
        }))}
      />
    </div>
  );
}
