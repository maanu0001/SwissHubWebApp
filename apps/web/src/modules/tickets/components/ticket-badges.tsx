import { Badge } from '@/components/ui/badge';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Wird angelegt',
  OPEN: 'Offen',
  IN_PROGRESS: 'In Bearbeitung',
  WAITING_FOR_USER: 'Wartet auf Mitglied',
  WAITING_FOR_STAFF: 'Wartet auf Support',
  RESOLVED: 'Gelöst',
  CLOSED: 'Geschlossen',
  ARCHIVED: 'Archiviert',
  CREATION_FAILED: 'Erstellung fehlgeschlagen',
};

const PRIORITAET_LABEL: Record<string, string> = {
  LOW: 'Niedrig',
  NORMAL: 'Normal',
  HIGH: 'Hoch',
  URGENT: 'Dringend',
};

type Variante = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const STATUS_VARIANTE: Record<string, Variante> = {
  PENDING: 'secondary',
  OPEN: 'default',
  IN_PROGRESS: 'default',
  WAITING_FOR_USER: 'secondary',
  WAITING_FOR_STAFF: 'warning',
  RESOLVED: 'success',
  CLOSED: 'secondary',
  ARCHIVED: 'outline',
  CREATION_FAILED: 'destructive',
};

const PRIORITAET_VARIANTE: Record<string, Variante> = {
  LOW: 'outline',
  NORMAL: 'secondary',
  HIGH: 'warning',
  URGENT: 'destructive',
};

/**
 * Status und Dringlichkeit als Abzeichen.
 *
 * Der Text steht immer dabei - Farbe allein traegt die Information nicht,
 * und wer sie nicht unterscheiden kann, saehe sonst nur graue Punkte.
 */
export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  return (
    <Badge variant={STATUS_VARIANTE[status] ?? 'secondary'}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }): React.JSX.Element {
  return (
    <Badge variant={PRIORITAET_VARIANTE[priority] ?? 'secondary'}>
      {PRIORITAET_LABEL[priority] ?? priority}
    </Badge>
  );
}

export { STATUS_LABEL, PRIORITAET_LABEL };
