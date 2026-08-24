'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/states';
import { createTagAction, deleteTagAction } from '@/modules/tickets/admin-actions';

export interface SchlagwortZeile {
  id: string;
  name: string;
  color: string | null;
  anzahl: number;
}

/**
 * Schlagwoerter.
 *
 * Bewusst schlicht: ein Schlagwort ordnet ein, es entscheidet nichts. Farbe
 * und Name genuegen - alles Weitere waere Verwaltung um ihrer selbst willen.
 */
export function TagManager({
  csrfToken,
  schlagwoerter,
}: {
  csrfToken: string;
  schlagwoerter: SchlagwortZeile[];
}): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [farbe, setFarbe] = useState('#83060a');
  const [laeuft, setLaeuft] = useState<string | null>(null);

  async function anlegen(): Promise<void> {
    setLaeuft('create');
    const antwort = await createTagAction({ csrfToken, name: name.trim(), color: farbe });
    if (antwort.ok) {
      toast.success(`«${name.trim()}» angelegt.`);
      setName('');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  async function entfernen(tagId: string, bezeichnung: string): Promise<void> {
    setLaeuft(tagId);
    const antwort = await deleteTagAction({ csrfToken, tagId });
    if (antwort.ok) {
      toast.success(`«${bezeichnung}» entfernt.`);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <>
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 p-3"
        onSubmit={(ereignis) => {
          ereignis.preventDefault();
          void anlegen();
        }}
      >
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="tag-name">Neues Schlagwort</Label>
          <Input
            id="tag-name"
            value={name}
            onChange={(ereignis) => setName(ereignis.target.value)}
            maxLength={40}
            required
            placeholder="Rückfrage offen"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tag-farbe">Farbe</Label>
          <Input
            id="tag-farbe"
            type="color"
            value={farbe}
            onChange={(ereignis) => setFarbe(ereignis.target.value)}
            className="h-9 w-16 p-1"
          />
        </div>
        <Button type="submit" disabled={laeuft !== null || name.trim().length === 0}>
          {laeuft === 'create' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Anlegen
        </Button>
      </form>

      {schlagwoerter.length === 0 ? (
        <EmptyState
          title="Noch keine Schlagwörter"
          description="Sie helfen, wiederkehrende Anliegen im Archiv wiederzufinden."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {schlagwoerter.map((tag) => (
            <li key={tag.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span
                className="size-3 shrink-0 rounded-full border border-border"
                style={tag.color ? { backgroundColor: tag.color } : undefined}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{tag.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {tag.anzahl} {tag.anzahl === 1 ? 'Ticket' : 'Tickets'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${tag.name} entfernen`}
                disabled={laeuft !== null}
                onClick={() => void entfernen(tag.id, tag.name)}
              >
                {laeuft === tag.id ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 aria-hidden="true" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
