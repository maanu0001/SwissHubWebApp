'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { MultiSelect } from '@/modules/configuration/components/multi-select';
import type {
  ChannelOption,
  RoleOption,
} from '@/modules/configuration/components/discord-option-types';
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from '@/modules/tickets/admin-actions';

/** Vier eigene Fragen: das fünfte Modal-Feld ist der Betreff. Wie auf dem Server. */
const MAX_FELDER = 4;

export interface KategorieWerte {
  categoryId?: string;
  name: string;
  description: string;
  emoji: string;
  active: boolean;
  sortOrder: number;
  discordCategoryId: string;
  overflowCategoryId: string;
  supportRoleIds: string[];
  pingSupport: boolean;
  defaultPriority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  channelNameTemplate: string;
  welcomeMessage: string;
  closeMessage: string;
  maxOpenPerUser: number;
  userCanClose: boolean;
  reminderAfterDays: number;
  autoCloseAfterDays: number;
  responseTargetHours: number;
  resolutionTargetHours: number;
  sensitive: boolean;
  formFields: Array<{
    kind: 'SHORT_TEXT' | 'LONG_TEXT';
    label: string;
    placeholder: string;
    required: boolean;
    minLength: number | null;
    maxLength: number | null;
  }>;
}

export const LEERE_KATEGORIE: KategorieWerte = {
  name: '',
  description: '',
  emoji: '',
  active: true,
  sortOrder: 0,
  discordCategoryId: '',
  overflowCategoryId: '',
  supportRoleIds: [],
  pingSupport: false,
  defaultPriority: 'NORMAL',
  channelNameTemplate: 'ticket-{number}-{username}',
  welcomeMessage: '',
  closeMessage: '',
  maxOpenPerUser: 0,
  userCanClose: true,
  reminderAfterDays: 0,
  autoCloseAfterDays: 0,
  responseTargetHours: 0,
  resolutionTargetHours: 0,
  sensitive: false,
  formFields: [],
};

/**
 * Eine Ticket-Kategorie bearbeiten.
 *
 * Die Felder des Eroeffnungsformulars stehen mit in derselben Maske. Sie
 * gehoeren zur Kategorie: was gefragt wird, haengt daran, worum es geht, und
 * eine zweite Maske dafuer waere ein zweiter Ort, an dem man es vergisst.
 */
