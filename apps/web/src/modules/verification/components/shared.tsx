import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { verification } from '@swisshub/modules';

type Status = Awaited<ReturnType<typeof verification.listQueue>>[number]['status'];

const STATUS_TEXT: Record<Status, string> = {
  WAITING_FOR_MESSAGE: 'Wartet auf Nachricht',
  AI_ANALYZING: 'AI prüft',
  WAITING_FOR_REVIEW: 'Wartet auf Prüfung',
  VERIFIED: 'Verifiziert',
  REJECTED: 'Abgelehnt',
  LEFT_SERVER: 'Server verlassen',
  EXPIRED: 'Abgelaufen',
  ERROR: 'Fehler',
};

const STATUS_STIL: Record<Status, string> = {
  WAITING_FOR_MESSAGE: 'border-border bg-muted text-muted-foreground',
  AI_ANALYZING: 'border-sky-500/40 bg-sky-500/10 text-sky-500',
  WAITING_FOR_REVIEW: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  VERIFIED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  LEFT_SERVER: 'border-border bg-muted text-muted-foreground',
  EXPIRED: 'border-border bg-muted text-muted-foreground',
  ERROR: 'border-destructive/40 bg-destructive/10 text-destructive',
};

export function StatusBadge({ status }: { status: Status }): React.JSX.Element {
  return (
    <Badge variant="outline" className={STATUS_STIL[status]}>
      {STATUS_TEXT[status]}
    </Badge>
  );
}

/**
 * Die AI-Einordnung als Text.
 *
 * `NOT_RECOGNISED` heisst ausdruecklich nicht «schlecht», sondern «nicht
 * erkannt» - die Beschriftung soll niemanden dazu verleiten, sie als Urteil
 * zu lesen.
 */
export function AiBadge({
  verdict,
  confidence,
}: {
  verdict: string | null;
  confidence: number | null;
}): React.JSX.Element | null {
  if (!verdict) {
    return null;
  }
  const text =
    verdict === 'LIKELY_SWISS_GERMAN'
      ? 'Wirkt schweizerdeutsch'
      : verdict === 'UNCLEAR'
        ? 'Unklar'
        : verdict === 'NOT_RECOGNISED'
          ? 'Nicht erkannt'
          : 'AI-Prüfung fehlgeschlagen';
  const stil =
    verdict === 'LIKELY_SWISS_GERMAN'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
      : verdict === 'FAILED'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border bg-muted text-muted-foreground';
  return (
    <Badge variant="outline" className={cn(stil, 'gap-1')}>
      🤖 {text}
      {confidence !== null ? ` · ${Math.round(confidence * 100)} %` : ''}
    </Badge>
  );
}

/** Sekunden als «2m 14s». */
export function dauer(sekunden: number): string {
  if (sekunden < 60) {
    return `${sekunden}s`;
  }
  const minuten = Math.floor(sekunden / 60);
  if (minuten < 60) {
    return `${minuten}m ${sekunden % 60}s`;
  }
  const stunden = Math.floor(minuten / 60);
  return stunden < 24 ? `${stunden}h ${minuten % 60}m` : `${Math.floor(stunden / 24)}d`;
}

export function kontoAlter(joinedAt: Date, accountCreatedAt: Date | null): string {
  if (!accountCreatedAt) {
    return 'unbekannt';
  }
  const tage = Math.floor((joinedAt.getTime() - accountCreatedAt.getTime()) / 86_400_000);
  if (tage >= 365) {
    const jahre = Math.floor(tage / 365);
    return `${jahre} Jahr${jahre === 1 ? '' : 'e'}`;
  }
  if (tage >= 1) {
    return `${tage} Tag${tage === 1 ? '' : 'e'}`;
  }
  return 'unter 1 Tag';
}
