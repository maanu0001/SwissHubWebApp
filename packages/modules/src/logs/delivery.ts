import { prisma } from '@swisshub/database';
import type { DiscordLogDelivery } from '@swisshub/database';
import { DiscordApiError, discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { vermerkeErfolg, vermerkeFehler } from './config';

const log = createLogger('logs:delivery');

/**
 * Der Zusteller.
 *
 * Er laeuft im Bot und arbeitet die eingereihten Zustellungen ab. Getrennt
 * vom Einreihen, weil die beiden verschiedene Anforderungen haben: das
 * Einreihen darf niemanden warten lassen, das Senden darf scheitern.
 *
 * ## Reihenfolge
 *
 * Je Zielkanal wird **nacheinander** gesendet, in der Reihenfolge des
 * Entstehens. Sonst erschiene in Discord schon einmal die Aufhebung vor dem
 * Bann - und das Protokoll erzaehlte eine andere Geschichte als die, die
 * geschehen ist. Verschiedene Kanaele laufen parallel; eine Sperre ueber das
 * ganze System braucht es dafuer nicht.
 *
 * ## Gegendruck
 *
 * Je Lauf ein festes Hoechstmass an Zustellungen. Hundert gleichzeitige
 * Voice-Ereignisse ergeben dadurch keine hundert gleichzeitigen Anfragen an
 * Discord, sondern mehrere Laeufe - langsamer, aber innerhalb der Rate
 * Limits und ohne den Prozess zu fluten.
 */

/** Hoechstens so viele Zustellungen je Lauf - der Riegel gegen Lastspitzen. */
export const STAPEL = 40;

/** Hoechstens so viele Kanaele gleichzeitig. */
export const PARALLEL = 4;

/** Nach so vielen Versuchen gilt eine Zustellung als gescheitert. */
export const MAX_VERSUCHE = 3;

/** Wartezeit vor dem naechsten Versuch: 30 s, 2 min, dann Schluss. */
const BACKOFF_MS = [30_000, 120_000];

/**
 * Fehler, bei denen ein weiterer Versuch nichts aendert.
 *
 * Ein geloeschter Kanal wird nicht dadurch wieder da, dass man es noch
 * dreimal probiert. Solche Fehler beenden die Zustellung sofort und setzen
 * das Ziel auf `INVALID` - sichtbar im Dashboard, statt still im Nichts.
 */
const DAUERHAFT = new Set([
  10_003, // Unknown Channel
  50_001, // Missing Access
  50_013, // Missing Permissions
]);

export function istDauerhaft(error: unknown): boolean {
  if (error instanceof DiscordApiError) {
    if (error.discordCode !== undefined && DAUERHAFT.has(error.discordCode)) {
      return true;
    }
    // 404 und 403 sind Aussagen ueber den Kanal, nicht ueber den Moment.
    return error.status === 403 || error.status === 404;
  }
  return false;
}

export interface ZustellErgebnis {
  gesendet: number;
  gescheitert: number;
  verschoben: number;
}

/**
 * Holt einen Stapel und stellt zu.
 *
 * Beansprucht wird unter Bedingung: `claimedAt: null`. Wer das Rennen
 * verliert, bekommt die Zeile nicht - deshalb koennen zwei Laeufe nebeneinander
 * arbeiten, ohne dieselbe Nachricht zweimal zu senden.
 */
export async function stelleZu(
  options: { gateway?: DiscordGateway; jetzt?: Date; laeufer?: string } = {},
): Promise<ZustellErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;
  const jetzt = options.jetzt ?? new Date();
  const laeufer = options.laeufer ?? `${process.pid}`;

  const faellig = await prisma.discordLogDelivery.findMany({
    where: { status: 'PENDING', claimedAt: null, runAt: { lte: jetzt } },
    orderBy: { createdAt: 'asc' },
    take: STAPEL,
  });
  if (faellig.length === 0) {
    return { gesendet: 0, gescheitert: 0, verschoben: 0 };
  }

  const beansprucht: DiscordLogDelivery[] = [];
  for (const zeile of faellig) {
    const { count } = await prisma.discordLogDelivery.updateMany({
      where: { id: zeile.id, claimedAt: null, status: 'PENDING' },
      data: { claimedAt: jetzt, claimedBy: laeufer },
    });
    if (count === 1) {
      beansprucht.push(zeile);
    }
  }

  // Nach Kanal gruppieren: innerhalb eines Kanals zaehlt die Reihenfolge.
  const nachKanal = new Map<string, DiscordLogDelivery[]>();
  for (const zeile of beansprucht) {
    const bisher = nachKanal.get(zeile.channelId) ?? [];
    bisher.push(zeile);
    nachKanal.set(zeile.channelId, bisher);
  }

  const ergebnis: ZustellErgebnis = { gesendet: 0, gescheitert: 0, verschoben: 0 };
  const gruppen = [...nachKanal.values()];

  for (let start = 0; start < gruppen.length; start += PARALLEL) {
    const teil = gruppen.slice(start, start + PARALLEL);
    const teilErgebnisse = await Promise.all(
      teil.map((gruppe) => sendeGruppe(gruppe, gateway, jetzt)),
    );
    for (const teilErgebnis of teilErgebnisse) {
      ergebnis.gesendet += teilErgebnis.gesendet;
      ergebnis.gescheitert += teilErgebnis.gescheitert;
      ergebnis.verschoben += teilErgebnis.verschoben;
    }
  }

  return ergebnis;
}

