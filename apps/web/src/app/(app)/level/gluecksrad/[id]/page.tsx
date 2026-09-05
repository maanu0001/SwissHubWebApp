import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ExternalLink, History, Trophy, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { RaffleControls } from '@/modules/level/components/raffle-controls';
import { RaffleParticipants } from '@/modules/level/components/raffle-participants';
import {
  RaffleStatusBadge,
  describeEntryModel,
  fairnessNote,
  formatDateTime,
  formatNumber,
  formatXp,
} from '@/modules/level/components/raffle-shared';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Verlosung' };
export const dynamic = 'force-dynamic';

/** Eine einzelne Verlosung: Stand, Steuerung, Teilnehmende und Ziehungen. */
export default async function RaffleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.raffleView);
  const csrfToken = csrfTokenFor(context);
  const { id } = await params;

  const detail = await level.raffle.getRaffleDetail(id);
  if (!detail) {
    notFound();
  }

  const { raffle, participants, draw, winner, potXp, activeCount } = detail;
  const draws = await level.raffle.allDraws(id);
  const P = level.LEVEL_PERMISSIONS;

  const permissions = {
    publish: can(context, P.raffleCreate),
    open: can(context, P.raffleOpen),
    close: can(context, P.raffleClose),
    draw: can(context, P.raffleDraw),
    redraw: can(context, P.raffleRedraw),
    cancel: can(context, P.raffleCancel),
    delete: can(context, P.raffleDelete),
    manage: can(context, P.raffleManage),
  };
  const canSeeHistory = can(context, P.raffleHistory) || permissions.manage;

  return (
    <>
      <PageHeader
        title={raffle.title}
        description={raffle.prizeDescription}
        actions={
          <div className="flex gap-2">
            {can(context, P.raffleEdit) && raffle.status !== 'COMPLETED' && raffle.status !== 'CANCELLED' ? (
              <Button variant="outline" asChild>
                <Link href={`/level/gluecksrad/${raffle.id}/bearbeiten`}>Bearbeiten</Link>
              </Button>
            ) : null}
            <Button variant="outline" asChild>
              <Link href="/xp-gluecksrad">
                <ExternalLink aria-hidden="true" />
                Glücksrad öffnen
              </Link>
            </Button>
          </div>
        }
      />
      <LevelSectionNav sections={levelSections(context)} />

      <div className="flex flex-wrap items-center gap-3">
        <RaffleStatusBadge status={raffle.status} />
        <Badge variant="outline">{raffle.entryModel === 'FIXED' ? 'Festbetrag' : 'Anteilsmodell'}</Badge>
        <span className="text-sm text-muted-foreground">{describeEntryModel(raffle)}</span>
      </div>

      {raffle.discordChannelId && raffle.discordMessageMissing ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Die Discord-Nachricht wurde gelöscht oder ist nicht mehr erreichbar. Über „Neu veröffentlichen“
            lässt sich die Ankündigung erneut senden.
          </span>
        </p>
      ) : null}

      <RaffleControls
        csrfToken={csrfToken}
        raffleId={raffle.id}
        status={raffle.status}
        entryCount={activeCount}
        potXp={potXp}
        minimumParticipants={raffle.minimumParticipants}
        hasChannel={Boolean(raffle.discordChannelId)}
        messageMissing={raffle.discordMessageMissing}
        permissions={permissions}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Teilnehmende"
          value={formatNumber(activeCount)}
          hint={
            raffle.maximumParticipants
              ? `von höchstens ${formatNumber(raffle.maximumParticipants)}`
              : 'unbegrenzt'
          }
          icon={<Users aria-hidden="true" />}
        />
        <StatCard
          label="XP im Topf"
          value={formatXp(potXp)}
          hint="Summe aller Einsätze"
          icon={<Trophy aria-hidden="true" />}
        />
        <StatCard
          label="Teilnahme bis"
          value={formatDateTime(raffle.entryEndsAt)}
          hint={`Start: ${formatDateTime(raffle.entryStartsAt)}`}
        />
        <StatCard
          label="Auslosung"
          value={formatDateTime(raffle.drawScheduledAt)}
          hint={raffle.autoDraw ? 'startet selbsttätig' : 'wird von Hand gestartet'}
        />
      </div>

      {winner && draw ? (
        <Panel title="Gezogener Gewinner" icon={<Trophy aria-hidden="true" />}>
          <div className="flex flex-wrap items-center gap-4">
            <DiscordAvatar
              discordId={winner.discordId}
              name={winner.displayName ?? winner.username ?? winner.discordId}
              size={64}
            />
            <div>
              <p className="text-lg font-semibold">
                {winner.displayName ?? winner.username ?? winner.discordId}
              </p>
              <p className="text-sm text-muted-foreground">
                Einsatz {formatXp(winner.entryXp)} · Ziehung {draw.version} · {formatDateTime(draw.createdAt)}
              </p>
              {raffle.status === 'WINNER_PENDING' ? (
                <p className="mt-1 text-xs text-amber-500">
                  Noch nicht bestätigt. Bis zur Bestätigung lässt sich neu ziehen.
                </p>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Teilnehmende"
        icon={<Users aria-hidden="true" />}
        description={fairnessNote(raffle.entryModel)}
      >
        <RaffleParticipants
          csrfToken={csrfToken}
          canManage={permissions.manage}
          canRemove={permissions.manage && raffle.status !== 'COMPLETED' && raffle.status !== 'CANCELLED'}
          participants={participants.map((entry) => ({
            ...entry,
            createdAt: entry.createdAt.toISOString(),
          }))}
        />
      </Panel>

      {canSeeHistory && draws.length > 0 ? (
        <Panel
          title="Ziehungen"
          icon={<History aria-hidden="true" />}
          description="Jede Ziehung bleibt erhalten – eine Neuziehung ersetzt die vorherige nicht, sondern ergänzt sie."
        >
          <ul className="space-y-3">
            {draws.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={entry.id === raffle.confirmedDrawId ? 'default' : 'outline'}>
                    Ziehung {entry.version}
                  </Badge>
                  {entry.id === raffle.confirmedDrawId ? <Badge variant="secondary">Bestätigt</Badge> : null}
                  <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt>Gewinner:</dt>
                    <dd className="font-medium text-foreground">{entry.winnerDiscordId}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Teilnehmende:</dt>
                    <dd className="tabular-nums">{formatNumber(entry.participantCount)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Gezogener Punkt:</dt>
                    <dd className="tabular-nums">
                      {formatNumber(entry.drawnTicket)} von {formatNumber(entry.totalWeight)}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Verfahren:</dt>
                    <dd>Fassung {entry.algorithmVersion}</dd>
                  </div>
                  {entry.redrawReason ? (
                    <div className="flex gap-2 sm:col-span-2">
                      <dt>Grund der Neuziehung:</dt>
                      <dd className="text-foreground">{entry.redrawReason}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
