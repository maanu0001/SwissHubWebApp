import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@swisshub/database';
import { level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { RaffleForm, type RaffleFormValues } from '@/modules/level/components/raffle-form';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Verlosung bearbeiten' };
export const dynamic = 'force-dynamic';

/** Wandelt einen Zeitpunkt in den Wert eines `datetime-local`-Feldes (Europe/Zurich). */
function toLocalInput(value: Date | null): string {
  if (!value) {
    return '';
  }
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Zurich',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
  return parts.replace(' ', 'T');
}

export default async function EditRafflePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.raffleEdit);
  const csrfToken = csrfTokenFor(context);
  const { id } = await params;

  const raffle = await level.raffle.getRaffle(id);
  if (!raffle) {
    notFound();
  }

  const [{ channels, roles }, entryCount] = await Promise.all([
    loadDiscordOptions(),
    prisma.xpRaffleEntry.count({ where: { raffleId: id } }),
  ]);

  const initial: RaffleFormValues = {
    raffleId: raffle.id,
    title: raffle.title,
    description: raffle.description ?? '',
    bannerUrl: raffle.bannerUrl ?? '',
    prizeKind: raffle.prizeKind,
    prizeDescription: raffle.prizeDescription,
    prizeXp: raffle.prizeXp?.toString() ?? '',
    prizeRoleId: raffle.prizeRoleId ?? '',
    entryModel: raffle.entryModel,
    fixedEntryXp: raffle.fixedEntryXp?.toString() ?? '',
    percentage: raffle.percentageBasisPoints ? (raffle.percentageBasisPoints / 100).toString() : '',
    minimumEntryXp: raffle.minimumEntryXp?.toString() ?? '',
    maximumEntryXp: raffle.maximumEntryXp?.toString() ?? '',
    minimumParticipants: raffle.minimumParticipants.toString(),
    maximumParticipants: raffle.maximumParticipants?.toString() ?? '',
    entryStartsAt: toLocalInput(raffle.entryStartsAt),
    entryEndsAt: toLocalInput(raffle.entryEndsAt),
    drawScheduledAt: toLocalInput(raffle.drawScheduledAt),
    autoDraw: raffle.autoDraw,
    participantsPublic: raffle.participantsPublic,
    autoAnnounceWinner: raffle.autoAnnounceWinner,
    discordChannelId: raffle.discordChannelId ?? '',
  };

  return (
    <>
      <PageHeader title="Verlosung bearbeiten" description={raffle.title} />
      <LevelSectionNav sections={levelSections(context)} />
      <RaffleForm
        csrfToken={csrfToken}
        initial={initial}
        channels={channels}
        roles={roles}
        lockedEntryModel={entryCount > 0}
      />
    </>
  );
}
