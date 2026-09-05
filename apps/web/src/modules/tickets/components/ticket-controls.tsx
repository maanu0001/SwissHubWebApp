'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Hand, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  changePriorityAction,
  changeStatusAction,
  claimAction,
  closeAction,
  reopenAction,
} from '@/modules/tickets/actions';

const STATUS_OPTIONEN = [
  { wert: 'OPEN', label: 'Offen' },
  { wert: 'IN_PROGRESS', label: 'In Bearbeitung' },
  { wert: 'WAITING_FOR_USER', label: 'Wartet auf Mitglied' },
  { wert: 'WAITING_FOR_STAFF', label: 'Wartet auf Support' },
  { wert: 'RESOLVED', label: 'Gelöst' },
] as const;

const PRIORITAET_OPTIONEN = [
  { wert: 'LOW', label: 'Niedrig' },
  { wert: 'NORMAL', label: 'Normal' },
  { wert: 'HIGH', label: 'Hoch' },
  { wert: 'URGENT', label: 'Dringend' },
] as const;

/**
 * Die Bearbeitungswerkzeuge eines Tickets.
 *
 * Was hier erscheint, entscheidet der serverseitig ermittelte Zugriff. Die
 * Aktionen pruefen ihn erneut - dieses Ausblenden ist Bequemlichkeit, keine
 * Absicherung. Ein Knopf, den man nicht sieht, ist trotzdem aufrufbar.
 */
export function TicketControls({
  ticketId,
  csrfToken,
  status,
  priority,
  zugewiesen,
  darfUebernehmen,
  darfVerwalten,
  darfSchliessen,
  darfOeffnen,
  alsSupport,
}: {
  ticketId: string;
  csrfToken: string;
  status: string;
  priority: string;
  zugewiesen: boolean;
  darfUebernehmen: boolean;
  darfVerwalten: boolean;
  darfSchliessen: boolean;
  darfOeffnen: boolean;
  alsSupport: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [grund, setGrund] = useState('');

  const geschlossen = status === 'CLOSED' || status === 'ARCHIVED';

  async function fuehreAus(
    name: string,
    arbeit: () => Promise<{ ok: boolean; fehler?: string }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(name);
    const ergebnis = await arbeit();
    if (ergebnis.ok) {
      toast.success(erfolg);
      router.refresh();
    } else {
      toast.error(ergebnis.fehler ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-4">
      {!geschlossen && darfVerwalten ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="ticket-status">Status</Label>
            <Select
              value={STATUS_OPTIONEN.some((eintrag) => eintrag.wert === status) ? status : undefined}
              disabled={laeuft !== null}
              onValueChange={(naechster) =>
                void fuehreAus(
                  'status',
                  async () => {
                    const antwort = await changeStatusAction({
                      csrfToken,
                      ticketId,
                      status: naechster,
                    });
                    return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                  },
                  'Status geändert.',
                )
              }
            >
              <SelectTrigger id="ticket-status">
                <SelectValue placeholder="Status wählen" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONEN.map((eintrag) => (
                  <SelectItem key={eintrag.wert} value={eintrag.wert}>
                    {eintrag.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ticket-prioritaet">Priorität</Label>
            <Select
              value={priority}
              disabled={laeuft !== null}
              onValueChange={(naechste) =>
                void fuehreAus(
                  'prioritaet',
                  async () => {
                    const antwort = await changePriorityAction({
                      csrfToken,
                      ticketId,
                      priority: naechste,
                    });
                    return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                  },
                  'Priorität geändert.',
                )
              }
            >
              <SelectTrigger id="ticket-prioritaet">
                <SelectValue placeholder="Priorität wählen" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITAET_OPTIONEN.map((eintrag) => (
                  <SelectItem key={eintrag.wert} value={eintrag.wert}>
                    {eintrag.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!geschlossen && darfUebernehmen && !zugewiesen ? (
          <Button
            variant="outline"
            disabled={laeuft !== null}
            onClick={() =>
              void fuehreAus(
                'claim',
                async () => {
                  const antwort = await claimAction({ csrfToken, ticketId });
                  return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                },
                'Du bearbeitest dieses Ticket.',
              )
            }
          >
            {laeuft === 'claim' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Hand aria-hidden="true" />
            )}
            Übernehmen
          </Button>
        ) : null}

        {!geschlossen && darfSchliessen ? (
          <Button variant="outline" disabled={laeuft !== null} onClick={() => setDialog(true)}>
            {laeuft === 'close' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 aria-hidden="true" />
            )}
            Ticket schliessen
          </Button>
        ) : null}

        {geschlossen && darfOeffnen ? (
          <Button
            variant="outline"
            disabled={laeuft !== null}
            onClick={() =>
              void fuehreAus(
                'reopen',
                async () => {
                  const antwort = await reopenAction({ csrfToken, ticketId });
                  return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                },
                'Ticket wieder geöffnet.',
              )
            }
          >
            {laeuft === 'reopen' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw aria-hidden="true" />
            )}
            Wieder öffnen
          </Button>
        ) : null}
      </div>

      <ConfirmationDialog
        open={dialog}
        onOpenChange={setDialog}
        title="Ticket schliessen?"
        description={
          alsSupport
            ? 'Das Mitglied kann danach nicht mehr antworten. Der Discord-Kanal bleibt je nach Einstellung noch eine Weile lesbar.'
            : 'Du kannst danach nicht mehr antworten. Das Team kann das Ticket wieder öffnen.'
        }
        confirmLabel="Jetzt schliessen"
        onConfirm={async () => {
          await fuehreAus(
            'close',
            async () => {
              const antwort = await closeAction({
                csrfToken,
                ticketId,
                ...(grund.trim().length > 0 ? { reason: grund.trim() } : {}),
              });
              return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
            },
            'Ticket geschlossen.',
          );
          setGrund('');
        }}
      >
        {alsSupport ? (
          <div className="space-y-2 text-left">
            <Label htmlFor="ticket-grund">Grund (optional)</Label>
            <Textarea
              id="ticket-grund"
              value={grund}
              onChange={(ereignis) => setGrund(ereignis.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Wird im Verlauf festgehalten."
            />
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}
