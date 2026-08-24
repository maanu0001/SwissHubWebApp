import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, Hash } from 'lucide-react';
import { AppError, formatDateTime, formatDayTime } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  MatchParticipantPanel,
  MatchStaffPanel,
} from '@/modules/tournaments/components/match-panel';
import {
  MatchStatusBadge,
  StreamStatusBadge,
} from '@/modules/tournaments/components/tournament-badges';
import { rundenName } from '@/modules/tournaments/components/bracket-view';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { ladeMatchMitZugriff, turnierHref } from '@/server/tournaments';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Match' };
export const dynamic = 'force-dynamic';

/**
 * Ein Match.
 *
 * Eine Seite für beide Rollen: die Captains melden hier ihr Resultat, die
 * Leitung setzt an, korrigiert und entscheidet Einsprüche. Wer welche
 * Abschnitte sieht, entscheidet der Server - `slot` kommt aus der
 * Teamzugehörigkeit, die Leitungsrechte aus der Zuständigkeit am Turnier.
 *
 * Wer weder das eine noch das andere ist, hat hier nichts verloren und
 * bekommt dieselbe Antwort wie bei einem Match, das es nicht gibt.
 */
export default async function MatchSeite({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<React.JSX.Element> {
  const { matchId } = await params;
  const context = await requireMember();
  const { match, zugriff, slot } = await ladeMatchMitZugriff(context, matchId);

  if (!slot && !zugriff.asStaff) {
    // Bewusst dieselbe Meldung wie bei einem nicht vorhandenen Match: sonst
    // liesse sich an der Antwort ablesen, welche Matches es gibt.
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Match existiert nicht.' });
  }

  const nameA = match.participantA?.team?.name ?? match.participantA?.username ?? 'Noch offen';
  const nameB = match.participantB?.team?.name ?? match.participantB?.username ?? 'Noch offen';

  const offeneMeldung =
    match.submissions.find(
      (meldung) => meldung.confirmedAt === null && meldung.rejectedAt === null,
    ) ?? null;

  const offeneEinsprueche = match.disputes.filter(
    (einspruch) => einspruch.status === 'OPEN' || einspruch.status === 'IN_REVIEW',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Match #${match.matchNumber}`}
        description={`${match.tournament.name} · ${match.group?.name ?? match.stage.name}, ${rundenName(match.round, match.stage.roundCount, match.stage.kind)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MatchStatusBadge status={match.status} />
            {match.streamStatus !== 'NOT_STREAMED' ? (
              <StreamStatusBadge status={match.streamStatus} />
            ) : null}
            {zugriff.asStaff ? (
              <Link
                href={turnierHref(match.tournament.id, 'matches')}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Zum Turnier
              </Link>
            ) : (
              <Link
                href={`/turniere/${match.tournament.slug}`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <ExternalLink aria-hidden="true" />
                Turnierseite
              </Link>
            )}
          </div>
        }
      />

      {/* --- Der Stand -------------------------------------------------- */}
      <section className="rounded-2xl border border-border p-5">
        <div className="flex items-center justify-between gap-4">
          <span className="min-w-0 flex-1 truncate text-lg font-medium">
            {nameA}
            {match.readyA && match.status !== 'COMPLETED' ? (
              <Badge variant="success" className="ml-2">
                bereit
              </Badge>
            ) : null}
          </span>
          <span className="shrink-0 text-2xl font-semibold tabular-nums">
            {match.scoreA} : {match.scoreB}
          </span>
          <span className="min-w-0 flex-1 truncate text-right text-lg font-medium">
            {match.readyB && match.status !== 'COMPLETED' ? (
              <Badge variant="success" className="mr-2">
                bereit
              </Badge>
            ) : null}
            {nameB}
          </span>
        </div>

        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {match.bestOf > 1 ? <span>Best of {match.bestOf}</span> : <span>Ein Spiel</span>}
          {match.scheduledAt ? <span>Angesetzt: {formatDayTime(match.scheduledAt)}</span> : null}
          {match.discordChannelId ? (
            <span className="flex items-center gap-1">
              <Hash className="size-3.5" aria-hidden="true" />
              Match-Kanal auf Discord
            </span>
          ) : null}
          {match.streamUrl ? (
            <a
              href={match.streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              Stream
            </a>
          ) : null}
        </p>

        {match.games.length > 0 ? (
          <ul className="mt-4 space-y-1 border-t border-border/60 pt-3 text-sm">
            {match.games.map((spiel) => (
              <li key={spiel.id} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  Karte {spiel.index}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {spiel.map ?? '–'}
                </span>
                <span className="shrink-0 tabular-nums">
                  {spiel.scoreA}:{spiel.scoreB}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {slot ? (
        <MatchParticipantPanel
          matchId={match.id}
          csrfToken={csrfTokenFor(context)}
          slot={slot}
          status={match.status}
          nameA={nameA}
          nameB={nameB}
          scoreA={match.scoreA}
          scoreB={match.scoreB}
          bestOf={match.bestOf}
          readyA={match.readyA}
          readyB={match.readyB}
          offeneMeldung={
            offeneMeldung
              ? {
                  id: offeneMeldung.id,
                  slot: offeneMeldung.slot,
                  reportedByUsername: offeneMeldung.reportedByUsername,
                  scoreA: offeneMeldung.scoreA,
                  scoreB: offeneMeldung.scoreB,
                  comment: offeneMeldung.comment,
                  evidenceUrl: offeneMeldung.evidenceUrl,
                  confirmedAt: offeneMeldung.confirmedAt?.toISOString() ?? null,
                  rejectedAt: offeneMeldung.rejectedAt?.toISOString() ?? null,
                  createdAt: offeneMeldung.createdAt.toISOString(),
                }
              : null
          }
        />
      ) : null}

      {zugriff.asStaff ? (
        <MatchStaffPanel
          matchId={match.id}
          csrfToken={csrfTokenFor(context)}
          status={match.status}
          nameA={nameA}
          nameB={nameB}
          scoreA={match.scoreA}
          scoreB={match.scoreB}
          scheduledAt={match.scheduledAt?.toISOString() ?? null}
          hatKanal={match.discordChannelId !== null}
          streamStatus={match.streamStatus}
          streamUrl={match.streamUrl}
          darfKorrigieren={zugriff.resultsOverride}
          darfEinsprueche={zugriff.disputesManage}
          darfStream={zugriff.streamManage}
          darfMatches={zugriff.matchesManage}
          offeneEinsprueche={offeneEinsprueche.map((einspruch) => ({
            id: einspruch.id,
            openedByUsername: einspruch.openedByUsername,
            reason: einspruch.reason,
            status: einspruch.status,
            resolution: einspruch.resolution,
            createdAt: einspruch.createdAt.toISOString(),
          }))}
        />
      ) : null}

      {/* --- Verlauf der Meldungen -------------------------------------- */}
      {match.submissions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Gemeldete Resultate</h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {match.submissions.map((meldung) => (
              <li key={meldung.id} className="space-y-1 px-4 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{meldung.reportedByUsername}</span>
                  <span className="text-xs text-muted-foreground">
                    Seite {meldung.slot} · {formatDateTime(meldung.createdAt)}
                  </span>
                  <span className="tabular-nums">
                    {meldung.scoreA}:{meldung.scoreB}
                  </span>
                  {meldung.confirmedAt ? (
                    <Badge variant="success">Bestätigt</Badge>
                  ) : meldung.rejectedAt ? (
                    <Badge variant="destructive">Bestritten</Badge>
                  ) : (
                    <Badge variant="warning">Wartet</Badge>
                  )}
                </p>
                {meldung.comment ? (
                  <p className="text-xs text-muted-foreground">{meldung.comment}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- Entschiedene Einsprüche ------------------------------------ */}
      {match.disputes.some((einspruch) => einspruch.resolution !== null) ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Entscheidungen</h2>
          <ul className="space-y-2">
            {match.disputes
              .filter((einspruch) => einspruch.resolution !== null)
              .map((einspruch) => (
                <li key={einspruch.id} className="rounded-xl border border-border p-4 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Einspruch von {einspruch.openedByUsername} ·{' '}
                    {formatDateTime(einspruch.createdAt)}
                  </p>
                  <p className="mt-1 text-muted-foreground">{einspruch.reason}</p>
                  <p className="mt-2 border-l-2 border-primary/50 pl-3">{einspruch.resolution}</p>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
