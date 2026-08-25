import type { Metadata } from 'next';
import Link from 'next/link';
import { Crown, Eye, EyeOff, Lock, Users } from 'lucide-react';
import { formatDuration } from '@swisshub/shared';
import { voiceHub } from '@swisshub/modules';
import { PageToolbar } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { VoiceSectionNav } from '@/modules/voice/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { voiceSections } from '@/server/voice';

export const metadata: Metadata = { title: 'Aktive Talks' };
export const dynamic = 'force-dynamic';
/**
 * Häufig neu laden.
 *
 * Wer die Talks des Servers ansieht, will wissen, was gerade läuft - nicht,
 * was vor fünf Minuten lief. Eine eigene Echtzeitleitung braucht es dafür
 * nicht: die Seite ist ohnehin dynamisch, und der Browser holt sie beim
 * Wechsel neu.
 */
export const revalidate = 0;

/** Alle laufenden Talks des Servers. */
export default async function AktiveTalksPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(voiceHub.VOICE_HUB_PERMISSIONS.adminView);
  const talks = await voiceHub.listActiveTalks();

  return (
    <>
      <VoiceSectionNav sections={voiceSections(context)} />
      <PageToolbar />

      {talks.length === 0 ? (
        <EmptyState
          title="Gerade läuft kein Talk"
          description="Sobald jemand einen Hub betritt, erscheint sein Talk hier."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
          {talks.map(({ kanal, hub, preset, mitglieder }) => {
            const menschen = mitglieder.filter((mitglied) => !mitglied.isBot);
            return (
              <li key={kanal.id}>
                <Link
                  href={`/voice/talks/${kanal.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-card/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 basis-56">
                    <span className="block truncate font-medium">{kanal.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Crown className="size-3.5 shrink-0" aria-hidden="true" />
                        {kanal.ownerUsername}
                      </span>
                      {hub ? <span>{hub.name}</span> : null}
                      {preset ? <span>{preset.name}</span> : null}
                      <span>seit {formatDuration(Date.now() - kanal.createdAt.getTime())}</span>
                    </span>
                  </span>

                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="size-3.5 shrink-0" aria-hidden="true" />
                    {menschen.length}
                    {kanal.userLimit > 0 ? ` / ${kanal.userLimit}` : ''}
                  </span>

                  {kanal.locked ? (
                    <Badge variant="warning">
                      <Lock className="size-3" aria-hidden="true" />
                      Gesperrt
                    </Badge>
                  ) : null}
                  {kanal.hidden ? (
                    <Badge variant="secondary">
                      <EyeOff className="size-3" aria-hidden="true" />
                      Versteckt
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      <Eye className="size-3" aria-hidden="true" />
                      Sichtbar
                    </Badge>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
