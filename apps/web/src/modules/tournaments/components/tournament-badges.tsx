import { Badge } from '@/components/ui/badge';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Entwurf',
  REGISTRATION_OPEN: 'Anmeldung offen',
  REGISTRATION_CLOSED: 'Anmeldung geschlossen',
  CHECKIN_OPEN: 'Check-in offen',
  CHECKIN_CLOSED: 'Check-in geschlossen',
  READY: 'Startbereit',
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
  ARCHIVED: 'Archiviert',
};

const MATCH_LABEL: Record<string, string> = {
  PENDING: 'Wartet auf Gegner',
  READY: 'Bereit',
  SCHEDULED: 'Angesetzt',
  LIVE: 'Läuft',
  AWAITING_RESULT: 'Resultat offen',
  DISPUTED: 'Strittig',
  COMPLETED: 'Abgeschlossen',
  FORFEIT: 'Forfait',
  CANCELLED: 'Abgesagt',
};

const REGISTRATION_LABEL: Record<string, string> = {
  PENDING: 'Wartet auf Freigabe',
  CONFIRMED: 'Bestätigt',
  WAITLISTED: 'Warteliste',
  REJECTED: 'Abgelehnt',
  CANCELLED: 'Zurückgezogen',
};

const CHECKIN_LABEL: Record<string, string> = {
  NOT_REQUIRED: 'Kein Check-in nötig',
  PENDING: 'Noch nicht eingecheckt',
  CHECKED_IN: 'Eingecheckt',
  MISSED: 'Check-in verpasst',
  ADMIN_CONFIRMED: 'Von der Leitung bestätigt',
};

const FORMAT_LABEL: Record<string, string> = {
  SINGLE_ELIMINATION: 'K.-o.-System',
  DOUBLE_ELIMINATION: 'Doppel-K.-o.',
  ROUND_ROBIN: 'Jeder gegen jeden',
  SWISS: 'Schweizer System',
  GROUPS_THEN_ELIMINATION: 'Gruppen, dann K.-o.',
};

const STREAM_LABEL: Record<string, string> = {
  NOT_STREAMED: 'Kein Stream',
  PLANNED: 'Stream geplant',
  LIVE: 'Live',
  FINISHED: 'Stream beendet',
};

type Variante = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const STATUS_VARIANTE: Record<string, Variante> = {
  DRAFT: 'outline',
  REGISTRATION_OPEN: 'success',
  REGISTRATION_CLOSED: 'secondary',
  CHECKIN_OPEN: 'warning',
  CHECKIN_CLOSED: 'secondary',
  READY: 'default',
  RUNNING: 'default',
  PAUSED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
  ARCHIVED: 'outline',
};

const MATCH_VARIANTE: Record<string, Variante> = {
  PENDING: 'outline',
  READY: 'secondary',
  SCHEDULED: 'secondary',
  LIVE: 'default',
  AWAITING_RESULT: 'warning',
  DISPUTED: 'destructive',
  COMPLETED: 'success',
  FORFEIT: 'warning',
  CANCELLED: 'outline',
};

const REGISTRATION_VARIANTE: Record<string, Variante> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  WAITLISTED: 'secondary',
  REJECTED: 'destructive',
  CANCELLED: 'outline',
};

const CHECKIN_VARIANTE: Record<string, Variante> = {
  NOT_REQUIRED: 'outline',
  PENDING: 'warning',
  CHECKED_IN: 'success',
  MISSED: 'destructive',
  ADMIN_CONFIRMED: 'success',
};

const STREAM_VARIANTE: Record<string, Variante> = {
  NOT_STREAMED: 'outline',
  PLANNED: 'secondary',
  LIVE: 'destructive',
  FINISHED: 'outline',
};

/**
 * Zustaende als Abzeichen.
 *
 * Der Text steht immer dabei - Farbe allein traegt die Information nicht, und
 * wer sie nicht unterscheiden kann, saehe sonst nur graue Punkte.
 */
export function TournamentStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge variant={STATUS_VARIANTE[status] ?? 'secondary'}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function MatchStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge variant={MATCH_VARIANTE[status] ?? 'secondary'}>{MATCH_LABEL[status] ?? status}</Badge>;
}

export function RegistrationStatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Badge variant={REGISTRATION_VARIANTE[status] ?? 'secondary'}>
      {REGISTRATION_LABEL[status] ?? status}
    </Badge>
  );
}

export function CheckinStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge variant={CHECKIN_VARIANTE[status] ?? 'secondary'}>{CHECKIN_LABEL[status] ?? status}</Badge>;
}

export function StreamStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge variant={STREAM_VARIANTE[status] ?? 'outline'}>{STREAM_LABEL[status] ?? status}</Badge>;
}

export { STATUS_LABEL, MATCH_LABEL, REGISTRATION_LABEL, CHECKIN_LABEL, FORMAT_LABEL, STREAM_LABEL };
