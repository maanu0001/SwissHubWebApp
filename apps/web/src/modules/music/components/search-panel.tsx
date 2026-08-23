'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Search } from 'lucide-react';
import { addTrackAction, searchAction } from '@/modules/music/actions';

interface Treffer {
  providerTrackId: string;
  title: string;
  artist: string | null;
  webpageUrl: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
}

const dauer = (s: number): string =>
  s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '–:––';

/**
 * Suche und Hinzufuegen.
 *
 * Eine gueltige Adresse wird direkt aufgeloest und ohne Auswahl angeboten -
 * genau wie im Legacy-Bot, wo `/play <URL>` sofort spielte und nur ein
 * Suchbegriff die Trefferliste zeigte.
 *
 * Jede neue Suche verwirft die vorherige: sonst ueberholt eine langsame
 * Antwort eine schnellere, und man sieht Treffer zu einem Begriff, den man
 * laengst weitergetippt hat.
 */
export function SearchPanel({
  sessionId,
  csrfToken,
  darfSteuern,
}: {
  sessionId: string;
  csrfToken: string;
  darfSteuern: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [begriff, setBegriff] = useState('');
  const [treffer, setTreffer] = useState<Treffer[] | null>(null);
  const [sucht, setSucht] = useState(false);
  const [fuegtHinzu, setFuegtHinzu] = useState<string | null>(null);
  const [, starteUebergang] = useTransition();
  const laufNummer = useRef(0);

  async function suche(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const eingabe = begriff.trim();
    if (!eingabe || sucht) {
      return;
    }
    const meineNummer = ++laufNummer.current;
    setSucht(true);
    try {
      const antwort = await searchAction({ csrfToken, query: eingabe });
      // Veraltete Antwort verwerfen.
      if (meineNummer !== laufNummer.current) {
        return;
      }
      if (antwort.ok) {
        setTreffer(antwort.data.treffer);
        if (antwort.data.treffer.length === 0) {
          toast.info('Keine Treffer gefunden.');
        }
      } else {
        toast.error(antwort.error.message);
      }
    } finally {
      if (meineNummer === laufNummer.current) {
        setSucht(false);
      }
    }
  }

  async function hinzufuegen(eintrag: Treffer): Promise<void> {
    setFuegtHinzu(eintrag.webpageUrl);
    try {
      const antwort = await addTrackAction({ csrfToken, sessionId, webpageUrl: eintrag.webpageUrl });
      if (antwort.ok) {
        toast.success(`"${antwort.data.titel}" zur Warteschlange hinzugefügt.`);
        setTreffer(null);
        setBegriff('');
        starteUebergang(() => router.refresh());
      } else {
        toast.error(antwort.error.message);
      }
    } finally {
      setFuegtHinzu(null);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => void suche(e)} className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={begriff}
          onChange={(e) => setBegriff(e.target.value)}
          disabled={!darfSteuern}
          maxLength={200}
          placeholder="Song, Artist oder YouTube-Link suchen…"
          aria-label="Musik suchen"
          className="h-11 w-full rounded-xl border border-border bg-card/70 pl-10 pr-24 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!darfSteuern || sucht || begriff.trim().length === 0}
          className="absolute right-1.5 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1.5 rounded-lg bg-accent-gradient px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {sucht ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
          Suchen
        </button>
      </form>

      {treffer && treffer.length > 0 ? (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/40">
          {treffer.map((eintrag) => (
            <li
              key={eintrag.providerTrackId}
              className="flex items-center gap-3 p-2.5 transition-colors hover:bg-card/80"
            >
              {eintrag.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- fremde CDN-Adresse, kein Loader
                <img
                  src={eintrag.thumbnailUrl}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                  className="size-12 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="size-12 shrink-0 rounded-lg bg-border/60" aria-hidden="true" />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{eintrag.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {eintrag.artist ?? 'Unbekannt'} · {dauer(eintrag.durationSeconds)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void hinzufuegen(eintrag)}
                disabled={fuegtHinzu !== null}
                title="Zur Warteschlange hinzufügen"
                aria-label={`"${eintrag.title}" zur Warteschlange hinzufügen`}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                {fuegtHinzu === eintrag.webpageUrl ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
