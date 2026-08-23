import { createLogger } from '@swisshub/logger';
import {
  MusicProviderInputError,
  MusicProviderUnavailableError,
  type MusicProvider,
  type MusicSearchResult,
} from './types';

const logger = createLogger('music:provider:youtube');

/**
 * YouTube und YouTube Music.
 *
 * Suche und Aufloesung laufen in der Python-Laufzeit: `ytmusicapi` liefert
 * die schnelle Suche, die den Legacy-Bot ausmacht, und `yt-dlp` folgt den
 * YouTube-Aenderungen zuverlaessiger als jeder JavaScript-Nachbau. Diese
 * Klasse spricht sie ueber eine Schnittstelle an, die ausschliesslich im
 * Docker-Netz erreichbar ist - nach aussen ist davon nichts offen.
 *
 * Der gemeinsame Schluessel ist kein Ersatz fuer diese Abschottung, sondern
 * die zweite Linie: er verhindert, dass ein anderer Dienst im selben Netz
 * die Laufzeit ansprechen kann.
 */

/** Nur diese Hosts werden aufgeloest - alles andere ist ein SSRF-Versuch. */
const ERLAUBTE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

interface RuntimeAntwort {
  results?: unknown;
  error?: string;
}

export class YouTubeMusicProvider implements MusicProvider {
  readonly name = 'youtube';

  constructor(
    private readonly baseUrl: string,
    private readonly sharedSecret: string,
    private readonly timeoutMs = 8_000,
  ) {}

  canResolve(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    // Ausschliesslich https: `http` liesse einen Downgrade zu, und andere
    // Schemata (file:, gopher:) sind der klassische SSRF-Einstieg.
    if (parsed.protocol !== 'https:') {
      return false;
    }
    return ERLAUBTE_HOSTS.has(parsed.hostname.toLowerCase());
  }

  async search(query: string, limit: number): Promise<MusicSearchResult[]> {
    const daten = await this.anfrage('/search', { query, limit });
    return this.lese(daten.results);
  }

  async resolve(url: string): Promise<MusicSearchResult> {
    if (!this.canResolve(url)) {
      throw new MusicProviderInputError(
        'Diese Adresse wird nicht unterstützt. Erlaubt sind YouTube- und YouTube-Music-Links.',
      );
    }
    const daten = await this.anfrage('/resolve', { url });
    const treffer = this.lese(daten.results);
    if (treffer.length === 0) {
      throw new MusicProviderInputError('Zu dieser Adresse wurde kein Titel gefunden.');
    }
    return treffer[0]!;
  }

  private async anfrage(pfad: string, koerper: unknown): Promise<RuntimeAntwort> {
    const abbruch = new AbortController();
    const uhr = setTimeout(() => abbruch.abort(), this.timeoutMs);
    try {
      const antwort = await fetch(`${this.baseUrl}${pfad}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-swisshub-music-key': this.sharedSecret,
        },
        body: JSON.stringify(koerper),
        signal: abbruch.signal,
      });

      if (!antwort.ok) {
        // Bewusst ohne Antwortkörper im Fehler: yt-dlp-Meldungen enthalten
        // regelmässig ganze URLs und Abfrageparameter, die nichts im
        // Browser verloren haben.
        logger.warn('Musik-Laufzeit antwortet mit Fehler', { status: antwort.status, pfad });
        throw new MusicProviderUnavailableError();
      }
      return (await antwort.json()) as RuntimeAntwort;
    } catch (error) {
      if (error instanceof MusicProviderUnavailableError) {
        throw error;
      }
      logger.warn('Musik-Laufzeit nicht erreichbar', {
        pfad,
        grund: error instanceof Error ? error.name : 'unbekannt',
      });
      throw new MusicProviderUnavailableError();
    } finally {
      clearTimeout(uhr);
    }
  }

  /** Die Antwort der Laufzeit ist Fremdeingabe und wird streng gelesen. */
  private lese(rohdaten: unknown): MusicSearchResult[] {
    if (!Array.isArray(rohdaten)) {
      return [];
    }
    const treffer: MusicSearchResult[] = [];
    for (const eintrag of rohdaten) {
      if (typeof eintrag !== 'object' || eintrag === null) {
        continue;
      }
      const e = eintrag as Record<string, unknown>;
      const webpageUrl = typeof e.webpageUrl === 'string' ? e.webpageUrl : null;
      const title = typeof e.title === 'string' ? e.title : null;
      if (!webpageUrl || !title || !this.canResolve(webpageUrl)) {
        continue;
      }
      treffer.push({
        providerTrackId: typeof e.providerTrackId === 'string' ? e.providerTrackId : webpageUrl,
        title: title.slice(0, 300),
        artist: typeof e.artist === 'string' ? e.artist.slice(0, 200) : null,
        webpageUrl,
        durationSeconds:
          typeof e.durationSeconds === 'number' && Number.isFinite(e.durationSeconds)
            ? Math.max(0, Math.trunc(e.durationSeconds))
            : 0,
        thumbnailUrl:
          typeof e.thumbnailUrl === 'string' && e.thumbnailUrl.startsWith('https://')
            ? e.thumbnailUrl
            : null,
      });
    }
    return treffer;
  }
}
