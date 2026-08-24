'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import {
  createTemplateAction,
  deleteTemplateAction,
  updateTemplateAction,
} from '@/modules/tickets/admin-actions';

/** Dieselbe Grenze wie eine Antwort - sonst wäre die Vorlage nicht sendbar. */
const MAX_LAENGE = 1800;

const ALLE = '__alle__';

export interface VorlageWerte {
  templateId?: string;
  title: string;
  content: string;
  categoryId: string | null;
}

export interface VorlageZeile extends VorlageWerte {
  templateId: string;
  kategorieName: string | null;
}

/**
 * Antwortvorlagen.
 *
 * Eine Vorlage ist ein Anfang, kein fertiger Text: beim Antworten wird sie
 * ins Feld gesetzt, nicht abgeschickt. Wer sie unveraendert sendet, hat das
 * entschieden.
 */
export function TemplateManager({
  csrfToken,
  vorlagen,
  kategorien,
}: {
  csrfToken: string;
  vorlagen: VorlageZeile[];
  kategorien: Array<{ id: string; name: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState<VorlageWerte | null>(null);
  const [loeschen, setLoeschen] = useState<VorlageZeile | null>(null);

  return (
    <>
      <div className="flex items-center justify-end">
        <Button onClick={() => setOffen({ title: '', content: '', categoryId: null })}>
          <Plus aria-hidden="true" />
          Vorlage anlegen
        </Button>
      </div>

      {vorlagen.length === 0 ? (
        <EmptyState
          title="Noch keine Vorlage"
          description="Vorlagen sparen Tipparbeit bei Antworten, die sich wiederholen."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {vorlagen.map((vorlage) => (
            <li
              key={vorlage.templateId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">{vorlage.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {vorlage.kategorieName ?? 'Für alle Kategorien'} · {vorlage.content}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setOffen(vorlage)}>
                  <Pencil aria-hidden="true" />
                  Bearbeiten
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${vorlage.title} entfernen`}
                  onClick={() => setLoeschen(vorlage)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={offen !== null} onOpenChange={(naechste) => (naechste ? undefined : setOffen(null))}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{offen?.templateId ? 'Vorlage bearbeiten' : 'Neue Vorlage'}</DialogTitle>
          </DialogHeader>
          {offen ? (
            <VorlageForm
              csrfToken={csrfToken}
              werte={offen}
              kategorien={kategorien}
              onFertig={() => setOffen(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(naechste) => (naechste ? undefined : setLoeschen(null))}
        destructive
        title="Vorlage entfernen?"
        description="Bereits gesendete Antworten bleiben unberührt."
        confirmLabel="Entfernen"
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await deleteTemplateAction({
            csrfToken,
            templateId: loeschen.templateId,
          });
          if (antwort.ok) {
            toast.success('Vorlage entfernt.');
            setLoeschen(null);
            router.refresh();
          } else {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
        }}
      />
    </>
  );
}

function VorlageForm({
  csrfToken,
  werte,
  kategorien,
  onFertig,
}: {
  csrfToken: string;
  werte: VorlageWerte;
  kategorien: Array<{ id: string; name: string }>;
  onFertig(): void;
}): React.JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<VorlageWerte>(werte);
  const [laeuft, setLaeuft] = useState(false);

  async function speichern(): Promise<void> {
    setLaeuft(true);
    const nutzlast = {
      csrfToken,
      title: form.title.trim(),
      content: form.content.trim(),
      categoryId: form.categoryId,
    };
    const antwort = form.templateId
      ? await updateTemplateAction({ ...nutzlast, templateId: form.templateId })
      : await createTemplateAction(nutzlast);

    if (antwort.ok) {
      toast.success('Vorlage gespeichert.');
      router.refresh();
      onFertig();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(false);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        void speichern();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="vorlage-titel">Titel</Label>
        <Input
          id="vorlage-titel"
          value={form.title}
          onChange={(ereignis) => setForm((vorher) => ({ ...vorher, title: ereignis.target.value }))}
          maxLength={100}
          required
          placeholder="Steht als Knopf über dem Antwortfeld."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="vorlage-kategorie">Kategorie</Label>
        <Select
          value={form.categoryId ?? ALLE}
          onValueChange={(naechste) =>
            setForm((vorher) => ({ ...vorher, categoryId: naechste === ALLE ? null : naechste }))
          }
        >
          <SelectTrigger id="vorlage-kategorie">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALLE}>Für alle Kategorien</SelectItem>
            {kategorien.map((kategorie) => (
              <SelectItem key={kategorie.id} value={kategorie.id}>
                {kategorie.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="vorlage-text">Text</Label>
        <Textarea
          id="vorlage-text"
          value={form.content}
          onChange={(ereignis) =>
            setForm((vorher) => ({ ...vorher, content: ereignis.target.value }))
          }
          maxLength={MAX_LAENGE}
          rows={6}
          required
        />
        <p className="text-xs text-muted-foreground">
          {form.content.length} / {MAX_LAENGE} Zeichen
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onFertig} disabled={laeuft}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          disabled={laeuft || form.title.trim().length === 0 || form.content.trim().length === 0}
        >
          {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Speichern
        </Button>
      </div>
    </form>
  );
}
