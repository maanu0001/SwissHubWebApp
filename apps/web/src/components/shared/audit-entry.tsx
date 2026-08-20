import { CheckCircle2, XCircle } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { DiscordAvatar } from '@/components/shared/discord-avatar';

export interface AuditEntryData {
  id: string;
  createdAt: Date;
  action: string;
  module: string | null;
  actorUsername: string | null;
  actorDiscordId: string | null;
  targetLabel: string | null;
  targetDiscordId: string | null;
  /** Wird beim Laden nachgeschlagen (siehe `loadAvatarHashes`). */
  actorAvatarHash?: string | null;
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
  SETTING_CHANGED: 'Einstellung geändert',
  ROLE_MAPPING_CHANGED: 'Rollenzuordnung geändert',
  MODULE_ENABLED: 'Modul aktiviert',
  MODULE_DISABLED: 'Modul deaktiviert',
  MODULE_SETTINGS_CHANGED: 'Moduleinstellungen geändert',
  JAIL_CREATED: 'Jail erstellt',
  JAIL_RELEASED: 'Jail beendet',
  JAIL_FAILED: 'Jail fehlgeschlagen',
  JAIL_RECONCILED: 'Jail abgeglichen',
  VOTE_JAIL_STARTED: 'Vote Jail gestartet',
  VOTE_JAIL_SUCCEEDED: 'Vote Jail erfolgreich',
  VOTE_JAIL_FAILED: 'Vote Jail ohne Ergebnis',
  COMMUNICATION_NEWS_SENT: 'Neuigkeiten gesendet',
  COMMUNICATION_EVENT_SENT: 'Event gesendet',
  COMMUNICATION_POLL_SENT: 'Umfrage gesendet',
  COMMUNICATION_MESSAGE_DELETED: 'Nachricht gelöscht',
  COMMUNICATION_SEND_FAILED: 'Senden fehlgeschlagen',
  BRANDING_LOGO_UPDATED: 'Logo aktualisiert',
  BRANDING_LOGO_RESET: 'Logo zurückgesetzt',
  RECONCILIATION_RUN: 'Abgleich ausgeführt',
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
      {entry.actorDiscordId ? (
        <DiscordAvatar
          discordId={entry.actorDiscordId}
          avatarHash={entry.actorAvatarHash}
          name={entry.actorUsername ?? 'System'}
          size={24}
        />
      ) : null}
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
