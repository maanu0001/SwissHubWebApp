'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Filter des Verlaufs.
 *
 * Die Auswahl steht in der Adresse, nicht im Zustand der Komponente: dadurch
 * lässt sich eine gefilterte Ansicht verlinken, und ein Neuladen verliert
 * nichts.
 */
const ALL = 'ALL';

export function HistoryFilters({
  channels,
}: {
  channels: Array<{ id: string; name: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string): void => {
    const next = new URLSearchParams(params.toString());
    if (value === '' || value === ALL) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Beim Filtern zurück auf die erste Seite - sonst landet man auf einer
    // Seite, die es im gefilterten Ergebnis nicht gibt.
    next.delete('seite');
    router.push(`/communication/history?${next.toString()}`);
  };

  const aktiv =
    params.get('typ') ||
    params.get('status') ||
    params.get('kanal') ||
    params.get('suche') ||
    params.get('von') ||
    params.get('bis');

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card/60 p-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="history-search">Suche</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="history-search"
            defaultValue={params.get('suche') ?? ''}
            placeholder="Titel oder Text …"
            className="pl-9"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                set('suche', (event.target as HTMLInputElement).value.trim());
              }
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">Mit Enter suchen.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="history-type">Art</Label>
        <Select value={params.get('typ') ?? ALL} onValueChange={(value) => set('typ', value)}>
          <SelectTrigger id="history-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle</SelectItem>
            <SelectItem value="NEWS">Neuigkeiten</SelectItem>
            <SelectItem value="EVENT">Event</SelectItem>
            <SelectItem value="POLL">Umfrage</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="history-status">Status</Label>
        <Select value={params.get('status') ?? ALL} onValueChange={(value) => set('status', value)}>
          <SelectTrigger id="history-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle</SelectItem>
            <SelectItem value="SENT">Gesendet</SelectItem>
            <SelectItem value="FAILED">Fehlgeschlagen</SelectItem>
            <SelectItem value="DELETED">Gelöscht</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="history-channel">Channel</Label>
        <Select value={params.get('kanal') ?? ALL} onValueChange={(value) => set('kanal', value)}>
          <SelectTrigger id="history-channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle</SelectItem>
            {channels.map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                #{channel.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="history-from">Von</Label>
        <Input
          id="history-from"
          type="date"
          defaultValue={params.get('von') ?? ''}
          onChange={(event) => set('von', event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="history-to">Bis</Label>
        <Input
          id="history-to"
          type="date"
          defaultValue={params.get('bis') ?? ''}
          onChange={(event) => set('bis', event.target.value)}
        />
      </div>

      {aktiv ? (
        <div className="sm:col-span-2 lg:col-span-3">
          <Button variant="outline" size="sm" onClick={() => router.push('/communication/history')}>
            <X aria-hidden="true" />
            Filter zurücksetzen
          </Button>
        </div>
      ) : null}
    </div>
  );
}
