import 'server-only';
import { cache } from 'react';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';

const log = createLogger('web:guild');

type Gilde = Awaited<ReturnType<typeof discord.guild.get>>;

/**
 * Die Gilde - einmal je Seitenaufruf.
 *
 * `discord.guild.get()` fragt Discord. Eine Discord-Anfrage darf zehn Sekunden
 * dauern und wird bis zu dreimal wiederholt; im schlechten Fall wartet der
 * Aufrufer also ueber eine halbe Minute, ehe der Rueckfall greift.
 *
 * Dieselbe Antwort wurde bisher mehrfach pro Seite geholt: das Grundlayout
 * braucht Name und Symbol des Servers fuer die Seitenleiste, das Dashboard die
 * Mitgliederzahl, und die Kommunikationsseite fragt allein deshalb noch
 * einmal, um «Discord erreichbar» anzuzeigen. Drei Fragen, dieselbe Antwort,
 * dreimal gewartet - und weil das Grundlayout und die Seite zum selben Aufruf
 * gehoeren, addierte sich das zur wahrgenommenen Ladezeit.
 *
 * `cache` von React fasst das je Aufruf zusammen: die erste Frage stellt sie,
 * jede weitere bekommt dasselbe Ergebnis. Ueber Aufrufe hinweg wird nichts
 * behalten - die Angaben bleiben so frisch wie zuvor.
 *
 * Der Fehlerfall gehoert bewusst hierher und nicht an die Aufrufstellen: waere
 * er dort, wuerde jede Stelle ihren eigenen `catch` mitbringen und der
 * Zusammenfassung entgehen. `null` heisst «Discord ist gerade nicht
 * erreichbar» - dieselbe Bedeutung, die jede Aufrufstelle vorher selbst
 * hergestellt hat.
 */
export const currentGuild = cache(async (): Promise<Gilde | null> =>
  discord.guild.get().catch((error: unknown) => {
    // Die Warnung stand vorher am Dashboard. Sie gehoert dorthin, wo der
    // Fehler auftritt - sonst faellt sie mit der zusammengefassten Abfrage
    // still weg, und «Discord nicht erreichbar» waere im Protokoll nicht
    // mehr von «niemand hat gefragt» zu unterscheiden.
    log.warn('Guild-Daten konnten nicht geladen werden', { error });
    return null;
  }),
);
