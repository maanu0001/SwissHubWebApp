'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { MultiSelect } from '@/modules/configuration/components/multi-select';
import type { ChannelOption } from '@/modules/configuration/components/discord-option-types';
import {
  createPanelAction,
  deletePanelAction,
  publishPanelAction,
  updatePanelAction,
} from '@/modules/tickets/admin-actions';

export interface PanelWerte {
  panelId?: string;
  name: string;
  title: string;
  description: string;
  bannerUrl: string;
  thumbnailUrl: string;
  footerText: string;
  discordChannelId: string;
  buttonLabel: string;
  buttonEmoji: string;
  active: boolean;
  categoryIds: string[];
}

export interface PanelZeile extends PanelWerte {
  panelId: string;
  veroeffentlicht: boolean;
  kategorieNamen: string[];
}

const LEER: PanelWerte = {
  name: '',
  title: 'SwissHub Support',
  description: 'Wähle aus, worum es geht. Wir melden uns so schnell wie möglich.',
  bannerUrl: '',
  thumbnailUrl: '',
  footerText: '',
  discordChannelId: '',
  buttonLabel: 'Ticket erstellen',
  buttonEmoji: '🎫',
  active: true,
  categoryIds: [],
};

/**
 * Ticket-Panels.
 *
 * Ein Panel ist die Nachricht auf Discord, ueber die Mitglieder eroeffnen.
 * Speichern und Veroeffentlichen sind bewusst zwei Schritte: an einem Panel
 * laesst sich arbeiten, ohne dass jede Zwischenfassung im Kanal steht.
 */
