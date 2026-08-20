'use client';

import { formatDateTime } from '@swisshub/shared';
import { branding } from '@swisshub/config/client';
import { cn } from '@/lib/utils';

/**
 * Live-Vorschau des Discord-Embeds.
 *
 * Bewusst nur eine Darstellungshilfe: gesendet wird ausschliesslich das, was
 * der Server aus den validierten Eingaben baut. Die Vorschau bildet Discords
 * Optik nach, ist aber nie die Quelle des Payloads.
 */
export type PreviewType = 'NEWS' | 'EVENT' | 'POLL';

const ACCENT: Record<PreviewType, string> = {
  NEWS: '#83060a',
  EVENT: '#e63a41',
  POLL: '#3b82f6',
};

const TITLE_PREFIX: Record<PreviewType, string> = {
  NEWS: '📰',
  EVENT: '🎉',
  POLL: '📊',
};

export interface EmbedPreviewProps {
  type: PreviewType;
  title: string;
  content: string;
  bannerUrl?: string;
  footerText: string;
  channelName?: string | null;
  mentionLabel?: string | null;
  startsAt?: Date | null;
  responsibleLabel?: string | null;
}

export function EmbedPreview({
  type,
  title,
  content,
  bannerUrl,
  footerText,
  channelName,
  mentionLabel,
  startsAt,
  responsibleLabel,
}: EmbedPreviewProps): React.JSX.Element {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Vorschau{channelName ? ` · #${channelName}` : ''}
      </p>

      <div className="rounded-lg border border-border bg-[#313338] p-4 text-[#dbdee1]">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {branding.logo.monogram}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium text-white">
              {branding.name}
              <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                Bot
              </span>
            </p>

            {mentionLabel ? <p className="text-sm text-[#c9cdfb]">{mentionLabel}</p> : null}

            <div className="rounded border-l-4 bg-[#2b2d31] p-3" style={{ borderLeftColor: ACCENT[type] }}>
              <p className="font-semibold text-white">
                {TITLE_PREFIX[type]} {title.trim() === '' ? 'Titel' : title}
              </p>
              <p
                className={cn(
                  'mt-1 whitespace-pre-wrap break-words text-sm',
                  content.trim() === '' && 'italic opacity-60',
                )}
              >
                {content.trim() === '' ? 'Text der Nachricht …' : content}
              </p>

              {type === 'POLL' ? (
                <p className="mt-2 whitespace-pre-line text-sm">
                  <strong>Stimm mit de Reactions ab:</strong>
                  {'\n'}👍 Ja{'\n'}👎 Nei
                </p>
              ) : null}

              {type === 'EVENT' ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-white">📅 Datum</p>
                    <p className="text-sm">
                      {startsAt ? formatDateTime(startsAt) : 'Noch kein Datum gewählt'}
                    </p>
                  </div>
                  {responsibleLabel ? (
                    <div>
                      <p className="text-xs font-semibold text-white">👤 Verantwortlich</p>
                      <p className="text-sm text-[#c9cdfb]">@{responsibleLabel}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bannerUrl}
                  alt=""
                  className="mt-3 max-h-56 w-full rounded object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}

              <p className="mt-3 text-xs opacity-70">{footerText}</p>
            </div>
          </div>
        </div>
      </div>

      {type === 'POLL' ? (
        <p className="text-xs text-muted-foreground">
          Der Bot setzt 👍 und 👎 nach dem Senden automatisch als Reaktionen.
        </p>
      ) : null}
    </div>
  );
}
