'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, UserCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { searchMembersAction } from '@/modules/members/actions';

export interface PickedMember {
  discordId: string;
  username: string;
  displayName: string;
  avatarHash: string | null;
  jailed: boolean;
}

/**
 * Ein Treffer, wie ihn eine Suchaktion zurueckgibt.
 *
 * `waehlbar` und `grund` sind optional: die allgemeine Mitgliedersuche kennt
 * sie nicht, weil dort jeder Treffer waehlbar ist. Wo eine Suche fachlich
 * aussortiert - der Vote Jail tut das -, sagt sie es hiermit, statt den
 * Treffer wegzulassen. Ein weggelassener Treffer ist von «gibt es nicht»
 * nicht zu unterscheiden.
 */
interface SucheTreffer extends PickedMember {
  isBot: boolean;
  waehlbar?: boolean;
  grund?: string | null;
}

/** Ein Eintrag in der Vorschlagsliste. */
interface Vorschlag extends PickedMember {
  waehlbar: boolean;
  grund: string | null;
}

/** Woran die Liste gerade ist. */
type SuchStand =
  | { art: 'leer' }
  | { art: 'laedt' }
  | { art: 'treffer'; eintraege: Vorschlag[] }
  | { art: 'nichts' }
  | { art: 'fehler'; meldung: string };

/**
 * Die Suche, mit der dieser Picker arbeitet.
 *
 * Voreingestellt ist die allgemeine Mitgliedersuche. Der Vote-Jail-Ablauf
 * uebergibt stattdessen seine eigene: sie verlangt nicht `members.view` und
 * liefert nur, wogegen tatsaechlich abgestimmt werden darf. Der Picker
 * bleibt derselbe - was er zeigt, entscheidet die Aktion, die ihn beliefert,
 * und die prueft serverseitig.
 */
export type MemberSuche = (eingabe: {
  csrfToken: string;
  query: string;
  limit?: number;
}) => Promise<{ ok: true; data: readonly SucheTreffer[] } | { ok: false; error: { message: string } }>;

interface MemberPickerProps {
  csrfToken: string;
  value: PickedMember | null;
  onChange(member: PickedMember | null): void;
  label?: string;
  /** Abweichende Suche - siehe `MemberSuche`. */
  suche?: MemberSuche;
}

const DEBOUNCE_MS = 350;

/**
 * Einen Treffer auf die Form der Liste bringen.
 *
 * Eigene Funktion, damit beide Suchen hier zusammenkommen: die allgemeine
 * Mitgliedersuche kennt `waehlbar` nicht, weil dort jeder Treffer waehlbar
 * ist - fehlt die Angabe, gilt genau das.
 */
/**
 * Der eine Grund, an dem alle Treffer scheitern - oder `null`.
 *
 * Nur wenn wirklich keiner waehlbar ist und alle denselben Grund tragen.
 * Sonst waere es eine Verallgemeinerung: dass zufaellig beide Treffer
 * Moderatoren sind, sagt nichts ueber die Einrichtung.
 */
function gemeinsamerHinderungsgrund(eintraege: Vorschlag[]): string | null {
  if (eintraege.length === 0 || eintraege.some((eintrag) => eintrag.waehlbar)) {
    return null;
  }
  const gruende = new Set(eintraege.map((eintrag) => eintrag.grund ?? 'Nicht möglich'));
  return gruende.size === 1 ? [...gruende][0]! : null;
}

function alsVorschlag(member: SucheTreffer): Vorschlag {
  return {
    discordId: member.discordId,
    username: member.username,
    displayName: member.displayName,
    avatarHash: member.avatarHash,
    jailed: member.jailed,
    waehlbar: member.waehlbar ?? true,
    grund: member.grund ?? null,
  };
}

/**
 * Mitgliedersuche mit Debouncing.
 * Die eigentliche Suche läuft serverseitig (Rate Limit + Berechtigungsprüfung).
 */
