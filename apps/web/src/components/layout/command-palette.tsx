'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, Search, UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { NavIcon } from './nav-icon';
import { cn } from '@/lib/utils';
import { ausGruppen, passt } from './palette-suche';
import type { NavigationGroup } from './sidebar-nav';

/**
 * Schnellnavigation.
 *
 * SwissHub hat über dreissig Bereiche. Wer weiss, wohin er will, soll nicht
 * erst die Seitenleiste durchlesen müssen - er tippt `tick` und ist im
 * Ticketbereich.
 *
 * ## Warum das hier keine Berechtigungsprüfung enthält
 *
 * Sie bekommt dieselbe Liste, aus der die Seitenleiste entsteht - und die ist
 * bereits gefiltert. Eine zweite Prüfung hier wäre eine zweite Wahrheit über
 * dieselbe Frage, und die schlimmere Bauart wäre die naheliegende: alle
 * Bereiche laden und beim Tippen filtern. Dann stünde die vollständige
 * Modulliste im ausgelieferten Bundle jedes Mitglieds.
 *
 * Es werden auch keine Daten vorgeladen. Die Palette kennt Seiten, keine
 * Inhalte - sie fragt beim Öffnen nichts ab und beim Tippen erst recht nicht.
 *
 * ## Die Mitgliedersuche
 *
 * Sie lag vorher als eigenes Feld in der Kopfzeile und hatte `⌘K` für sich -
 * für die Hälfte der Leute also eine Tastenkombination, die nichts tat. Jetzt
 * führt sie durch dieselbe Palette, auf dieselbe Adresse wie zuvor
 * (`/members?q=…`), und nur, wer den Mitgliederbereich sehen darf, bekommt
 * sie überhaupt angeboten.
 */

export function CommandPalette({
  groups,
  canSearchMembers,
}: {
  groups: NavigationGroup[];
  canSearchMembers: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [markiert, setMarkiert] = useState(0);
  const listeRef = useRef<HTMLUListElement>(null);

  const alle = useMemo(() => ausGruppen(groups), [groups]);
  const treffer = useMemo(() => alle.filter((eintrag) => passt(eintrag, suche)).slice(0, 8), [alle, suche]);

  /** Die Mitgliedersuche steht als eigener, letzter Vorschlag. */
  const mitgliedersuche = canSearchMembers && suche.trim() !== '';
  const anzahl = treffer.length + (mitgliedersuche ? 1 : 0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOffen((vorher) => !vorher);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Bei jeder neuen Eingabe wieder oben anfangen - sonst zeigte die Markierung
  // auf einen Eintrag, den es nicht mehr gibt.
  useEffect(() => {
    setMarkiert(0);
  }, [suche]);

  useEffect(() => {
    if (!offen) {
      setSuche('');
    }
  }, [offen]);

  const gehZu = useCallback(
    (index: number) => {
      const ziel = treffer[index];
      if (ziel) {
        setOffen(false);
        router.push(ziel.href);
        return;
      }
      if (mitgliedersuche && index === treffer.length) {
        setOffen(false);
        router.push(`/members?q=${encodeURIComponent(suche.trim())}`);
      }
    },
    [treffer, mitgliedersuche, suche, router],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMarkiert((vorher) => (anzahl === 0 ? 0 : (vorher + 1) % anzahl));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMarkiert((vorher) => (anzahl === 0 ? 0 : (vorher - 1 + anzahl) % anzahl));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      gehZu(markiert);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="hidden h-9 items-center gap-2 rounded-lg border border-border/70 bg-card/50 pl-3 pr-2 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground md:flex"
        aria-label="Suchen und navigieren"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="pr-6">Suchen …</span>
        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem]">⌘K</kbd>
      </button>

      {/* Auf dem Telefon nur das Symbol - dort ist die Kopfzeile knapp. */}
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="grid size-10 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground md:hidden"
        aria-label="Suchen und navigieren"
      >
        <Search className="size-5" aria-hidden="true" />
      </button>

      <Dialog open={offen} onOpenChange={setOffen}>
        <DialogContent className="top-[15%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Suchen und navigieren</DialogTitle>

          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              value={suche}
              onChange={(event) => setSuche(event.target.value)}
              onKeyDown={onKeyDown}
              /*
                Der Dialog existiert, um sofort zu tippen - ohne Fokus wäre
                der erste Anschlag verloren. Das ist der Fall, für den
                `autoFocus` gedacht ist: ein Dialog, den man absichtlich
                geöffnet hat und der aus genau einem Eingabefeld besteht.
              */
              autoFocus
              placeholder={canSearchMembers ? 'Bereich oder Mitglied suchen …' : 'Bereich suchen …'}
              aria-label="Suchen"
              aria-autocomplete="list"
              aria-controls="palette-treffer"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <ul id="palette-treffer" ref={listeRef} role="listbox" className="max-h-80 overflow-y-auto p-2">
            {treffer.map((eintrag, index) => (
              <li key={eintrag.href}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === markiert}
                  onClick={() => gehZu(index)}
                  onMouseEnter={() => setMarkiert(index)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    index === markiert ? 'bg-accent text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <NavIcon name={eintrag.icon} className="size-4 shrink-0" />
                  <span className="truncate text-foreground">{eintrag.label}</span>
                  {eintrag.gruppe ? (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{eintrag.gruppe}</span>
                  ) : null}
                </button>
              </li>
            ))}

            {mitgliedersuche ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={markiert === treffer.length}
                  onClick={() => gehZu(treffer.length)}
                  onMouseEnter={() => setMarkiert(treffer.length)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    markiert === treffer.length ? 'bg-accent text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <UserRound className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    Mitglied suchen: <span className="text-foreground">{suche.trim()}</span>
                  </span>
                  <CornerDownLeft className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ) : null}

            {anzahl === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nichts gefunden. Es werden nur Bereiche angezeigt, für die du berechtigt bist.
              </li>
            ) : null}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
