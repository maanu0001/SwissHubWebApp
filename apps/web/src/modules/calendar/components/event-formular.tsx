'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Panel } from '@/components/shared/panel';
import { createEventAction, updateEventAction } from '@/modules/calendar/actions';

/**
 * Formular fuer Anlage und Bearbeitung eines Events.
 *
 * Dieselbe Maske fuer beides - ein zweites Formular fuer das Bearbeiten
 * hiesse, jede Regel doppelt zu pflegen. Was hier geprueft wird, ist
 * Bequemlichkeit; verbindlich prueft das Schema auf dem Server.
 *
 * Die Felder unter «Ort» richten sich nach der Art: eine Adresse bei einem
 * Discord-Abend abzufragen wäre eine Frage ohne Antwort.
 */

export interface EventFormularWerte {
  eventId?: string;
  title: string;
  description: string;
  shortDescription: string;
  categoryId: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  locationKind: 'DISCORD' | 'REAL_LIFE';
  locationChannelId: string;
  locationVoiceId: string;
  locationUrl: string;
  locationName: string;
  locationAddress: string;
  bannerUrl: string;
  iconUrl: string;
  organizerDiscordIds: string[];
  contactNote: string;
  registrationEnabled: boolean;
  capacity: number;
  registrationClosesAt: string;
  waitlistEnabled: boolean;
  allowSelfCancel: boolean;
  cancelDeadlineAt: string;
  participantsPublic: boolean;
  announceOnDiscord: boolean;
  announcementChannelId: string;
  mentionRoleId: string;
  reminderMinutes: number[];
  reminderChannelId: string;
  reminderMentionRoleId: string;
  reminderMentionRegistrants: boolean;
  questions: Array<{ id?: string; label: string; hint: string; required: boolean; choices: string[] }>;
}

const VORLAUF_AUSWAHL = [
  { minuten: 10080, label: '1 Woche' },
  { minuten: 1440, label: '24 Stunden' },
  { minuten: 180, label: '3 Stunden' },
  { minuten: 60, label: '1 Stunde' },
  { minuten: 15, label: '15 Minuten' },
];