export function MemberPicker({
  csrfToken,
  value,
  onChange,
  label = 'Benutzer',
  suche,
}: MemberPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [stand, setStand] = useState<SuchStand>({ art: 'leer' });
  const [touched, setTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Laufende Nummer der juengsten Anfrage.
   *
   * Zwei Anfragen koennen sich ueberholen - die zu «man» braucht laenger als
   * die zu «manu», und dann schreibt die aeltere ihre Treffer ueber die
   * neueren. Nur wer die hoechste Nummer traegt, darf noch etwas anzeigen.
   */
  const laufendeNummer = useRef(0);

  useEffect(() => {
    if (!touched || query.trim().length < 2) {
      setStand({ art: 'leer' });
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      laufendeNummer.current += 1;
      const meine = laufendeNummer.current;
      setStand({ art: 'laedt' });

      void (async () => {
        const antwort = await (suche ?? searchMembersAction)({ csrfToken, query, limit: 20 });
        // Ueberholt worden: still zurueckziehen, sonst blinkt ein altes
        // Ergebnis ueber ein neueres.
        if (meine !== laufendeNummer.current) {
          return;
        }

        if (!antwort.ok) {
          // Frueher stand hier `setResults([])`. Damit sah ein Fehler genauso
          // aus wie «niemand gefunden» - der Kringel verschwand, und uebrig
          // blieb eine leere Flaeche.
          setStand({ art: 'fehler', meldung: antwort.error.message });
          return;
        }

        const eintraege = antwort.data.filter((member) => !member.isBot).map(alsVorschlag);

        setStand(eintraege.length === 0 ? { art: 'nichts' } : { art: 'treffer', eintraege });
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [query, csrfToken, touched, suche]);

  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
          <span className="flex items-center gap-3">
            <DiscordAvatar
              discordId={value.discordId}
              avatarHash={value.avatarHash}
              name={value.displayName}
              size={32}
              status={value.jailed ? 'jailed' : null}
            />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium">{value.displayName}</span>
              <span className="text-xs text-muted-foreground">@{value.username}</span>
            </span>
            {value.jailed ? <Badge variant="warning">Bereits gejailt</Badge> : null}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
              setStand({ art: 'leer' });
            }}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Ändern
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="member-search">{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="member-search"
          value={query}
          onChange={(event) => {
            setTouched(true);
            setQuery(event.target.value);
          }}
          placeholder="Username, Anzeigename oder Discord ID"
          className="pl-9"
          autoComplete="off"
          aria-describedby="member-search-hint"
        />
        {stand.art === 'laedt' ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p id="member-search-hint" className="text-xs text-muted-foreground">
        Mindestens 2 Zeichen. Discord IDs werden direkt aufgelöst.
      </p>

      {/*
        Vier Zustaende, und jeder sagt etwas anderes. Vorher gab es faktisch
        nur zwei: «Treffer» und «leere Flaeche» - und diese leere Flaeche
        bedeutete gleichzeitig «wird gesucht», «niemand gefunden» und «die
        Suche ist gescheitert».
      */}
      {stand.art === 'laedt' ? (
        <p className="px-1 py-2 text-xs text-muted-foreground" role="status">
          Mitglieder werden gesucht …
        </p>
      ) : null}

      {stand.art === 'nichts' ? (
        <p className="px-1 py-2 text-xs text-muted-foreground" role="status">
          Keine passenden Mitglieder gefunden.
        </p>
      ) : null}

      {stand.art === 'fehler' ? (
        <p className="px-1 py-2 text-xs text-destructive" role="alert">
          {stand.meldung}
        </p>
      ) : null}

      {/*
        Wenn gar nichts waehlbar ist, und immer aus demselben Grund, dann ist
        das keine Eigenschaft der Treffer, sondern ein Zustand des Servers.
        Er gehoert nach oben und nicht als Abzeichen an jede einzelne Zeile -
        sonst sucht jemand den Fehler bei den Mitgliedern.
      */}
      {stand.art === 'treffer' && gemeinsamerHinderungsgrund(stand.eintraege) ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs" role="status">
          Keines der gefundenen Mitglieder lässt sich auswählen:{' '}
          <strong>{gemeinsamerHinderungsgrund(stand.eintraege)}</strong>.
        </p>
      ) : null}

      {stand.art === 'treffer' ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1 scrollbar-slim">
          {stand.eintraege.map((member) => (
            <li key={member.discordId}>
              <button
                type="button"
                disabled={!member.waehlbar}
                title={member.grund ?? undefined}
                onClick={() => onChange(member)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  member.waehlbar
                    ? 'hover:bg-accent'
                    : // Sichtbar, aber nicht anklickbar - mit dem Grund
                      // daneben. Wer weiss, dass die Person auf dem Server
                      // ist, soll nicht vor einer leeren Liste stehen.
                      'cursor-not-allowed opacity-60',
                )}
              >
                <DiscordAvatar
                  status={member.jailed ? 'jailed' : null}
                  discordId={member.discordId}
                  avatarHash={member.avatarHash}
                  name={member.displayName}
                  size={32}
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">{member.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">@{member.username}</span>
                </span>
                {member.waehlbar ? (
                  <UserCheck className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Badge variant="outline" className="ml-auto shrink-0">
                    {member.grund ?? 'Nicht möglich'}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
