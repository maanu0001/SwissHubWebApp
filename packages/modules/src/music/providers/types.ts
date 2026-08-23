/**
 * Musikquellen hinter einer Schnittstelle.
 *
 * Der Legacy-Bot rief `ytmusic.search()` und `ytdl.extract_info()` direkt im
 * Befehlsrumpf auf. Damit haengt jede Funktion an YouTube, und eine zweite
 * Quelle waere ein Umbau an zwanzig Stellen. Hier steht deshalb eine
 * Abstraktion davor - `MusicSessionService` kennt nur diese Schnittstelle.
 */

export interface MusicSearchResult {
  /** Eindeutig innerhalb des Anbieters, z.B. die YouTube-Video-ID. */
  providerTrackId: string;
  title: string;
  artist: string | null;
  /** Die dauerhafte Seiten-URL - niemals eine Stream-URL. */
  webpageUrl: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
}

export interface MusicProvider {
  /** Kurzname, wandert als `provider` in die Warteschlange. */
  readonly name: string;

  /** Erkennt dieser Anbieter die URL? Entscheidet auch den SSRF-Schutz. */
  canResolve(url: string): boolean;

  /** Suche nach Titel oder Interpret. */
  search(query: string, limit: number): Promise<MusicSearchResult[]>;

  /** Eine konkrete URL zu genau einem Titel aufloesen. */
  resolve(url: string): Promise<MusicSearchResult>;
}

/** Der Anbieter ist gerade nicht erreichbar - die Suche faellt aus, mehr nicht. */
export class MusicProviderUnavailableError extends Error {
  constructor(message = 'Die Musiksuche ist derzeit nicht erreichbar.') {
    super(message);
    this.name = 'MusicProviderUnavailableError';
  }
}

/** Die Anfrage passt nicht zum Anbieter - etwa eine nicht unterstuetzte URL. */
export class MusicProviderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MusicProviderInputError';
  }
}
