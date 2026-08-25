/**
 * Ersatz fuer `server-only` in Tests.
 *
 * Das echte Paket wirft beim Import ausserhalb einer Server-Umgebung - es ist
 * genau dafuer da, ein versehentliches Buendeln im Browser zu verhindern. In
 * Vitest laufen die Dateien im Node-Prozess und sollen importierbar sein,
 * ohne dass diese Schutzfunktion im Produktionscode aufgeweicht wird.
 */
export {};
