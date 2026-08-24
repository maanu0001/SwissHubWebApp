import { Lock, Paperclip, Trash2 } from 'lucide-react';
import { formatDayTime } from '@swisshub/shared';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { cn } from '@/lib/utils';

export interface ThreadMessage {
  id: string;
  source: string;
  authorDiscordId: string | null;
  authorUsername: string | null;
  authorAvatarHash: string | null;
  fromStaff: boolean;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  attachments: Array<{ fileName: string; url: string }>;
}

const HERKUNFT_LABEL: Record<string, string> = {
  DISCORD: 'auf Discord',
  WEBAPP: 'über das Dashboard',
  SYSTEM: 'System',
  INTERNAL_NOTE: 'interne Notiz',
};

/**
 * Der Gespraechsverlauf.
 *
 * Interne Notizen sind deutlich abgesetzt und tragen ein Schloss. Sie sehen
 * bewusst anders aus als jede andere Nachricht: wer im Team schreibt, muss
 * auf einen Blick erkennen, ob das Mitglied mitliest - eine Notiz, die man
 * fuer eine Antwort haelt, ist der teuerste Irrtum dieses Moduls.
 *
 * Ob Notizen ueberhaupt in der Liste stehen, entscheidet nicht diese
 * Darstellung, sondern die Abfrage. Etwas zu laden und im Browser
 * auszublenden waere keine Zugriffskontrolle.
 */
export function TicketThread({ messages }: { messages: ThreadMessage[] }): React.JSX.Element {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Noch keine Nachrichten"
        description="Sobald im Ticket-Kanal geschrieben wird, erscheint es hier."
      />
    );
  }

  return (
    <ol className="space-y-3">
      {messages.map((nachricht) => {
        const notiz = nachricht.source === 'INTERNAL_NOTE';
        const geloescht = nachricht.deletedAt !== null;

        return (
          <li
            key={nachricht.id}
            className={cn(
              'rounded-xl border p-4',
              notiz
                ? 'border-warning/40 bg-warning/5'
                : nachricht.fromStaff
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-border bg-card/40',
            )}
          >
            {/* Systemnachrichten tragen keinen Autor - dann steht dort
                «System» statt eines leeren Namens. */}
            <div className="flex items-start gap-3">
              <DiscordAvatar
                discordId={nachricht.authorDiscordId ?? '0'}
                avatarHash={nachricht.authorAvatarHash}
                name={nachricht.authorUsername ?? 'System'}
                size={32}
                className="mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-medium">{nachricht.authorUsername ?? 'System'}</span>
                  {notiz ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                      <Lock className="size-3" aria-hidden="true" />
                      Nur für das Team sichtbar
                    </span>
                  ) : nachricht.fromStaff ? (
                    <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary-bright">
                      Support
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {formatDayTime(nachricht.createdAt)}
                    {!notiz && HERKUNFT_LABEL[nachricht.source]
                      ? ` · ${HERKUNFT_LABEL[nachricht.source]}`
                      : ''}
                    {nachricht.editedAt ? ' · bearbeitet' : ''}
                  </span>
                </div>

                {geloescht ? (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm italic text-muted-foreground">
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Diese Nachricht wurde auf Discord gelöscht.
                  </p>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {nachricht.content}
                  </p>
                )}

                {nachricht.attachments.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {nachricht.attachments.map((anhang) => (
                      <li key={anhang.url}>
                        {/* Anhänge liegen auf Discords CDN. Der Link führt
                            dorthin - eine Kopie im Dashboard wäre eine zweite
                            Stelle, an der Dateien von Mitgliedern liegen. */}
                        <a
                          href={anhang.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Paperclip className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{anhang.fileName}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
