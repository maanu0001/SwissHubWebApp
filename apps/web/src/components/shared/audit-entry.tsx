import { CheckCircle2, XCircle } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';

export interface AuditEntryData {
  id: string;
  createdAt: Date;
  action: string;
  module: string | null;
  actorUsername: string | null;
  actorDiscordId: string | null;
  targetLabel: string | null;
  targetDiscordId: string | null;
  success: boolean;
  errorCode: string | null;
  metadata: unknown;
}

const ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Anmeldung',
  LOGIN_DENIED: 'Anmeldung abgelehnt',
  LOGOUT: 'Abmeldung',
  PERMISSION_DENIED: 'Berechtigung verweigert',
  RATE_LIMITED: 'Rate Limit',
  SETTING_CHANGED: 'Einstellung geaendert',
  ROLE_MAPPING_CHANGED: 'Rollenzuordnung geaendert',
  MODULE_ENABLED: 'Modul aktiviert',
  MODULE_DISABLED: 'Modul deaktiviert',
  MODULE_SETTINGS_CHANGED: 'Moduleinstellungen geaendert',
  JAIL_CREATED: 'Jail erstellt',
  JAIL_RELEASED: 'Jail beendet',
  JAIL_FAILED: 'Jail fehlgeschlagen',
  JAIL_RECONCILED: 'Jail abgeglichen',
  RECONCILIATION_RUN: 'Abgleich ausgefuehrt',
  DISCORD_ACTION_FAILED: 'Discord-Aktion fehlgeschlagen',
  SESSION_REVOKED: 'Session beendet',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** Einzelner Audit-Eintrag als Listenelement. */
export function AuditEntry({ entry }: { entry: AuditEntryData }): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 border-b border-border/50 py-3 last:border-0">
      <span className={entry.success ? 'text-success' : 'text-destructive'} aria-hidden="true">
        {entry.success ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{auditActionLabel(entry.action)}</span>
          {entry.module ? <Badge variant="outline">{entry.module}</Badge> : null}
          {!entry.success && entry.errorCode ? <Badge variant="destructive">{entry.errorCode}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {entry.actorUsername ?? 'System'}
          {entry.targetLabel || entry.targetDiscordId
            ? ` · Ziel: ${entry.targetLabel ?? entry.targetDiscordId}`
            : ''}
        </p>
      </div>
      <time
        dateTime={entry.createdAt.toISOString()}
        className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
      >
        {formatDateTime(entry.createdAt)}
      </time>
    </li>
  );
}
