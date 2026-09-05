import { formatDayTime } from '@swisshub/shared';
import { PRIORITAET_LABEL, STATUS_LABEL } from './ticket-badges';

export interface TimelineEreignis {
  id: string;
  kind: string;
  actorUsername: string | null;
  actorSource: string;
  detail: unknown;
  createdAt: Date;
}

const KIND_TEXT: Record<string, string> = {
  CREATED: 'Ticket eröffnet',
  CLAIMED: 'übernommen',
  ASSIGNED: 'zugewiesen',
  UNASSIGNED: 'Zuweisung entfernt',
  STATUS_CHANGED: 'Status geändert',
  PRIORITY_CHANGED: 'Priorität geändert',
  TAG_ADDED: 'Schlagwort gesetzt',
  TAG_REMOVED: 'Schlagwort entfernt',
  USER_ADDED: 'Mitglied hinzugefügt',
  USER_REMOVED: 'Mitglied entfernt',
  CLOSED: 'geschlossen',
  REOPENED: 'wieder geöffnet',
  ARCHIVED: 'archiviert',
  CHANNEL_RECREATED: 'Discord-Kanal neu angelegt',
  CHANNEL_MISSING: 'Discord-Kanal fehlt',
  ESCALATED: 'eskaliert',
};

/** Zusatzangaben aus dem Ereignis, soweit sie sich lesbar darstellen lassen. */
function zusatz(kind: string, detail: unknown): string | null {
  if (typeof detail !== 'object' || detail === null) {
    return null;
  }
  const werte = detail as Record<string, unknown>;
  const alsText = (wert: unknown): string | null =>
    typeof wert === 'string' && wert.length > 0 ? wert : null;

  if (kind === 'STATUS_CHANGED' || kind === 'PRIORITY_CHANGED') {
    // Dieselben Beschriftungen wie auf den Abzeichen. `NORMAL → URGENT` im
    // Verlauf zu zeigen, während daneben «Dringend» steht, liest sich wie
    // zwei verschiedene Angaben.
    const woerterbuch = kind === 'STATUS_CHANGED' ? STATUS_LABEL : PRIORITAET_LABEL;
    const uebersetze = (wert: unknown): string | null => {
      const roh = alsText(wert);
      return roh === null ? null : (woerterbuch[roh] ?? roh);
    };
    const von = uebersetze(werte.von);
    const zu = uebersetze(werte.zu);
    return von && zu ? `${von} → ${zu}` : zu;
  }
  if (kind === 'USER_ADDED' || kind === 'USER_REMOVED' || kind === 'TAG_ADDED' || kind === 'TAG_REMOVED') {
    return alsText(werte.wer);
  }
  if (kind === 'ASSIGNED') {
    return alsText(werte.zu);
  }
  if (kind === 'CLOSED') {
    return alsText(werte.grund);
  }
  if (kind === 'CREATED') {
    return alsText(werte.category);
  }
  return null;
}

/**
 * Was mit dem Ticket geschehen ist.
 *
 * Bewusst getrennt vom Gespraechsverlauf: Statuswechsel zwischen den
 * Nachrichten zu mischen macht beide schwerer zu lesen, und im Zweifel will
 * man genau eines von beidem nachvollziehen.
 */
export function TicketTimeline({ ereignisse }: { ereignisse: TimelineEreignis[] }): React.JSX.Element {
  if (ereignisse.length === 0) {
    return <p className="text-sm text-muted-foreground">Noch nichts geschehen.</p>;
  }

  return (
    <ol className="space-y-2.5">
      {ereignisse.map((ereignis) => {
        const text = KIND_TEXT[ereignis.kind] ?? ereignis.kind;
        const mehr = zusatz(ereignis.kind, ereignis.detail);
        return (
          <li key={ereignis.id} className="flex gap-2.5 text-xs">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block">
                {ereignis.actorUsername ? (
                  <span className="font-medium text-foreground">{ereignis.actorUsername} </span>
                ) : ereignis.actorSource === 'SYSTEM' ? (
                  <span className="font-medium text-foreground">System </span>
                ) : null}
                <span className="text-muted-foreground">{text}</span>
              </span>
              {mehr ? <span className="block break-words text-muted-foreground">{mehr}</span> : null}
              <span className="block text-muted-foreground/70">{formatDayTime(ereignis.createdAt)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
