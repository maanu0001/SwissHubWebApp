import { prisma } from '@swisshub/database';
import type { DiscordEvent, DiscordLogCategory, ModerationAction } from '@swisshub/database';
import type { DiscordEmbed } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { logKanalIds, zielFuer } from './config';
import { formatiereEreignis, formatiereMassnahme } from './formatters';
import { kategorieFuerEreignis, NICHT_NACH_DISCORD } from './registry';

const log = createLogger('logs:dispatch');

/**
 * Der eine Weg von einem Logeintrag zu Discord.
 *
 * ## Warum genau hier und nirgends sonst
 *
 * Es waere leicht gewesen, in jeden Ereignisbehandler ein `sendeLog(...)` zu
 * schreiben. Genau das ist die Falle: beim naechsten neuen Ereignis vergisst
 * es jemand, und niemand merkt es - ein fehlendes Log sieht aus wie ein
 * Ereignis, das nicht stattgefunden hat. Deshalb gibt es zwei Anknuepfpunkte
 * und sonst keine:
 *
 * ```
 * ModerationAction geschrieben  → meldeMassnahme()  → hier
 * DiscordEvent geschrieben      → recordEvent()     → hier
 * ```
 *
 * Ein neues Modul, das Discord-Ausgabe will, haengt sich an einen der beiden -
 * oder bringt einen dritten mit und traegt seine Kategorie in die Registry
 * ein. Es aendert nichts an dieser Datei.
 *
 * ## Diese Datei wirft nie
 *
 * Die Discord-Ausgabe ist die Darstellung, nicht der Vorgang. Ein Bann bleibt
 * ein Bann, auch wenn `#logs-moderation` gerade nicht erreichbar ist. Jeder
 * Ausgang hier ist deshalb gefangen, und mehr als eine Warnung passiert nicht.
 *
 * ## Und sie sendet nicht selbst
 *
 * Sie legt eine Zustellung an. Gesendet wird spaeter vom Zusteller im Bot -
 * sonst wartete die Person, die gerade jemanden gebannt hat, darauf, dass
 * Discord den Embed annimmt.
 */

/** Woraus die Zustellung entstand - Teil des Schluessels gegen Doppelungen. */
type Quelle = 'moderation' | 'event';

/**
 * Der Schluessel, der eine zweite Nachricht verhindert.
 *
 * Quelle, Kennung des Logeintrags und Zielkanal. Derselbe Eintrag in
 * denselben Kanal ergibt denselben Schluessel - und der ist in der Datenbank
 * eindeutig. Ein Neustart mitten in der Zustellung kann dadurch keine zweite
 * Nachricht erzeugen, und zwei gleichzeitige Laeufe auch nicht.
 */
export function dedupeKey(quelle: Quelle, logId: string, channelId: string): string {
  return `${quelle}:${logId}:${channelId}`;
}

interface EinreihenEingabe {
  quelle: Quelle;
  logId: string;
  category: DiscordLogCategory;
  guildId: string;
  embed: DiscordEmbed;
}

/**
 * Legt eine Zustellung an - oder stellt fest, dass es sie schon gibt.
 *
 * Die Eindeutigkeitsverletzung ist hier kein Fehler, sondern die Antwort:
 * jemand war schneller, und genau dafuer ist der Schluessel da.
 */
async function reiheEin(eingabe: EinreihenEingabe, channelId: string): Promise<boolean> {
  const schluessel = dedupeKey(eingabe.quelle, eingabe.logId, channelId);
  try {
    await prisma.discordLogDelivery.create({
      data: {
        dedupeKey: schluessel,
        guildId: eingabe.guildId,
        category: eingabe.category,
        channelId,
        payload: eingabe.embed as unknown as object,
      },
    });
    return true;
  } catch (error) {
    if (istEindeutigkeitsfehler(error)) {
      log.debug('Zustellung bereits eingereiht', { schluessel });
      return false;
    }
    throw error;
  }
}

function istEindeutigkeitsfehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export type DispatchErgebnis =
  | { ergebnis: 'eingereiht'; channelId: string }
  | { ergebnis: 'bereits-eingereiht' }
  /** Kategorie nicht eingerichtet, abgeschaltet oder Ziel kaputt. */
  | { ergebnis: 'kein-ziel' }
  /** Dieses Ereignis gehoert nicht in die Discord-Ausgabe. */
  | { ergebnis: 'uebersprungen'; grund: string };

/**
 * Eine Massnahme aus der Akte nach Discord geben.
 *
 * Gilt fuer alle vier Quellen gleichermassen: Dashboard, Slash-Befehl, direkt
 * in Discord erkannt, Zeitsteuerung. Sie unterscheiden sich im Feld «Quelle»
 * des Embeds - und in nichts sonst.
 */
export async function dispatchMassnahme(massnahme: ModerationAction): Promise<DispatchErgebnis> {
  try {
    if (NICHT_NACH_DISCORD.has(massnahme.type)) {
      return { ergebnis: 'uebersprungen', grund: 'nicht-fuer-discord' };
    }
    const ziel = await zielFuer('MODERATION');
    if (!ziel) {
      return { ergebnis: 'kein-ziel' };
    }
    const embed = formatiereMassnahme(massnahme);
    const neu = await reiheEin(
      {
        quelle: 'moderation',
        logId: massnahme.id,
        category: 'MODERATION',
        guildId: ziel.guildId,
        embed,
      },
      ziel.channelId,
    );
    return neu ? { ergebnis: 'eingereiht', channelId: ziel.channelId } : { ergebnis: 'bereits-eingereiht' };
  } catch (error) {
    log.warn('Massnahme konnte nicht für Discord eingereiht werden', { error, id: massnahme.id });
    return { ergebnis: 'uebersprungen', grund: 'fehler' };
  }
}

/**
 * Ein Statistikereignis nach Discord geben.
 *
 * Zwei Ereignisse gehen hier nie hinaus, und beide aus gutem Grund:
 *
 * 1. **Was zu einer Massnahme gehoert.** Ein Bann ueber das Dashboard erzeugt
 *    beides - Akteneintrag und Statistikereignis. Beides zu senden hiesse,
 *    dieselbe Sache zweimal zu melden.
 * 2. **Was in einem Log-Kanal geschieht.** Sonst entstuende die Schleife: ein
 *    Embed im Log-Kanal ist eine Nachricht, die Nachricht ein Ereignis, das
 *    Ereignis ein Embed. Der Bot filtert eigene Nachrichten zwar schon beim
 *    Aufzeichnen - aber eine Zusage, die an einer einzigen `if`-Zeile in einem
 *    anderen Paket haengt, ist keine.
 */
export async function dispatchEreignis(ereignis: DiscordEvent): Promise<DispatchErgebnis> {
  try {
    const category = kategorieFuerEreignis({
      category: ereignis.category,
      type: ereignis.type,
      moderationActionId: ereignis.moderationActionId,
    });
    if (!category) {
      return { ergebnis: 'uebersprungen', grund: 'aus-der-akte' };
    }

    if (ereignis.channelId && (await logKanalIds()).has(ereignis.channelId)) {
      log.debug('Ereignis aus einem Log-Kanal wird nicht ausgegeben', { id: ereignis.id });
      return { ergebnis: 'uebersprungen', grund: 'log-kanal' };
    }

    const ziel = await zielFuer(category);
    if (!ziel) {
      return { ergebnis: 'kein-ziel' };
    }

    const embed = formatiereEreignis(ereignis, { guildId: ereignis.guildId });
    const neu = await reiheEin(
      { quelle: 'event', logId: ereignis.id, category, guildId: ereignis.guildId, embed },
      ziel.channelId,
    );
    return neu ? { ergebnis: 'eingereiht', channelId: ziel.channelId } : { ergebnis: 'bereits-eingereiht' };
  } catch (error) {
    log.warn('Ereignis konnte nicht für Discord eingereiht werden', { error, id: ereignis.id });
    return { ergebnis: 'uebersprungen', grund: 'fehler' };
  }
}