export function EventFormular({
  csrfToken,
  werte: initial,
  kategorien,
  kanaele,
  rollen,
}: {
  csrfToken: string;
  werte: EventFormularWerte;
  kategorien: Array<{ id: string; name: string }>;
  kanaele: Array<{ id: string; name: string }>;
  /** Nur Rollen, die im Modul zum Erwähnen freigegeben sind. */
  rollen: Array<{ id: string; name: string }>;
}): React.JSX.Element {
  const router = useRouter();
  const [werte, setWerte] = useState(initial);
  const [pending, setPending] = useState(false);

  const setze = <K extends keyof EventFormularWerte>(
    schluessel: K,
    wert: EventFormularWerte[K],
  ): void => setWerte((alt) => ({ ...alt, [schluessel]: wert }));

  const speichern = async (): Promise<void> => {
    setPending(true);
    try {
      const nutzlast = {
        csrfToken,
        ...werte,
        // Leere Datumsfelder sind «nicht gesetzt», nicht «null Uhr».
        endAt: werte.endAt || null,
        registrationClosesAt: werte.registrationClosesAt || null,
        cancelDeadlineAt: werte.cancelDeadlineAt || null,
        categoryId: werte.categoryId || undefined,
        questions: werte.questions.map((frage) => ({
          ...frage,
          choices: frage.choices.filter((wahl) => wahl.trim().length > 0),
        })),
      };

      const ergebnis = werte.eventId
        ? await updateEventAction({ ...nutzlast, eventId: werte.eventId })
        : await createEventAction(nutzlast);

      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(werte.eventId ? 'Event gespeichert.' : 'Event als Entwurf angelegt.');
      const slug = (ergebnis.data as { slug?: string } | undefined)?.slug;
      router.push(slug ? `/kalender/${slug}` : '/kalender/verwaltung');
    } finally {
      setPending(false);
    }
  };

  // Zwei Arten, und jede zeigt genau die Felder, die zu ihr gehoeren.
  const zeigtDiscord = werte.locationKind === 'DISCORD';
  const zeigtVorOrt = werte.locationKind === 'REAL_LIFE';

  const Auswahl = ({
    id,
    label,
    wert,
    optionen,
    onChange,
    leerText = 'Keine',
  }: {
    id: string;
    label: string;
    wert: string;
    optionen: Array<{ id: string; name: string }>;
    onChange: (wert: string) => void;
    leerText?: string;
  }): React.JSX.Element => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={wert}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
      >
        <option value="">{leerText}</option>
        {optionen.map((eintrag) => (
          <option key={eintrag.id} value={eintrag.id}>
            {eintrag.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <Panel title="Allgemein">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="title">Eventname *</Label>
            <Input
              id="title"
              value={werte.title}
              maxLength={140}
              onChange={(event) => setze('title', event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="shortDescription">Kurzbeschreibung</Label>
            <Input
              id="shortDescription"
              value={werte.shortDescription}
              maxLength={200}
              placeholder="Eine Zeile für Kachel und Discord-Ankündigung"
              onChange={(event) => setze('shortDescription', event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Beschreibung * (Markdown)</Label>
            <textarea
              id="description"
              value={werte.description}
              maxLength={8000}
              rows={6}
              onChange={(event) => setze('description', event.target.value)}
              className="w-full rounded-lg border border-border bg-background p-3 text-sm"
            />
          </div>
          <Auswahl
            id="categoryId"
            label="Kategorie"
            wert={werte.categoryId}
            optionen={kategorien}
            onChange={(wert) => setze('categoryId', wert)}
            leerText="Ohne Kategorie"
          />
          <div className="space-y-1.5">
            <Label htmlFor="timezone">Zeitzone</Label>
            <Input
              id="timezone"
              value={werte.timezone}
              onChange={(event) => setze('timezone', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="startAt">Beginn *</Label>
            <Input
              id="startAt"
              type="datetime-local"
              value={werte.startAt}
              onChange={(event) => setze('startAt', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endAt">Ende</Label>
            <Input
              id="endAt"
              type="datetime-local"
              value={werte.endAt}
              onChange={(event) => setze('endAt', event.target.value)}
            />
          </div>
          <label className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={werte.allDay}
              onCheckedChange={(wert) => setze('allDay', wert)}
              aria-label="Ganztägiges Event"
            />
            <span className="text-sm">Ganztägiges Event</span>
          </label>
        </div>
      </Panel>

      <Panel title="Ort">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="locationKind">Art</Label>
            <select
              id="locationKind"
              value={werte.locationKind}
              onChange={(event) =>
                setze('locationKind', event.target.value as EventFormularWerte['locationKind'])
              }
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
            >
              <option value="DISCORD">Auf Discord</option>
              <option value="REAL_LIFE">Im echten Leben</option>
            </select>
          </div>

          {zeigtDiscord ? (
            <>
              <Auswahl
                id="locationChannelId"
                label="Text-Kanal"
                wert={werte.locationChannelId}
                optionen={kanaele}
                onChange={(wert) => setze('locationChannelId', wert)}
              />
              <Auswahl
                id="locationVoiceId"
                label="Voice-Kanal"
                wert={werte.locationVoiceId}
                optionen={kanaele}
                onChange={(wert) => setze('locationVoiceId', wert)}
              />
            </>
          ) : null}

          {zeigtDiscord ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="locationUrl">Weiterführender Link (optional)</Label>
              <Input
                id="locationUrl"
                value={werte.locationUrl}
                placeholder="https://..."
                onChange={(event) => setze('locationUrl', event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Etwa ein Turnierbaum oder ein Stream - der Termin bleibt auf Discord.
              </p>
            </div>
          ) : null}

          {zeigtVorOrt ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="locationName">Veranstaltungsort</Label>
                <Input
                  id="locationName"
                  value={werte.locationName}
                  onChange={(event) => setze('locationName', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="locationAddress">Adresse</Label>
                <Input
                  id="locationAddress"
                  value={werte.locationAddress}
                  onChange={(event) => setze('locationAddress', event.target.value)}
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="bannerUrl">Banner (https)</Label>
            <Input
              id="bannerUrl"
              value={werte.bannerUrl}
              placeholder="https://..."
              onChange={(event) => setze('bannerUrl', event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iconUrl">Symbolbild (https)</Label>
            <Input
              id="iconUrl"
              value={werte.iconUrl}
              placeholder="https://..."
              onChange={(event) => setze('iconUrl', event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="contactNote">Ansprechpartner</Label>
            <Input
              id="contactNote"
              value={werte.contactNote}
              maxLength={200}
              onChange={(event) => setze('contactNote', event.target.value)}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Anmeldung">
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <Switch
              checked={werte.registrationEnabled}
              onCheckedChange={(wert) => setze('registrationEnabled', wert)}
              aria-label="Anmeldung aktivieren"
            />
            <span className="text-sm">Anmeldung aktivieren</span>
          </label>

          {werte.registrationEnabled ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="capacity">Maximale Teilnehmerzahl</Label>
                <Input
                  id="capacity"
                  type="number"
                  min={0}
                  value={werte.capacity}
                  onChange={(event) => setze('capacity', Number(event.target.value))}
                />
                <p className="text-xs text-muted-foreground">0 = unbegrenzt.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="registrationClosesAt">Anmeldeschluss</Label>
                <Input
                  id="registrationClosesAt"
                  type="datetime-local"
                  value={werte.registrationClosesAt}
                  onChange={(event) => setze('registrationClosesAt', event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cancelDeadlineAt">Abmeldeschluss</Label>
                <Input
                  id="cancelDeadlineAt"
                  type="datetime-local"
                  value={werte.cancelDeadlineAt}
                  onChange={(event) => setze('cancelDeadlineAt', event.target.value)}
                />
              </div>
              <div className="space-y-3 sm:col-span-2">
                <label className="flex items-center gap-3">
                  <Switch
                    checked={werte.waitlistEnabled}
                    onCheckedChange={(wert) => setze('waitlistEnabled', wert)}
                    aria-label="Warteliste aktivieren"
                  />
                  <span className="text-sm">Warteliste aktivieren</span>
                </label>
                <label className="flex items-center gap-3">
                  <Switch
                    checked={werte.allowSelfCancel}
                    onCheckedChange={(wert) => setze('allowSelfCancel', wert)}
                    aria-label="Abmeldung erlauben"
                  />
                  <span className="text-sm">Abmeldung erlauben</span>
                </label>
                <label className="flex items-center gap-3">
                  <Switch
                    checked={werte.participantsPublic}
                    onCheckedChange={(wert) => setze('participantsPublic', wert)}
                    aria-label="Teilnehmerliste öffentlich"
                  />
                  <span className="text-sm">
                    Teilnehmerliste für alle Mitglieder sichtbar
                    <span className="block text-xs text-muted-foreground">
                      Aus: nur Organisation und Verwaltung sehen sie.
                    </span>
                  </span>
                </label>
              </div>

              <div className="space-y-3 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Zusatzfragen</Label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setze('questions', [
                        ...werte.questions,
                        { label: '', hint: '', required: false, choices: [] },
                      ])
                    }
                  >
                    <Plus aria-hidden="true" />
                    Frage
                  </Button>
                </div>
                {werte.questions.map((frage, index) => (
                  <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex gap-2">
                      <Input
                        value={frage.label}
                        placeholder="Frage, z.B. Ingame-Name"
                        aria-label={`Frage ${index + 1}`}
                        onChange={(event) =>
                          setze(
                            'questions',
                            werte.questions.map((eintrag, i) =>
                              i === index ? { ...eintrag, label: event.target.value } : eintrag,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Frage ${index + 1} entfernen`}
                        onClick={() =>
                          setze(
                            'questions',
                            werte.questions.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <Input
                      value={frage.choices.join(', ')}
                      placeholder="Auswahl, mit Komma getrennt - leer für Freitext"
                      aria-label={`Auswahl für Frage ${index + 1}`}
                      onChange={(event) =>
                        setze(
                          'questions',
                          werte.questions.map((eintrag, i) =>
                            i === index
                              ? {
                                  ...eintrag,
                                  choices: event.target.value.split(',').map((wahl) => wahl.trim()),
                                }
                              : eintrag,
                          ),
                        )
                      }
                    />
                    <label className="flex items-center gap-3">
                      <Switch
                        checked={frage.required}
                        onCheckedChange={(wert) =>
                          setze(
                            'questions',
                            werte.questions.map((eintrag, i) =>
                              i === index ? { ...eintrag, required: wert } : eintrag,
                            ),
                          )
                        }
                        aria-label={`Frage ${index + 1} ist Pflicht`}
                      />
                      <span className="text-sm">Pflichtfeld</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Discord"
        description="Ankündigung und Erinnerungen. Erwähnt werden nur Rollen, die in den Moduleinstellungen freigegeben sind."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-3 sm:col-span-2">
            <Switch
              checked={werte.announceOnDiscord}
              onCheckedChange={(wert) => setze('announceOnDiscord', wert)}
              aria-label="Auf Discord ankündigen"
            />
            <span className="text-sm">Auf Discord ankündigen</span>
          </label>

          {werte.announceOnDiscord ? (
            <>
              <Auswahl
                id="announcementChannelId"
                label="Ankündigungs-Kanal"
                wert={werte.announcementChannelId}
                optionen={kanaele}
                onChange={(wert) => setze('announcementChannelId', wert)}
              />
              <Auswahl
                id="mentionRoleId"
                label="Rolle erwähnen"
                wert={werte.mentionRoleId}
                optionen={rollen}
                onChange={(wert) => setze('mentionRoleId', wert)}
                leerText="Niemanden erwähnen"
              />
              {/*
                Eine leere Auswahl sieht aus wie ein kaputtes Feld. Sie ist
                aber ein Zustand mit einer Ursache: es wurde noch keine Rolle
                zum Erwähnen freigegeben, und ohne Freigabe pingt der Kalender
                bewusst niemanden. Das gehört hierhin, nicht in eine
                Fehlermeldung nach dem Speichern.
              */}
              {rollen.length === 0 ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  Es ist noch keine Rolle zum Erwähnen freigegeben. Unter{' '}
                  <Link href="/modules/calendar" className="underline">
                    Modul-Einstellungen
                  </Link>{' '}
                  lässt sich festlegen, welche Rollen der Kalender pingen darf.
                </p>
              ) : null}
            </>
          ) : null}

          <div className="space-y-2 sm:col-span-2">
            <Label>Erinnerungen</Label>
            <div className="flex flex-wrap gap-2">
              {VORLAUF_AUSWAHL.map((eintrag) => {
                const an = werte.reminderMinutes.includes(eintrag.minuten);
                return (
                  <button
                    key={eintrag.minuten}
                    type="button"
                    aria-pressed={an}
                    onClick={() =>
                      setze(
                        'reminderMinutes',
                        an
                          ? werte.reminderMinutes.filter((wert) => wert !== eintrag.minuten)
                          : [...werte.reminderMinutes, eintrag.minuten],
                      )
                    }
                    className={
                      an
                        ? 'min-h-9 rounded-lg border border-primary/40 bg-primary/10 px-3 text-sm text-primary'
                        : 'min-h-9 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:bg-muted'
                    }
                  >
                    {eintrag.label} vorher
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Erinnerungen werden dauerhaft gespeichert und überstehen einen Neustart.
            </p>
          </div>

          {werte.reminderMinutes.length > 0 ? (
            <>
              <Auswahl
                id="reminderChannelId"
                label="Erinnerungs-Kanal"
                wert={werte.reminderChannelId}
                optionen={kanaele}
                onChange={(wert) => setze('reminderChannelId', wert)}
                leerText="Wie Ankündigung"
              />
              <Auswahl
                id="reminderMentionRoleId"
                label="Rolle erwähnen"
                wert={werte.reminderMentionRoleId}
                optionen={rollen}
                onChange={(wert) => setze('reminderMentionRoleId', wert)}
                leerText="Niemanden erwähnen"
              />
              <label className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  checked={werte.reminderMentionRegistrants}
                  onCheckedChange={(wert) => setze('reminderMentionRegistrants', wert)}
                  aria-label="Nur angemeldete Teilnehmer erwähnen"
                />
                <span className="text-sm">Angemeldete Teilnehmer erwähnen</span>
              </label>
            </>
          ) : null}
        </div>
      </Panel>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>
          Abbrechen
        </Button>
        <Button onClick={() => void speichern()} disabled={pending}>
          <Save aria-hidden="true" />
          {werte.eventId ? 'Speichern' : 'Als Entwurf anlegen'}
        </Button>
      </div>
    </div>
  );
}
