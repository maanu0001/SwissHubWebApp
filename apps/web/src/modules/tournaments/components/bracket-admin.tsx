'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Dices, Loader2, Shuffle, Trash2, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import {
  discardBracketAction,
  generateBracketAction,
  generateKnockoutAction,
  nextSwissRoundAction,
} from '@/modules/tournaments/admin-actions';

export interface SetzlistenEintrag {
  participantId: string;
  label: string;
  seed: number | null;
}

/**
 * Setzliste und Bracket erzeugen.
 *
 * Die Reihenfolge lässt sich hier von Hand ordnen - bei manueller Setzung ist
 * sie die Setzliste, sonst nur eine Vorschau dessen, wer antritt. Was zählt,
 * entscheidet der Server anhand der Turniereinstellung.
 *
 * Das Verwerfen ist bewusst getrennt und mit Rückfrage: ein Bracket zu
 * verwerfen, in dem schon gespielt wurde, wirft die Resultate mit weg - der
 * Server lehnt das ab, aber die Rückfrage ist trotzdem am Platz.
 */
export function BracketAdmin({
  tournamentId,
  csrfToken,
  antretende,
  hatBracket,
  manuelleSetzung,
  format,
  darfVerwalten,
  gruppenFertig,
  swissOffen,
}: {
  tournamentId: string;
  csrfToken: string;
  antretende: SetzlistenEintrag[];
  hatBracket: boolean;
  manuelleSetzung: boolean;
  format: string;
  darfVerwalten: boolean;
  /** Alle Gruppenspiele entschieden? Erst dann lohnt die Endrunde. */
  gruppenFertig: boolean;
  /** Läuft ein Schweizer System, in dem noch eine Runde fehlt? */
  swissOffen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [reihenfolge, setReihenfolge] = useState(antretende);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [verwerfenOffen, setVerwerfenOffen] = useState(false);

  function verschiebe(index: number, richtung: -1 | 1): void {
    const ziel = index + richtung;
    if (ziel < 0 || ziel >= reihenfolge.length) {
      return;
    }
    const kopie = [...reihenfolge];
    const [eintrag] = kopie.splice(index, 1);
    kopie.splice(ziel, 0, eintrag!);
    setReihenfolge(kopie);
  }

  async function fuehreAus(
    name: string,
    arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(name);
    const antwort = await arbeit();
    if (antwort.ok) {
      toast.success(erfolg);
      router.refresh();
    } else {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  if (antretende.length === 0 && !hatBracket) {
    return (
      <EmptyState
        title="Noch tritt niemand an"
        description="Ein Bracket entsteht aus den Antretenden - bestätigt und, wenn verlangt, eingecheckt."
      />
    );
  }

  return (
    <div className="space-y-6">
      {darfVerwalten ? (
        <div className="flex flex-wrap gap-2">
          {!hatBracket ? (
            <Button
              disabled={laeuft !== null || antretende.length < 2}
              onClick={() =>
                fuehreAus(
                  'generate',
                  () =>
                    generateBracketAction({
                      csrfToken,
                      tournamentId,
                      ...(manuelleSetzung
                        ? { setzliste: reihenfolge.map((eintrag) => eintrag.participantId) }
                        : {}),
                    }),
                  'Bracket erzeugt.',
                )
              }
            >
              {laeuft === 'generate' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Dices aria-hidden="true" />
              )}
              Bracket erzeugen
            </Button>
          ) : null}

          {hatBracket && format === 'GROUPS_THEN_ELIMINATION' && gruppenFertig ? (
            <Button
              disabled={laeuft !== null}
              onClick={() =>
                fuehreAus(
                  'knockout',
                  () => generateKnockoutAction({ csrfToken, tournamentId }),
                  'Endrunde erzeugt.',
                )
              }
            >
              {laeuft === 'knockout' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Trophy aria-hidden="true" />
              )}
              Endrunde aus den Gruppen
            </Button>
          ) : null}

          {hatBracket && format === 'SWISS' && swissOffen ? (
            <Button
              disabled={laeuft !== null}
              onClick={() =>
                fuehreAus(
                  'swiss',
                  () => nextSwissRoundAction({ csrfToken, tournamentId }),
                  'Nächste Runde ausgelost.',
                )
              }
            >
              {laeuft === 'swiss' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Shuffle aria-hidden="true" />
              )}
              Nächste Runde auslosen
            </Button>
          ) : null}

          {hatBracket ? (
            <Button
              variant="outline"
              className="text-destructive"
              disabled={laeuft !== null}
              onClick={() => setVerwerfenOffen(true)}
            >
              <Trash2 aria-hidden="true" />
              Bracket verwerfen
            </Button>
          ) : null}
        </div>
      ) : null}

      {!hatBracket && antretende.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            {manuelleSetzung ? 'Setzliste' : 'Wer antritt'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {manuelleSetzung
              ? 'Die Reihenfolge hier wird die Setzliste. Setzplatz 1 trifft im Bracket auf den letzten.'
              : 'Die Setzliste entsteht beim Erzeugen nach der eingestellten Regel.'}
          </p>
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {reihenfolge.map((eintrag, index) => (
              <li
                key={eintrag.participantId}
                className="flex items-center gap-3 px-4 py-2.5 text-sm"
              >
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{eintrag.label}</span>
                {manuelleSetzung && darfVerwalten ? (
                  <span className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={index === 0}
                      onClick={() => verschiebe(index, -1)}
                      aria-label={`${eintrag.label} nach oben`}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={index === reihenfolge.length - 1}
                      onClick={() => verschiebe(index, 1)}
                      aria-label={`${eintrag.label} nach unten`}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <ConfirmationDialog
        open={verwerfenOffen}
        onOpenChange={setVerwerfenOffen}
        title="Bracket verwerfen?"
        description="Alle Matches dieses Turniers werden gelöscht und die Setzliste zurückgesetzt. Sobald ein Resultat feststeht, lehnt der Server das ab."
        confirmLabel="Verwerfen"
        destructive
        onConfirm={async () => {
          const antwort = await discardBracketAction({ csrfToken, tournamentId });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Bracket verworfen.');
          router.refresh();
        }}
      />
    </div>
  );
}

export interface TabellenAnsicht {
  groupId: string;
  name: string;
  zeilen: Array<{
    label: string;
    gespielt: number;
    siege: number;
    unentschieden: number;
    niederlagen: number;
    punkte: number;
    differenz: number;
  }>;
}

/**
 * Die Tabellen der Gruppenphase.
 *
 * Gerechnet, nicht gespeichert - eine mitgeführte Tabelle geht auseinander,
 * sobald die Leitung ein Resultat korrigiert.
 */
export function GruppenTabellen({ tabellen }: { tabellen: TabellenAnsicht[] }): React.JSX.Element | null {
  if (tabellen.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {tabellen.map((tabelle) => (
        <section key={tabelle.groupId} className="space-y-2">
          <h3 className="text-sm font-semibold">{tabelle.name}</h3>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Team
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Sp
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    S
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    U
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    N
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Diff
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Pkt
                  </th>
                </tr>
              </thead>
              <tbody>
                {tabelle.zeilen.map((zeile, index) => (
                  <tr key={zeile.label} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      {zeile.label}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{zeile.gespielt}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{zeile.siege}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{zeile.unentschieden}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{zeile.niederlagen}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {zeile.differenz > 0 ? `+${zeile.differenz}` : zeile.differenz}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {zeile.punkte}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