export function PanelManager({
  csrfToken,
  panels,
  kategorien,
  channels,
}: {
  csrfToken: string;
  panels: PanelZeile[];
  kategorien: Array<{ id: string; name: string; active: boolean }>;
  channels: ChannelOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState<PanelWerte | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [loeschen, setLoeschen] = useState<PanelZeile | null>(null);

  const textkanaele = channels.filter((kanal) => kanal.kind === 'text');

  async function veroeffentlichen(panelId: string): Promise<void> {
    setLaeuft(panelId);
    const antwort = await publishPanelAction({ csrfToken, panelId });
    if (antwort.ok) {
      toast.success('Panel auf Discord veröffentlicht.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <Button onClick={() => setOffen({ ...LEER })}>
          <Plus aria-hidden="true" />
          Panel anlegen
        </Button>
      </div>

      {panels.length === 0 ? (
        <EmptyState
          title="Noch kein Panel"
          description="Ohne Panel können Mitglieder nur über das Dashboard eröffnen."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {panels.map((panel) => (
            <li key={panel.panelId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">{panel.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {panel.kategorieNamen.join(', ') || 'Keine Kategorie'}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-2">
                <Badge variant={panel.veroeffentlicht ? 'success' : 'warning'}>
                  {panel.veroeffentlicht ? 'Veröffentlicht' : 'Nicht veröffentlicht'}
                </Badge>
                <Badge variant={panel.active ? 'secondary' : 'outline'}>
                  {panel.active ? 'Aktiv' : 'Inaktiv'}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={laeuft !== null}
                  onClick={() => void veroeffentlichen(panel.panelId)}
                >
                  {laeuft === panel.panelId ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Send aria-hidden="true" />
                  )}
                  {panel.veroeffentlicht ? 'Aktualisieren' : 'Veröffentlichen'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setOffen(panel)}>
                  <Pencil aria-hidden="true" />
                  Bearbeiten
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${panel.name} entfernen`}
                  onClick={() => setLoeschen(panel)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={offen !== null} onOpenChange={(naechste) => (naechste ? undefined : setOffen(null))}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{offen?.panelId ? 'Panel bearbeiten' : 'Neues Panel'}</DialogTitle>
          </DialogHeader>
          {offen ? (
            <PanelForm
              csrfToken={csrfToken}
              werte={offen}
              kategorien={kategorien}
              channels={textkanaele}
              onFertig={() => setOffen(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(naechste) => (naechste ? undefined : setLoeschen(null))}
        destructive
        title="Panel entfernen?"
        description="Die Nachricht auf Discord wird mit gelöscht, damit niemand mehr auf einen Knopf ohne Wirkung drückt."
        confirmLabel="Entfernen"
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await deletePanelAction({ csrfToken, panelId: loeschen.panelId });
          if (antwort.ok) {
            toast.success('Panel entfernt.');
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

function PanelForm({
  csrfToken,
  werte,
  kategorien,
  channels,
  onFertig,
}: {
  csrfToken: string;
  werte: PanelWerte;
  kategorien: Array<{ id: string; name: string; active: boolean }>;
  channels: ChannelOption[];
  onFertig(): void;
}): React.JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<PanelWerte>(werte);
  const [laeuft, setLaeuft] = useState(false);

  function setze<K extends keyof PanelWerte>(schluessel: K, wert: PanelWerte[K]): void {
    setForm((vorher) => ({ ...vorher, [schluessel]: wert }));
  }

  async function speichern(): Promise<void> {
    setLaeuft(true);
    const nutzlast = {
      csrfToken,
      name: form.name.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      bannerUrl: form.bannerUrl.trim() || null,
      thumbnailUrl: form.thumbnailUrl.trim() || null,
      footerText: form.footerText.trim() || null,
      color: null,
      discordChannelId: form.discordChannelId,
      buttonLabel: form.buttonLabel.trim() || 'Ticket erstellen',
      buttonEmoji: form.buttonEmoji.trim() || null,
      active: form.active,
      categoryIds: form.categoryIds,
    };

    const antwort = form.panelId
      ? await updatePanelAction({ ...nutzlast, panelId: form.panelId })
      : await createPanelAction(nutzlast);

    if (antwort.ok) {
      toast.success(
        form.panelId
          ? 'Panel gespeichert. Zum Übernehmen auf Discord «Aktualisieren» drücken.'
          : 'Panel angelegt. Es erscheint erst nach dem Veröffentlichen auf Discord.',
      );
      router.refresh();
      onFertig();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(false);
  }

  const vollstaendig =
    form.name.trim().length > 0 &&
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    form.discordChannelId.length > 0 &&
    form.categoryIds.length > 0;

  return (
    <form
      className="space-y-5"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        void speichern();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="panel-name">Interner Name</Label>
        <Input
          id="panel-name"
          value={form.name}
          onChange={(ereignis) => setze('name', ereignis.target.value)}
          maxLength={100}
          required
          placeholder="Support-Panel #support"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="panel-kanal">Kanal</Label>
        <ChannelSelect
          id="panel-kanal"
          value={form.discordChannelId}
          channels={channels}
          onChange={(naechste) => setze('discordChannelId', naechste ?? '')}
          placeholder="Kanal wählen"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="panel-titel">Titel</Label>
        <Input
          id="panel-titel"
          value={form.title}
          onChange={(ereignis) => setze('title', ereignis.target.value)}
          maxLength={256}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="panel-text">Text</Label>
        <Textarea
          id="panel-text"
          value={form.description}
          onChange={(ereignis) => setze('description', ereignis.target.value)}
          maxLength={4000}
          rows={4}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="panel-banner">Banner-Adresse</Label>
          <Input
            id="panel-banner"
            type="url"
            value={form.bannerUrl}
            onChange={(ereignis) => setze('bannerUrl', ereignis.target.value)}
            maxLength={500}
            placeholder="https://…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="panel-thumb">Vorschaubild-Adresse</Label>
          <Input
            id="panel-thumb"
            type="url"
            value={form.thumbnailUrl}
            onChange={(ereignis) => setze('thumbnailUrl', ereignis.target.value)}
            maxLength={500}
            placeholder="https://…"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="panel-fuss">Fusszeile</Label>
        <Input
          id="panel-fuss"
          value={form.footerText}
          onChange={(ereignis) => setze('footerText', ereignis.target.value)}
          maxLength={2048}
        />
      </div>

      <div className="space-y-2">
        <Label>Kategorien</Label>
        <MultiSelect
          options={kategorien.map((kategorie) => ({
            id: kategorie.id,
            label: kategorie.name,
            hint: kategorie.active ? undefined : 'inaktiv',
            disabled: !kategorie.active,
          }))}
          selected={form.categoryIds}
          onChange={(naechste) => setze('categoryIds', naechste)}
          searchPlaceholder="Kategorie suchen …"
          emptyLabel="Noch keine Kategorie angelegt."
        />
        <p className="text-xs text-muted-foreground">
          Je Kategorie entsteht ein Knopf. Bei genau einer Kategorie trägt der Knopf die
          Beschriftung unten.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="panel-knopf">Beschriftung des Knopfes</Label>
          <Input
            id="panel-knopf"
            value={form.buttonLabel}
            onChange={(ereignis) => setze('buttonLabel', ereignis.target.value)}
            maxLength={80}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="panel-knopf-emoji">Emoji</Label>
          <Input
            id="panel-knopf-emoji"
            value={form.buttonEmoji}
            onChange={(ereignis) => setze('buttonEmoji', ereignis.target.value)}
            maxLength={8}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
        <div>
          <Label htmlFor="panel-aktiv">Aktiv</Label>
          <p className="text-xs text-muted-foreground">
            Inaktive Panels werden beim Abgleich nicht mehr nachgeführt.
          </p>
        </div>
        <Switch
          id="panel-aktiv"
          checked={form.active}
          onCheckedChange={(naechste) => setze('active', naechste)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onFertig} disabled={laeuft}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={laeuft || !vollstaendig}>
          {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Speichern
        </Button>
      </div>
    </form>
  );
}
