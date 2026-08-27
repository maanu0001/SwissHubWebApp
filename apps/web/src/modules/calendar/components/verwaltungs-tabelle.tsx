'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, Copy, Megaphone, Pencil, Send, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EventStatusBadge } from './shared';
import {
  announceEventAction,
  cancelEventAction,
  deleteEventAction,
  duplicateEventAction,
  publishEventAction,
} from '@/modules/calendar/actions';

/**
 * Die Eventliste der Verwaltung.
 *
 * Ein Knopf erscheint nur, wenn er im jeweiligen Zustand etwas bewirkt:
 * einen beendeten Abend absagen zu wollen ist keine Handlung, die man
 * anbieten und dann mit einem Fehler beantworten sollte. Geprueft wird
 * trotzdem serverseitig - was hier fehlt, ist Bequemlichkeit.
 */

export interface VerwaltungsZeile {
  id: string;
  slug: string;
  title: string;
  status: 'DRAFT' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
  startAt: string;
  timezone: string;
  confirmed: number;
  waitlist: number;
  capacity: number;
  registrationEnabled: boolean;
}

export function VerwaltungsTabelle({
  csrfToken,
  zeilen,
  rechte,
}: {
  csrfToken: string;
  zeilen: VerwaltungsZeile[];
  rechte: { publish: boolean; cancel: boolean; delete: boolean; duplicate: boolean };
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [absagen, setAbsagen] = useState<VerwaltungsZeile | null>(null);
  const [absageGrund, setAbsageGrund] = useState('');
  const [benachrichtigen, setBenachrichtigen] = useState(true);
  const [loeschen, setLoeschen] = useState<VerwaltungsZeile | null>(null);
  const [loeschGrund, setLoeschGrund] = useState('');
  const [duplizieren, setDuplizieren] = useState<VerwaltungsZeile | null>(null);
  const [neuerStart, setNeuerStart] = useState('');

  const fuehreAus = async (
    schluessel: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> => {
    setPending(schluessel);
    try {
      const ergebnis = await aktion();
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        throw new Error('fehlgeschlagen');
      }
      toast.success(erfolg);
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const zeit = (zeile: VerwaltungsZeile): string =>
    new Intl.DateTimeFormat('de-CH', {
      timeZone: zeile.timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(zeile.startAt));

  return (
    <>
      <div className="space-y-2">
        {zeilen.map((zeile) => {
          const busy = pending !== null;
          const laeuftNoch = zeile.status === 'SCHEDULED' || zeile.status === 'ONGOING';
          return (
            <div
              key={zeile.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/kalender/${zeile.slug}`}
                  className="font-medium hover:underline"
                >
                  {zeile.title}
                </Link>
                <p className="text-xs text-muted-foreground">{zeit(zeile)}</p>
              </div>

              <EventStatusBadge status={zeile.status} />

              {zeile.registrationEnabled ? (
                <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                  <Users className="size-3.5" aria-hidden="true" />
                  {zeile.capacity > 0
                    ? `${zeile.confirmed}/${zeile.capacity}`
                    : zeile.confirmed}
                  {zeile.waitlist > 0 ? ` (+${zeile.waitlist})` : ''}
                </span>
              ) : null}

              <div className="flex flex-wrap gap-1">
                {zeile.status !== 'COMPLETED' && zeile.status !== 'CANCELLED' ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/kalender/${zeile.slug}/bearbeiten`} aria-label={`${zeile.title} bearbeiten`}>
                      <Pencil aria-hidden="true" />
                    </Link>
                  </Button>
                ) : null}

                {zeile.status === 'DRAFT' && rechte.publish ? (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void fuehreAus(
                        `publish-${zeile.id}`,
                        () => publishEventAction({ csrfToken, eventId: zeile.id }),
                        'Event veröffentlicht.',
                      ).catch(() => undefined)
                    }
                  >
                    <Send aria-hidden="true" />
                    Veröffentlichen
                  </Button>
                ) : null}

                {laeuftNoch && rechte.publish ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`Ankündigung für ${zeile.title} erneut senden`}
                    onClick={() =>
                      void fuehreAus(
                        `announce-${zeile.id}`,
                        () => announceEventAction({ csrfToken, eventId: zeile.id }),
                        'Ankündigung gesendet.',
                      ).catch(() => undefined)
                    }
                  >
                    <Megaphone aria-hidden="true" />
                  </Button>
                ) : null}

                {rechte.duplicate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${zeile.title} duplizieren`}
                    onClick={() => {
                      setDuplizieren(zeile);
                      setNeuerStart('');
                    }}
                  >
                    <Copy aria-hidden="true" />
                  </Button>
                ) : null}

                {laeuftNoch && rechte.cancel ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${zeile.title} absagen`}
                    onClick={() => {
                      setAbsagen(zeile);
                      setAbsageGrund('');
                      setBenachrichtigen(true);
                    }}
                  >
                    <Ban aria-hidden="true" />
                  </Button>
                ) : null}

                {rechte.delete ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${zeile.title} löschen`}
                    onClick={() => {
                      setLoeschen(zeile);
                      setLoeschGrund('');
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmationDialog
        open={absagen !== null}
        onOpenChange={(offen) => !offen && setAbsagen(null)}
        title="Event absagen?"
        description={
          absagen
            ? `${absagen.confirmed} angemeldete Person(en). Das Event bleibt erhalten und wird als abgesagt gekennzeichnet - auf der Webseite und in der Discord-Ankündigung.`
            : ''
        }
        confirmLabel="Absagen"
        destructive
        onConfirm={async () => {
          if (!absagen) {
            return;
          }
          if (absageGrund.trim().length < 5) {
            toast.error('Bitte einen Grund angeben.');
            throw new Error('Grund fehlt');
          }
          await fuehreAus(
            `cancel-${absagen.id}`,
            () =>
              cancelEventAction({
                csrfToken,
                eventId: absagen.id,
                reason: absageGrund,
                notifyParticipants: benachrichtigen,
              }),
            'Event abgesagt.',
          );
          setAbsagen(null);
        }}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="absageGrund">Grund (Pflicht)</Label>
            <Input
              id="absageGrund"
              value={absageGrund}
              maxLength={300}
              placeholder="Referent kurzfristig verhindert"
              onChange={(event) => setAbsageGrund(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-3">
            <Switch
              checked={benachrichtigen}
              onCheckedChange={setBenachrichtigen}
              aria-label="Angemeldete benachrichtigen"
            />
            <span className="text-sm">Angemeldete auf Discord benachrichtigen</span>
          </label>
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(offen) => !offen && setLoeschen(null)}
        title="Event endgültig löschen?"
        description="Das Event, seine Anmeldungen und Erinnerungen werden entfernt. Der Regelweg ist die Absage - sie erhält den Verlauf und informiert die Angemeldeten."
        confirmLabel="Endgültig löschen"
        destructive
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          if (loeschGrund.trim().length < 5) {
            toast.error('Bitte einen Grund angeben.');
            throw new Error('Grund fehlt');
          }
          await fuehreAus(
            `delete-${loeschen.id}`,
            () => deleteEventAction({ csrfToken, eventId: loeschen.id, reason: loeschGrund }),
            'Event gelöscht.',
          );
          setLoeschen(null);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="loeschGrund">Grund (Pflicht)</Label>
          <Input
            id="loeschGrund"
            value={loeschGrund}
            maxLength={300}
            placeholder="Aufräumen: Testeintrag"
            onChange={(event) => setLoeschGrund(event.target.value)}
          />
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={duplizieren !== null}
        onOpenChange={(offen) => !offen && setDuplizieren(null)}
        title="Event duplizieren"
        description="Beschreibung, Ort, Kategorie, Anmeldeeinstellungen, Zusatzfragen, Erinnerungen und die Discord-Konfiguration werden übernommen. Teilnehmer nicht. Die Kopie entsteht als Entwurf."
        confirmLabel="Duplizieren"
        onConfirm={async () => {
          if (!duplizieren) {
            return;
          }
          if (!neuerStart) {
            toast.error('Bitte einen neuen Termin wählen.');
            throw new Error('Termin fehlt');
          }
          await fuehreAus(
            `duplicate-${duplizieren.id}`,
            () =>
              duplicateEventAction({
                csrfToken,
                eventId: duplizieren.id,
                startAt: neuerStart,
                timezone: duplizieren.timezone,
              }),
            'Event dupliziert.',
          );
          setDuplizieren(null);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="neuerStart">Neuer Beginn</Label>
          <Input
            id="neuerStart"
            type="datetime-local"
            value={neuerStart}
            onChange={(event) => setNeuerStart(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Zeitzone {duplizieren?.timezone}. Die Dauer der Vorlage bleibt erhalten.
          </p>
        </div>
      </ConfirmationDialog>
    </>
  );
}
