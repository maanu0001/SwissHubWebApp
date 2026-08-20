import type { Metadata } from 'next';
import { Hash, Megaphone, Mic, MessageSquare } from 'lucide-react';
import { listCachedChannels } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Channels' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  text: 'Text',
  voice: 'Sprache',
  announcement: 'Ankündigung',
  forum: 'Forum',
  stage: 'Bühne',
  category: 'Kategorie',
};

function KindIcon({ kind }: { kind: string | null }): React.JSX.Element {
  if (kind === 'voice' || kind === 'stage') {
    return <Mic className="size-3.5" aria-hidden="true" />;
  }
  if (kind === 'announcement') {
    return <Megaphone className="size-3.5" aria-hidden="true" />;
  }
  if (kind === 'forum') {
    return <MessageSquare className="size-3.5" aria-hidden="true" />;
  }
  return <Hash className="size-3.5" aria-hidden="true" />;
}

/** Channels aus dem Sync-Cache - dieselbe Liste, die in den Einstellungen zur Auswahl steht. */
export default async function ServerChannelsPage(): Promise<React.JSX.Element> {
  await requirePagePermission('settings.view');

  const channels = await listCachedChannels().catch(() => []);
  const categories = channels.filter((channel) => channel.kind === 'category');
  const others = channels.filter((channel) => channel.kind !== 'category');

  const grouped = [
    ...categories.map((category) => ({
      name: category.name,
      channels: others.filter((channel) => channel.parentId === category.id),
    })),
    { name: 'Ohne Kategorie', channels: others.filter((channel) => channel.parentId === null) },
  ].filter((group) => group.channels.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>
          Stand des letzten Discord-Abgleichs. Genau diese Channels stehen in den Moduleinstellungen zur
          Auswahl.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grouped.length === 0 ? (
          <EmptyState
            title="Keine Channels synchronisiert"
            description="Bitte unter System → Discord-Sync einen Abgleich starten."
          />
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <section key={group.name} className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </h3>
                <ul className="space-y-1">
                  {group.channels.map((channel) => (
                    <li
                      key={channel.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                    >
                      <KindIcon kind={channel.kind} />
                      <span>{channel.name}</span>
                      {channel.kind ? (
                        <Badge variant="outline">{KIND_LABEL[channel.kind] ?? channel.kind}</Badge>
                      ) : null}
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{channel.id}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
