'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { createTicketAction } from '@/modules/tickets/actions';
import { cn } from '@/lib/utils';

export interface KategorieFuerFormular {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  formFields: Array<{
    id: string;
    kind: string;
    label: string;
    placeholder: string | null;
    required: boolean;
    minLength: number | null;
    maxLength: number | null;
  }>;
}

/**
 * Ein Ticket ueber das Dashboard eroeffnen.
 *
 * Die Felder kommen aus der gewaehlten Kategorie. Was hier eingegeben wird,
 * prueft der Server anhand derselben Kategorie noch einmal - dieses Formular
 * ist die bequeme Fassung, nicht die verbindliche.
 */
export function CreateTicketForm({
  csrfToken,
  kategorien,
  darfFuerAndere = false,
}: {
  csrfToken: string;
  kategorien: KategorieFuerFormular[];
  /** Im Namen eines Mitglieds eröffnen - eigene, kritische Berechtigung. */
  darfFuerAndere?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [kategorieId, setKategorieId] = useState<string | null>(
    kategorien.length === 1 ? kategorien[0]!.id : null,
  );
  const [betreff, setBetreff] = useState('');
  const [antworten, setAntworten] = useState<Record<string, string>>({});
  const [laeuft, setLaeuft] = useState(false);
  const [fuerWen, setFuerWen] = useState<PickedMember | null>(null);

  const kategorie = useMemo(
    () => kategorien.find((eintrag) => eintrag.id === kategorieId) ?? null,
    [kategorien, kategorieId],
  );

  // Ohne eigene Felder wird nach dem Anliegen gefragt - ein Ticket ohne
  // jeden Text waere fuer das Team wertlos.
  const felder =
    kategorie && kategorie.formFields.length > 0
      ? kategorie.formFields
      : [
          {
            id: '__anliegen__',
            kind: 'LONG_TEXT',
            label: 'Dein Anliegen',
            placeholder: 'Beschreibe möglichst genau, worum es geht.',
            required: true,
            minLength: null,
            maxLength: 4000,
          },
        ];

  async function absenden(): Promise<void> {
    if (!kategorie) {
      return;
    }
    setLaeuft(true);
    const antwort = await createTicketAction({
      csrfToken,
      categoryId: kategorie.id,
      subject: betreff.trim(),
      answers: felder.map((feld) => antworten[feld.id] ?? ''),
      ...(fuerWen ? { forDiscordId: fuerWen.discordId, forUsername: fuerWen.username } : {}),
    });
    if (antwort.ok) {
      toast.success(`Ticket #${String(antwort.data.ticketNumber).padStart(4, '0')} eröffnet.`);
      router.push(`/tickets/${antwort.data.ticketId}`);
    } else {
      toast.error(antwort.error.message);
      setLaeuft(false);
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        void absenden();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Worum geht es?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {kategorien.map((eintrag) => (
            <button
              key={eintrag.id}
              type="button"
              onClick={() => {
                setKategorieId(eintrag.id);
                setAntworten({});
              }}
              aria-pressed={kategorieId === eintrag.id}
              className={cn(
                'rounded-xl border px-4 py-3 text-left transition-colors',
                kategorieId === eintrag.id
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border hover:border-primary/40 hover:bg-card/70',
              )}
            >
              <span className="block font-medium">
                {eintrag.emoji ? `${eintrag.emoji} ` : ''}
                {eintrag.name}
              </span>
              {eintrag.description ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{eintrag.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      </fieldset>

      {kategorie ? (
        <>
          {darfFuerAndere ? (
            <div className="space-y-2 rounded-xl border border-border/60 p-4">
              <MemberPicker
                csrfToken={csrfToken}
                value={fuerWen}
                onChange={setFuerWen}
                label="Im Namen von (leer = für dich selbst)"
              />
              <p className="text-xs text-muted-foreground">
                Das Ticket erscheint im Archiv als von der Verwaltung angelegt - nicht so, als hätte das
                Mitglied es selbst eröffnet.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="ticket-betreff">Betreff</Label>
            <Input
              id="ticket-betreff"
              value={betreff}
              onChange={(ereignis) => setBetreff(ereignis.target.value)}
              minLength={3}
              maxLength={200}
              required
              placeholder="Kurz in einem Satz."
              disabled={laeuft}
            />
          </div>

          {felder.map((feld) => (
            <div key={feld.id} className="space-y-2">
              <Label htmlFor={`feld-${feld.id}`}>
                {feld.label}
                {feld.required ? <span className="ml-1 text-destructive">*</span> : null}
              </Label>
              {feld.kind === 'LONG_TEXT' ? (
                <Textarea
                  id={`feld-${feld.id}`}
                  value={antworten[feld.id] ?? ''}
                  onChange={(ereignis) =>
                    setAntworten((vorher) => ({ ...vorher, [feld.id]: ereignis.target.value }))
                  }
                  rows={5}
                  required={feld.required}
                  minLength={feld.minLength ?? undefined}
                  maxLength={feld.maxLength ?? 4000}
                  placeholder={feld.placeholder ?? ''}
                  disabled={laeuft}
                />
              ) : (
                <Input
                  id={`feld-${feld.id}`}
                  value={antworten[feld.id] ?? ''}
                  onChange={(ereignis) =>
                    setAntworten((vorher) => ({ ...vorher, [feld.id]: ereignis.target.value }))
                  }
                  required={feld.required}
                  minLength={feld.minLength ?? undefined}
                  maxLength={feld.maxLength ?? 200}
                  placeholder={feld.placeholder ?? ''}
                  disabled={laeuft}
                />
              )}
            </div>
          ))}

          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={laeuft || betreff.trim().length < 3}>
              {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Ticket eröffnen
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Wähle zuerst aus, worum es geht. Danach erscheinen die passenden Fragen.
        </p>
      )}
    </form>
  );
}
