'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Pin, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import {
  createMemberNoteAction,
  deleteMemberNoteAction,
  updateMemberNoteAction,
} from '@/modules/members/actions';

/**
 * Interne Notizen zu einem Mitglied.
 *
 * Die Notizen kommen bereits gefiltert vom Server - dieser Bereich wird gar
 * nicht erst gerendert, wenn der Betrachter sie nicht sehen darf. Was hier
 * an Schaltflaechen erscheint, richtet sich nach `canEdit`/`canDelete` je
 * Notiz; ob eine Aenderung durchgeht, entscheidet der Dienst noch einmal.
 */
export interface NotizAnsicht {
  id: string;
  content: string;
  category: string | null;
  pinned: boolean;
  author: { discordId: string; username: string };
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

const MAX = 2000;

export function NotesPanel({
  discordId,
  csrfToken,
  notizen,
  canCreate,
}: {
  discordId: string;
  csrfToken: string;
  notizen: NotizAnsicht[];
  canCreate: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [kategorie, setKategorie] = useState('');
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');
  const [loeschen, setLoeschen] = useState<string | null>(null);

  async function fuehreAus(
    schluessel: string,
    arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(schluessel);
    const antwort = await arbeit();
    if (antwort.ok) {
      toast.success(erfolg);
      router.refresh();
    } else {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-5">
      {canCreate ? (
        <form
          className="space-y-2 rounded-xl border border-border p-4"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            void fuehreAus(
              'neu',
              () =>
                createMemberNoteAction({
                  csrfToken,
                  discordId,
                  content: text,
                  category: kategorie.trim() === '' ? null : kategorie.trim(),
                }),
              'Notiz gespeichert.',
            ).then(() => {
              setText('');
              setKategorie('');
            });
          }}
        >
          <Label htmlFor="notiz-text">Neue interne Notiz</Label>
          <textarea
            id="notiz-text"
            value={text}
            onChange={(ereignis) => setText(ereignis.target.value)}
            maxLength={MAX}
            rows={3}
            required
            placeholder="Nur für das Team sichtbar."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={kategorie}
              onChange={(ereignis) => setKategorie(ereignis.target.value)}
              maxLength={40}
              placeholder="Kategorie (optional)"
              aria-label="Kategorie"
              className="h-9 max-w-56"
            />
            <span className="text-xs text-muted-foreground">
              {text.length}/{MAX}
            </span>
            <Button type="submit" size="sm" disabled={laeuft !== null || text.trim() === ''}>
              Notiz speichern
            </Button>
          </div>
        </form>
      ) : null}

      {notizen.length === 0 ? (
        <EmptyState
          className="border-0"
          title="Keine internen Notizen"
          description="Zu diesem Mitglied wurde noch nichts vermerkt."
        />
      ) : (
        <ul className="space-y-3">
          {notizen.map((notiz) => (
            <li key={notiz.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {notiz.pinned ? (
                  <Badge variant="outline" className="gap-1">
                    <Pin className="size-3" aria-hidden="true" />
                    Angeheftet
                  </Badge>
                ) : null}
                {notiz.category ? <Badge variant="outline">{notiz.category}</Badge> : null}
                <span>{notiz.author.username}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={notiz.createdAt}>{new Date(notiz.createdAt).toLocaleString('de-CH')}</time>
                {notiz.editedAt ? <span>· bearbeitet</span> : null}
              </div>

              {bearbeitet === notiz.id ? (
                <form
                  className="mt-3 space-y-2"
                  onSubmit={(ereignis) => {
                    ereignis.preventDefault();
                    void fuehreAus(
                      notiz.id,
                      () =>
                        updateMemberNoteAction({
                          csrfToken,
                          discordId,
                          id: notiz.id,
                          content: entwurf,
                          category: notiz.category,
                        }),
                      'Notiz geändert.',
                    ).then(() => setBearbeitet(null));
                  }}
                >
                  <textarea
                    value={entwurf}
                    onChange={(ereignis) => setEntwurf(ereignis.target.value)}
                    maxLength={MAX}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={laeuft === notiz.id}>
                      Speichern
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setBearbeitet(null)}>
                      Abbrechen
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm">{notiz.content}</p>
              )}

              {(notiz.canEdit || notiz.canDelete) && bearbeitet !== notiz.id ? (
                <div className="mt-3 flex gap-2">
                  {notiz.canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setBearbeitet(notiz.id);
                        setEntwurf(notiz.content);
                      }}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                      Bearbeiten
                    </Button>
                  ) : null}
                  {notiz.canDelete ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setLoeschen(notiz.id)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      Löschen
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(offen) => setLoeschen(offen ? loeschen : null)}
        title="Notiz löschen?"
        description="Die Notiz wird endgültig entfernt. Das Löschen steht im Audit Log."
        confirmLabel="Löschen"
        destructive
        onConfirm={async () => {
          if (loeschen === null) {
            return;
          }
          const antwort = await deleteMemberNoteAction({ csrfToken, discordId, id: loeschen });
          if (antwort.ok) {
            toast.success('Notiz gelöscht.');
            router.refresh();
          } else {
            toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
          }
          setLoeschen(null);
        }}
      />
    </div>
  );
}
