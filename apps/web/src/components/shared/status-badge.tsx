import { Badge } from '@/components/ui/badge';

type Status = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

const STATUS_LABEL: Record<Status, string> = {
  PENDING: 'Ausstehend',
  EXECUTING: 'Wird ausgefuehrt',
  COMPLETED: 'Abgeschlossen',
  PARTIAL: 'Teilweise',
  FAILED: 'Fehlgeschlagen',
};

const STATUS_VARIANT: Record<Status, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  PENDING: 'secondary',
  EXECUTING: 'secondary',
  COMPLETED: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
};

export function StatusBadge({ status }: { status: Status | string }): React.JSX.Element {
  const key = (status in STATUS_LABEL ? status : 'PENDING') as Status;
  return <Badge variant={STATUS_VARIANT[key]}>{STATUS_LABEL[key]}</Badge>;
}

export function BotStatusBadge({ online, stale }: { online: boolean; stale: boolean }): React.JSX.Element {
  if (online) {
    return (
      <Badge variant="success">
        <span className="size-1.5 rounded-full bg-success animate-pulse-ring" aria-hidden="true" />
        Bot online
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
      {stale ? 'Bot derzeit nicht erreichbar' : 'Bot offline'}
    </Badge>
  );
}
