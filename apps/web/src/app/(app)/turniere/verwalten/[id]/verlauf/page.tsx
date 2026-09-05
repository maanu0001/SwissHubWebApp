import type { Metadata } from 'next';
import { formatDateTime } from '@swisshub/shared';
import { tournaments } from '@swisshub/modules';
import { EmptyState } from '@/components/shared/states';
import { requireMember } from '@/server/auth';
import { ladeTurnierMitZugriff } from '@/server/tournaments';

export const metadata: Metadata = { title: 'Turnierverlauf' };
export const dynamic = 'force-dynamic';

const EREIGNIS_TEXT: Record<string, string> = {
  CREATED: 'Turnier angelegt',
  PUBLISHED: 'Veröffentlicht',
  REGISTRATION_OPENED: 'Anmeldung geöffnet',
  REGISTRATION_CLOSED: 'Anmeldung geschlossen',
  CHECKIN_OPENED: 'Check-in geöffnet',
  CHECKIN_CLOSED: 'Check-in geschlossen',
  REGISTERED: 'Angemeldet',
  CHECKED_IN: 'Eingecheckt',
  BRACKET_GENERATED: 'Bracket erzeugt',
  BRACKET_RESEEDED: 'Neu gesetzt',
  ROUND_STARTED: 'Runde gestartet',
  ROUND_COMPLETED: 'Runde abgeschlossen',
  STARTED: 'Turnier gestartet',
  PAUSED: 'Pausiert',
  RESUMED: 'Fortgesetzt',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
  ARCHIVED: 'Archiviert',
  REGISTRATION_APPROVED: 'Anmeldung freigegeben',
  REGISTRATION_REJECTED: 'Anmeldung abgelehnt',
  REGISTRATION_WITHDRAWN: 'Anmeldung zurückgezogen',
  WAITLIST_PROMOTED: 'Von der Warteliste nachgerückt',
  TEAM_CREATED: 'Team gegründet',
  TEAM_UPDATED: 'Team geändert',
  TEAM_DISQUALIFIED: 'Team disqualifiziert',
  MATCH_SCHEDULED: 'Match angesetzt',
  MATCH_RESULT_REPORTED: 'Resultat gemeldet',
  MATCH_RESULT_CONFIRMED: 'Resultat bestätigt',
  MATCH_RESULT_OVERRIDDEN: 'Resultat korrigiert',
  DISPUTE_OPENED: 'Einspruch erhoben',
  DISPUTE_RESOLVED: 'Einspruch entschieden',
  PRIZE_UPDATED: 'Preis geändert',
  STAFF_CHANGED: 'Turnierleitung geändert',
};

const QUELLE_TEXT: Record<string, string> = {
  WEBAPP: 'Dashboard',
  DISCORD: 'Discord',
  SYSTEM: 'automatisch',
};

/**
 * Was in diesem Turnier geschehen ist.
 *
 * Die Grundlage jeder Nachfrage: wer wann was entschieden hat. Nicht zu
 * verwechseln mit dem zentralen Protokoll - dort steht, was sicherheitsrelevant
 * war, hier steht der Turnierablauf.
 */
export default async function TurnierVerlaufPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  await ladeTurnierMitZugriff(context, id);

  const ereignisse = await tournaments.getTournamentEvents(id, 200);

  if (ereignisse.length === 0) {
    return <EmptyState title="Noch nichts geschehen" />;
  }

  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
      {ereignisse.map((ereignis) => (
        <li key={ereignis.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
          <span className="w-36 shrink-0 text-xs text-muted-foreground">
            {formatDateTime(ereignis.createdAt)}
          </span>
          <span className="min-w-0 flex-1 text-sm">{EREIGNIS_TEXT[ereignis.kind] ?? ereignis.kind}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {ereignis.actorUsername ?? 'System'} · {QUELLE_TEXT[ereignis.actorSource] ?? ereignis.actorSource}
          </span>
        </li>
      ))}
    </ol>
  );
}
