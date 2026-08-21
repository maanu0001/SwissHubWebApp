import type { XpRaffleEntryModel, XpRaffleStatus } from '@swisshub/database';
import { formatSwissNumber, formatSwissPercent } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';

/**
 * Darstellungsbausteine, die Verwaltung und öffentliche Seite teilen.
 *
 * Damit heisst ein Zustand überall gleich - eine Verlosung, die im Dashboard
 * "Teilnahme geöffnet" ist, steht auf der Mitgliederseite nicht plötzlich
 * unter einem anderen Wort.
 */

export const RAFFLE_STATUS_LABEL: Record<XpRaffleStatus, string> = {
  DRAFT: 'Entwurf',
  SCHEDULED: 'Geplant',
  ENTRY_OPEN: 'Teilnahme geöffnet',
  ENTRY_CLOSED: 'Teilnahme geschlossen',
  DRAWING: 'Ziehung läuft',
  WINNER_PENDING: 'Gewinner wartet auf Bestätigung',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgebrochen',
};

const STATUS_TONE: Record<XpRaffleStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline',
  SCHEDULED: 'secondary',
  ENTRY_OPEN: 'default',
  ENTRY_CLOSED: 'secondary',
  DRAWING: 'default',
  WINNER_PENDING: 'secondary',
  COMPLETED: 'outline',
  CANCELLED: 'destructive',
};

export function RaffleStatusBadge({ status }: { status: XpRaffleStatus }): React.JSX.Element {
  return <Badge variant={STATUS_TONE[status]}>{RAFFLE_STATUS_LABEL[status]}</Badge>;
}

/**
 * Diese Formatierer werden von Server- und Client-Komponenten verwendet.
 * Deshalb dürfen sie nicht von `toLocaleString` abhängen - Node und Browser
 * setzen unterschiedliche Apostrophe, und React meldete beim Abgleich der
 * beiden Fassungen einen Hydration-Fehler.
 */
export const formatXp = (value: number): string => `${formatSwissNumber(value)} XP`;

export const formatNumber = (value: number): string => formatSwissNumber(value);

/** Gewinnchance als Prozentzahl. Der Wert kommt fertig vom Server. */
export const formatChance = (chance: number): string => formatSwissPercent(chance);

/**
 * Zeitpunkt in Schweizer Schreibweise, immer in Europe/Zurich.
 *
 * Die Bestandteile werden einzeln geholt und selbst zusammengesetzt. Fertige
 * Vorlagen wie `dateStyle: 'medium'` fallen je nach ICU-Fassung
 * unterschiedlich aus - auf dem Server anders als im Browser, und damit
 * wieder ein Hydration-Fehler.
 */
const DATE_PARTS = new Intl.DateTimeFormat('de-CH', {
  timeZone: 'Europe/Zurich',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatDateTime = (value: Date | string | null): string => {
  if (!value) {
    return '—';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const parts = Object.fromEntries(DATE_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
};

/** Erklärt in einem Satz, wie der Einsatz zustande kommt. */
export function describeEntryModel(raffle: {
  entryModel: XpRaffleEntryModel;
  fixedEntryXp?: number | null;
  percentageBasisPoints?: number | null;
  minimumEntryXp?: number | null;
  maximumEntryXp?: number | null;
}): string {
  if (raffle.entryModel === 'FIXED') {
    return `${formatXp(raffle.fixedEntryXp ?? 0)} für alle`;
  }
  const percent = (raffle.percentageBasisPoints ?? 0) / 100;
  const parts = [`${percent} % der eigenen XP`];
  if (raffle.minimumEntryXp) {
    parts.push(`mindestens ${formatXp(raffle.minimumEntryXp)}`);
  }
  if (raffle.maximumEntryXp) {
    parts.push(`höchstens ${formatXp(raffle.maximumEntryXp)}`);
  }
  return parts.join(', ');
}

/** Die Fairness-Zusage des jeweiligen Modells - im Klartext. */
export const fairnessNote = (entryModel: XpRaffleEntryModel): string =>
  entryModel === 'FIXED'
    ? 'Alle zahlen denselben Einsatz und haben dieselbe Gewinnchance.'
    : 'Die Gewinnchance richtet sich nach dem eingesetzten XP-Betrag im Verhältnis zu allen Einsätzen.';