/** Ein Kanal, der Reihe nach. */
async function sendeGruppe(
  gruppe: DiscordLogDelivery[],
  gateway: DiscordGateway,
  jetzt: Date,
): Promise<ZustellErgebnis> {
  const ergebnis: ZustellErgebnis = { gesendet: 0, gescheitert: 0, verschoben: 0 };

  for (const zeile of gruppe) {
    const ausgang = await sendeEine(zeile, gateway, jetzt);
    if (ausgang === 'gesendet') {
      ergebnis.gesendet += 1;
    } else if (ausgang === 'gescheitert') {
      ergebnis.gescheitert += 1;
      // Ein dauerhaft kaputtes Ziel: die uebrigen dieses Kanals brauchen es
      // gar nicht erst zu versuchen. Sie bleiben liegen und laufen beim
      // naechsten Mal - dann womoeglich in einen reparierten Kanal.
      break;
    } else {
      ergebnis.verschoben += 1;
    }
  }

  return ergebnis;
}

type Ausgang = 'gesendet' | 'gescheitert' | 'verschoben';

async function sendeEine(
  zeile: DiscordLogDelivery,
  gateway: DiscordGateway,
  jetzt: Date,
): Promise<Ausgang> {
  const versuch = zeile.attempts + 1;

  try {
    const nachricht = await gateway.channels.send(zeile.channelId, {
      embeds: [zeile.payload as never],
      // Ausdruecklich, obwohl das Gateway ohnehin nichts erwaehnt: ein
      // Protokoll darf niemanden anpingen, und geloggte Inhalte enthalten
      // regelmaessig `@everyone`.
      allowedMentions: { parse: [] },
    });

    await prisma.discordLogDelivery.update({
      where: { id: zeile.id },
      data: {
        status: 'SENT',
        sentAt: jetzt,
        attempts: versuch,
        lastAttemptAt: jetzt,
        discordMessageId: nachricht.id,
        claimedAt: null,
        claimedBy: null,
      },
    });
    await vermerkeErfolg(zeile.category);
    return 'gesendet';
  } catch (error) {
    const dauerhaft = istDauerhaft(error);
    const code = fehlerCode(error);
    const aufgeben = dauerhaft || versuch >= MAX_VERSUCHE;

    await prisma.discordLogDelivery.update({
      where: { id: zeile.id },
      data: {
        status: aufgeben ? 'FAILED' : 'PENDING',
        attempts: versuch,
        lastAttemptAt: jetzt,
        lastErrorCode: code,
        claimedAt: null,
        claimedBy: null,
        ...(aufgeben
          ? {}
          : { runAt: new Date(jetzt.getTime() + (BACKOFF_MS[versuch - 1] ?? 120_000)) }),
      },
    });

    await vermerkeFehler(zeile.category, code, dauerhaft);

    if (aufgeben) {
      log.warn('Log-Zustellung endgültig gescheitert', {
        channelId: zeile.channelId,
        category: zeile.category,
        code,
        dauerhaft,
      });
      return 'gescheitert';
    }
    log.debug('Log-Zustellung wird wiederholt', { code, versuch });
    return 'verschoben';
  }
}

/** Ein kurzer, aussagekraeftiger Code - keine ganze Fehlermeldung. */
function fehlerCode(error: unknown): string {
  if (error instanceof DiscordApiError) {
    return `discord_${error.status}_${error.discordCode ?? 'x'}`;
  }
  return 'unbekannt';
}

/**
 * Holt Zustellungen zurueck, die jemand beansprucht und nie beendet hat.
 *
 * Der Fall: der Bot stirbt zwischen Anspruch und Antwort. Ohne diesen Griff
 * bliebe die Zeile fuer immer beansprucht - und das Log erschiene nie.
 *
 * Zurueckgeholt wird erst nach einer Weile: waehrend ein Lauf arbeitet, ist
 * die Zeile zu Recht belegt.
 */
export async function holeSteckengebliebeneZurueck(
  aelterAlsMs = 5 * 60_000,
): Promise<number> {
  const grenze = new Date(Date.now() - aelterAlsMs);
  const { count } = await prisma.discordLogDelivery.updateMany({
    where: { status: 'PENDING', claimedAt: { lt: grenze } },
    data: { claimedAt: null, claimedBy: null },
  });
  if (count > 0) {
    log.info('Steckengebliebene Log-Zustellungen zurückgeholt', { count });
  }
  return count;
}
