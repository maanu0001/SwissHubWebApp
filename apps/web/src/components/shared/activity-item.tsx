import {
  Blocks,
  CircleAlert,
  Gavel,
  Lock,
  Megaphone,
  LogIn,
  ScrollText,
  Settings,
  ShieldAlert,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { cn } from '@/lib/utils';

export interface ActivityItemData {
  id: string;
  action: string;
  createdAt: Date;
  actorUsername: string | null;
  actorDiscordId?: string | null;
  actorAvatarHash?: string | null;
  targetLabel: string | null;
  reason: string | null;
  success: boolean;
}

type Tone = 'accent' | 'success' | 'info' | 'warning' | 'destructive';

const TONE_CLASSES: Record<Tone, { chip: string; dot: string }> = {
  accent: { chip: 'border-primary/25 bg-primary/10 text-primary-bright', dot: 'bg-primary-bright' },
  success: { chip: 'border-success/25 bg-success/10 text-success', dot: 'bg-success' },
  info: { chip: 'border-info/25 bg-info/10 text-info', dot: 'bg-info' },
  warning: { chip: 'border-warning/25 bg-warning/10 text-warning', dot: 'bg-warning' },
  destructive: {
    chip: 'border-destructive/25 bg-destructive/10 text-destructive',
    dot: 'bg-destructive',
  },
};

/** Darstellung je Audit-Aktion: Icon, Farbe und Satzbau. */
const ACTION_VIEW: Record<string, { icon: LucideIcon; tone: Tone; verb: string }> = {
  JAIL_CREATED: { icon: Lock, tone: 'accent', verb: 'hat {target} gejailt' },
  JAIL_RELEASED: { icon: Unlock, tone: 'success', verb: 'hat {target} freigelassen' },
  JAIL_FAILED: { icon: CircleAlert, tone: 'destructive', verb: 'konnte {target} nicht jailen' },
  JAIL_RECONCILED: { icon: ShieldAlert, tone: 'warning', verb: 'hat {target} abgeglichen' },
  RECONCILIATION_RUN: { icon: ShieldAlert, tone: 'info', verb: 'hat einen Abgleich ausgeführt' },
  LOGIN: { icon: LogIn, tone: 'info', verb: 'hat sich angemeldet' },
  LOGIN_DENIED: { icon: CircleAlert, tone: 'destructive', verb: 'wurde abgewiesen' },
  LOGOUT: { icon: LogIn, tone: 'info', verb: 'hat sich abgemeldet' },
  PERMISSION_DENIED: { icon: ShieldAlert, tone: 'warning', verb: 'hatte keine Berechtigung' },
  SETTING_CHANGED: { icon: Settings, tone: 'warning', verb: 'hat Einstellungen geändert' },
  ROLE_MAPPING_CHANGED: { icon: Settings, tone: 'warning', verb: 'hat Rollen angepasst' },
  MODULE_ENABLED: { icon: Blocks, tone: 'success', verb: 'hat ein Modul aktiviert' },
  MODULE_DISABLED: { icon: Blocks, tone: 'warning', verb: 'hat ein Modul deaktiviert' },
  MODULE_SETTINGS_CHANGED: { icon: Blocks, tone: 'warning', verb: 'hat Moduleinstellungen geändert' },
  VOTE_JAIL_STARTED: { icon: Gavel, tone: 'accent', verb: 'hat einen Vote Jail gegen {target} gestartet' },
  VOTE_JAIL_SUCCEEDED: { icon: Gavel, tone: 'accent', verb: 'Vote Jail gegen {target} war erfolgreich' },
  VOTE_JAIL_FAILED: { icon: Gavel, tone: 'info', verb: 'Vote Jail gegen {target} blieb ohne Ergebnis' },
  COMMUNICATION_NEWS_SENT: { icon: Megaphone, tone: 'info', verb: 'hat Neuigkeiten in {target} gesendet' },
  COMMUNICATION_EVENT_SENT: { icon: Megaphone, tone: 'info', verb: 'hat ein Event in {target} angekündigt' },
  COMMUNICATION_POLL_SENT: { icon: Megaphone, tone: 'info', verb: 'hat eine Umfrage in {target} gestartet' },
  COMMUNICATION_MESSAGE_DELETED: {
    icon: Megaphone,
    tone: 'warning',
    verb: 'hat eine Nachricht in {target} gelöscht',
  },
  BRANDING_LOGO_UPDATED: { icon: Settings, tone: 'info', verb: 'hat das Logo aktualisiert' },
  BRANDING_LOGO_RESET: { icon: Settings, tone: 'warning', verb: 'hat das Logo zurückgesetzt' },
};

const FALLBACK = { icon: ScrollText, tone: 'info' as Tone, verb: 'hat eine Aktion ausgeführt' };

/** Eintrag im Aktivitätsfeed des Dashboards. */
export function ActivityItem({ entry }: { entry: ActivityItemData }): React.JSX.Element {
  const view = ACTION_VIEW[entry.action] ?? FALLBACK;
  const tone = entry.success ? view.tone : 'destructive';
  const Icon = entry.success ? view.icon : CircleAlert;
  const classes = TONE_CLASSES[tone];
  const [before, after] = view.verb.split('{target}');

  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border', classes.chip)}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>

      {entry.actorDiscordId ? (
        <DiscordAvatar
          discordId={entry.actorDiscordId}
          avatarHash={entry.actorAvatarHash}
          name={entry.actorUsername ?? 'System'}
          size={24}
          className="mt-0.5"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold">{entry.actorUsername ?? 'System'}</span>{' '}
          <span className="text-muted-foreground">{before?.trim()}</span>
          {entry.targetLabel ? (
            <span className="font-semibold text-primary-bright"> {entry.targetLabel}</span>
          ) : null}
          {after ? <span className="text-muted-foreground"> {after.trim()}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {entry.reason ? `Grund: ${entry.reason} · ` : ''}
          {formatDateTime(entry.createdAt)}
        </p>
      </div>

      <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', classes.dot)} aria-hidden="true" />
    </li>
  );
}