export function CategoryEditor({
  csrfToken,
  werte,
  roles,
  channels,
  onFertig,
  ticketAnzahl = 0,
}: {
  csrfToken: string;
  werte: KategorieWerte;
  roles: RoleOption[];
  channels: ChannelOption[];
  onFertig(): void;
  ticketAnzahl?: number;
}): React.JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<KategorieWerte>(werte);
  const [laeuft, setLaeuft] = useState(false);
  const [loeschDialog, setLoeschDialog] = useState(false);

  const kategorien = channels.filter((kanal) => kanal.kind === 'category');

  function setze<K extends keyof KategorieWerte>(schluessel: K, wert: KategorieWerte[K]): void {
    setForm((vorher) => ({ ...vorher, [schluessel]: wert }));
  }

  async function speichern(): Promise<void> {
    setLaeuft(true);
    const nutzlast = {
      csrfToken,
      name: form.name.trim(),
      description: form.description.trim() || null,
      emoji: form.emoji.trim() || null,
      active: form.active,
      sortOrder: form.sortOrder,
      discordCategoryId: form.discordCategoryId || null,
      overflowCategoryId: form.overflowCategoryId || null,
      supportRoleIds: form.supportRoleIds,
      pingSupport: form.pingSupport,
      defaultPriority: form.defaultPriority,
      channelNameTemplate: form.channelNameTemplate.trim() || 'ticket-{number}-{username}',
      welcomeMessage: form.welcomeMessage.trim() || null,
      closeMessage: form.closeMessage.trim() || null,
      maxOpenPerUser: form.maxOpenPerUser,
      userCanClose: form.userCanClose,
      reminderAfterDays: form.reminderAfterDays,
      autoCloseAfterDays: form.autoCloseAfterDays,
      responseTargetHours: form.responseTargetHours,
      resolutionTargetHours: form.resolutionTargetHours,
      sensitive: form.sensitive,
      formFields: form.formFields.map((feld) => ({
        kind: feld.kind,
        label: feld.label.trim(),
        placeholder: feld.placeholder.trim() || null,
        required: feld.required,
        minLength: feld.minLength,
        maxLength: feld.maxLength,
      })),
    };

    const antwort = form.categoryId
      ? await updateCategoryAction({ ...nutzlast, categoryId: form.categoryId })
      : await createCategoryAction(nutzlast);

    if (antwort.ok) {
      toast.success(form.categoryId ? 'Kategorie gespeichert.' : 'Kategorie angelegt.');
      router.refresh();
      onFertig();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(false);
  }

  async function loeschen(): Promise<void> {
    if (!form.categoryId) {
      return;
    }
    const antwort = await deleteCategoryAction({ csrfToken, categoryId: form.categoryId });
    if (antwort.ok) {
      toast.success('Kategorie entfernt.');
      router.refresh();
      onFertig();
    } else {
      toast.error(antwort.error.message);
      throw new Error(antwort.error.message);
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        void speichern();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="kat-name">Name</Label>
          <Input
            id="kat-name"
            value={form.name}
            onChange={(ereignis) => setze('name', ereignis.target.value)}
            maxLength={100}
            required
            placeholder="Allgemeine Frage"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kat-emoji">Emoji</Label>
          <Input
            id="kat-emoji"
            value={form.emoji}
            onChange={(ereignis) => setze('emoji', ereignis.target.value)}
            maxLength={8}
            placeholder="❓"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="kat-beschreibung">Beschreibung</Label>
        <Input
          id="kat-beschreibung"
          value={form.description}
          onChange={(ereignis) => setze('description', ereignis.target.value)}
          maxLength={500}
          placeholder="Steht unter dem Knopf im Panel."
        />
      </div>

      <fieldset className="space-y-4 rounded-xl border border-border/60 p-4">
        <legend className="px-2 text-sm font-semibold">Discord</legend>

        <div className="space-y-2">
          <Label htmlFor="kat-discord-kategorie">Kanal-Kategorie</Label>
          <ChannelSelect
            id="kat-discord-kategorie"
            value={form.discordCategoryId}
            channels={kategorien}
            onChange={(naechste) => setze('discordCategoryId', naechste ?? '')}
            placeholder="Vorgabe aus den Moduleinstellungen"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="kat-overflow">Ausweich-Kategorie</Label>
          <ChannelSelect
            id="kat-overflow"
            value={form.overflowCategoryId}
            channels={kategorien}
            onChange={(naechste) => setze('overflowCategoryId', naechste ?? '')}
            placeholder="Keine"
          />
          <p className="text-xs text-muted-foreground">
            Discord erlaubt 50 Kanäle je Kategorie. Ist die erste voll, entstehen die Kanäle hier.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Zuständige Rollen</Label>
          <MultiSelect
            options={roles.map((rolle) => ({ id: rolle.id, label: rolle.name }))}
            selected={form.supportRoleIds}
            onChange={(naechste) => setze('supportRoleIds', naechste)}
            searchPlaceholder="Rolle suchen …"
          />
          <p className="text-xs text-muted-foreground">
            Nur diese Rollen sehen Tickets dieser Kategorie. Ohne Auswahl greifen die
            Standard-Support-Rollen aus den Moduleinstellungen.
          </p>
        </div>

        <Schalter
          id="kat-ping"
          label="Support beim Eröffnen erwähnen"
          beschreibung="Erwähnt die zuständigen Rollen in der Eröffnungsnachricht."
          checked={form.pingSupport}
          onChange={(naechste) => setze('pingSupport', naechste)}
        />

        <div className="space-y-2">
          <Label htmlFor="kat-vorlage">Vorlage des Kanalnamens</Label>
          <Input
            id="kat-vorlage"
            value={form.channelNameTemplate}
            onChange={(ereignis) => setze('channelNameTemplate', ereignis.target.value)}
            maxLength={64}
          />
          <p className="text-xs text-muted-foreground">
            Platzhalter: {'{number}'}, {'{username}'}, {'{category}'}.
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-border/60 p-4">
        <legend className="px-2 text-sm font-semibold">Verhalten</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="kat-prio">Priorität beim Eröffnen</Label>
            <Select
              value={form.defaultPriority}
              onValueChange={(naechste) =>
                setze('defaultPriority', naechste as KategorieWerte['defaultPriority'])
              }
            >
              <SelectTrigger id="kat-prio">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Niedrig</SelectItem>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="HIGH">Hoch</SelectItem>
                <SelectItem value="URGENT">Dringend</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Zahl
            id="kat-max"
            label="Offene Tickets je Mitglied"
            hinweis="0 = die globale Grenze gilt."
            value={form.maxOpenPerUser}
            min={0}
            max={50}
            onChange={(naechste) => setze('maxOpenPerUser', naechste)}
          />
          <Zahl
            id="kat-erinnerung"
            label="Erinnerung nach (Tagen)"
            hinweis="0 = keine Erinnerung."
            value={form.reminderAfterDays}
            min={0}
            max={365}
            onChange={(naechste) => setze('reminderAfterDays', naechste)}
          />
          <Zahl
            id="kat-autoclose"
            label="Automatisch schliessen nach (Tagen)"
            hinweis="0 = nie automatisch schliessen."
            value={form.autoCloseAfterDays}
            min={0}
            max={365}
            onChange={(naechste) => setze('autoCloseAfterDays', naechste)}
          />
          <Zahl
            id="kat-antwortziel"
            label="Antwortziel (Stunden)"
            hinweis="Nur intern - 0 = kein Ziel."
            value={form.responseTargetHours}
            min={0}
            max={720}
            onChange={(naechste) => setze('responseTargetHours', naechste)}
          />
          <Zahl
            id="kat-loesungsziel"
            label="Lösungsziel (Stunden)"
            hinweis="Nur intern - 0 = kein Ziel."
            value={form.resolutionTargetHours}
            min={0}
            max={8760}
            onChange={(naechste) => setze('resolutionTargetHours', naechste)}
          />
        </div>

        <Schalter
          id="kat-selbst-schliessen"
          label="Mitglied darf selbst schliessen"
          checked={form.userCanClose}
          onChange={(naechste) => setze('userCanClose', naechste)}
        />
        <Schalter
          id="kat-heikel"
          label="Heikle Kategorie"
          beschreibung="Für Meldungen und Moderation. Nur die zugeordneten Rollen sehen diese Tickets."
          checked={form.sensitive}
          onChange={(naechste) => setze('sensitive', naechste)}
        />
        <Schalter
          id="kat-aktiv"
          label="Aktiv"
          beschreibung="Inaktive Kategorien nehmen keine neuen Tickets an, bestehende bleiben erhalten."
          checked={form.active}
          onChange={(naechste) => setze('active', naechste)}
        />
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-border/60 p-4">
        <legend className="px-2 text-sm font-semibold">Nachrichten</legend>
        <div className="space-y-2">
          <Label htmlFor="kat-willkommen">Eröffnungstext</Label>
          <Textarea
            id="kat-willkommen"
            value={form.welcomeMessage}
            onChange={(ereignis) => setze('welcomeMessage', ereignis.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Steht in der ersten Nachricht im Ticket-Kanal."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="kat-abschluss">Abschlusstext</Label>
          <Textarea
            id="kat-abschluss"
            value={form.closeMessage}
            onChange={(ereignis) => setze('closeMessage', ereignis.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Steht in der Nachricht beim Schliessen."
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
        <legend className="px-2 text-sm font-semibold">Fragen beim Eröffnen</legend>
        <p className="text-xs text-muted-foreground">
          Discord erlaubt höchstens {MAX_FELDER} eigene Fragen - das fünfte Feld im Modal ist der
          Betreff. Ohne eigene Fragen wird nur nach dem Anliegen gefragt.
        </p>

        {form.formFields.map((feld, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor={`feld-label-${index}`}>Frage</Label>
                <Input
                  id={`feld-label-${index}`}
                  value={feld.label}
                  onChange={(ereignis) =>
                    setze(
                      'formFields',
                      form.formFields.map((eintrag, i) =>
                        i === index ? { ...eintrag, label: ereignis.target.value } : eintrag,
                      ),
                    )
                  }
                  maxLength={45}
                  required
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-7"
                aria-label={`Frage ${index + 1} entfernen`}
                onClick={() =>
                  setze(
                    'formFields',
                    form.formFields.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`feld-art-${index}`}>Art</Label>
                <Select
                  value={feld.kind}
                  onValueChange={(naechste) =>
                    setze(
                      'formFields',
                      form.formFields.map((eintrag, i) =>
                        i === index
                          ? { ...eintrag, kind: naechste as 'SHORT_TEXT' | 'LONG_TEXT' }
                          : eintrag,
                      ),
                    )
                  }
                >
                  <SelectTrigger id={`feld-art-${index}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SHORT_TEXT">Eine Zeile</SelectItem>
                    <SelectItem value="LONG_TEXT">Mehrere Zeilen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`feld-platzhalter-${index}`}>Platzhalter</Label>
                <Input
                  id={`feld-platzhalter-${index}`}
                  value={feld.placeholder}
                  onChange={(ereignis) =>
                    setze(
                      'formFields',
                      form.formFields.map((eintrag, i) =>
                        i === index ? { ...eintrag, placeholder: ereignis.target.value } : eintrag,
                      ),
                    )
                  }
                  maxLength={100}
                />
              </div>
            </div>

            <Schalter
              id={`feld-pflicht-${index}`}
              label="Pflichtfeld"
              checked={feld.required}
              onChange={(naechste) =>
                setze(
                  'formFields',
                  form.formFields.map((eintrag, i) =>
                    i === index ? { ...eintrag, required: naechste } : eintrag,
                  ),
                )
              }
            />
          </div>
        ))}

        {form.formFields.length < MAX_FELDER ? (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setze('formFields', [
                ...form.formFields,
                {
                  kind: 'SHORT_TEXT',
                  label: '',
                  placeholder: '',
                  required: false,
                  minLength: null,
                  maxLength: null,
                },
              ])
            }
          >
            <Plus aria-hidden="true" />
            Frage hinzufügen
          </Button>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {form.categoryId ? (
          <Button
            type="button"
            variant="outline"
            disabled={laeuft || ticketAnzahl > 0}
            onClick={() => setLoeschDialog(true)}
            title={
              ticketAnzahl > 0
                ? `An dieser Kategorie hängen ${ticketAnzahl} Tickets - schalte sie stattdessen inaktiv.`
                : undefined
            }
          >
            <Trash2 aria-hidden="true" />
            Entfernen
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onFertig} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={laeuft || form.name.trim().length === 0}>
            {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Speichern
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        open={loeschDialog}
        onOpenChange={setLoeschDialog}
        destructive
        title="Kategorie entfernen?"
        description="Sie verschwindet aus allen Panels und aus dem Eröffnungsformular."
        confirmLabel="Entfernen"
        onConfirm={loeschen}
      />
    </form>
  );
}

function Schalter({
  id,
  label,
  beschreibung,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  beschreibung?: string;
  checked: boolean;
  onChange(wert: boolean): void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {beschreibung ? <p className="text-xs text-muted-foreground">{beschreibung}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Zahl({
  id,
  label,
  hinweis,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hinweis?: string;
  value: number;
  min: number;
  max: number;
  onChange(wert: number): void;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(ereignis) => {
          const gelesen = Number.parseInt(ereignis.target.value, 10);
          onChange(Number.isFinite(gelesen) ? Math.min(max, Math.max(min, gelesen)) : min);
        }}
      />
      {hinweis ? <p className="text-xs text-muted-foreground">{hinweis}</p> : null}
    </div>
  );
}
