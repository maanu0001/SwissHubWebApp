import { prisma } from '@swisshub/database';
import { discord, resolveGuildId } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { SYSTEM_ACTOR } from './service';
import {
  deleteTemporaryVoice,
  findeNachfolger,
  menschenImKanal,
  merkeBesitzerFort,
  planeLoeschung,
  schliesseZeilen,
  uebergibAnNachfolger,
} from './lifecycle';

const log = createLogger('voice:reconcile');

/**
 * Bringt Datenbank und Discord wieder zur Deckung.
 *
 * Faehrt periodisch und nach jedem Neustart. Er ist das Netz unter allem, was
 * sonst auf einem Ereignis beruht: Discord verschluckt eines, der Bot startet
 * mitten in einer Schonfrist neu, ein Administrator loescht einen Kanal von
 * Hand. Ohne diese Runde bliebe danach ein Geisterkanal stehen oder eine
 * Zeile, zu der es nichts mehr gibt.
 *
 * Bewusst ausschliesslich auf den eigenen Kanaelen: was nicht in dieser
 * Tabelle steht, gehoert einem anderen und wird nicht angefasst - auch dann
 * nicht, wenn es leer ist.
 */

export interface ReconcileErgebnis {
  geprueft: number;
  /** Zeilen, deren Discord-Kanal es nicht mehr gibt. */
  verwaist: number;
  /** Faellige leere Kanaele, die geloescht wurden. */
  geloescht: number;
  /** Leere Kanaele, fuer die eine Loeschung geplant wurde. */
  geplant: number;
  /** Verwaiste Talks, die einen neuen Besitzer bekommen haben. */
  uebergeben: number;
  /** Reservierungen, die nie ein Kanal wurden. */
  reservierungen: number;
}

/**
 * Wer entscheidet, wann ein leerer Kanal verschwindet.
 *
 * Die Engine fuehrt die Zeile und raeumt verwaiste auf - das ist reine
 * Buchhaltung und kann nichts kaputtmachen. Wann ein Kanal *endet*, ist
 * dagegen eine Frage des Moduls: die Spielersuche loescht ihren Gruppenkanal
 * sofort und schliesst dabei die Suche mit, und das weiss nur sie. Wuerde der
 * Abgleich hier mitmischen, kaempften zwei Stellen um denselben Kanal.
 */
const LOESCHT_LEERE_SELBST: ReadonlySet<string> = new Set(['VOICE_HUB', 'EVENT', 'OTHER']);

/**
 * Wie lange eine Reservierung ohne Kanal stehen darf.
 *
 * Sie entsteht Sekundenbruchteile vor dem Discord-Aufruf. Bleibt sie
 * bestehen, ist der Aufruf gescheitert und der Prozess dabei gestorben -
 * sonst haette er selbst aufgeraeumt.
 */
const RESERVIERUNG_MAX_MS = 2 * 60 * 1000;

export async function reconcileTemporaryVoices(): Promise<ReconcileErgebnis> {
  const guildId = await resolveGuildId().catch(() => null);
  const ergebnis: ReconcileErgebnis = {
    geprueft: 0,
    verwaist: 0,
    geloescht: 0,
    geplant: 0,
    uebergeben: 0,
    reservierungen: 0,
  };
  if (!guildId) {
    return ergebnis;
  }

  // --- Liegengebliebene Reservierungen ------------------------------------
  ergebnis.reservierungen = await schliesseZeilen({
    guildId,
    discordChannelId: null,
    createdAt: { lt: new Date(Date.now() - RESERVIERUNG_MAX_MS) },
  });

  const offene = await prisma.temporaryVoiceChannel.findMany({
    where: { guildId, closedAt: null, discordChannelId: { not: null } },
    include: { preset: { select: { deleteGraceSeconds: true, ownerModeration: true } } },
    take: 500,
  });

  for (const kanal of offene) {
    ergebnis.geprueft += 1;
    const channelId = kanal.discordChannelId;
    if (!channelId) {
      continue;
    }

    // --- Gibt es den Kanal ueberhaupt noch? -------------------------------
    const aufDiscord = await discord.managedChannels.get(channelId).catch(() => null);
    if (!aufDiscord) {
      await schliesseZeilen({ id: kanal.id });
      ergebnis.verwaist += 1;
      log.info('Talk war auf Discord nicht mehr vorhanden', { id: kanal.id, channelId });
      continue;
    }

    const grace = kanal.preset?.deleteGraceSeconds ?? 30;
    const menschen = await menschenImKanal(channelId);

    // --- Leer: loeschen oder einplanen ------------------------------------
    //
    // Nur fuer Quellen, deren Lebensende die Engine verwaltet. Fremde Kanaele
    // werden hier gezaehlt, aber nicht angefasst.
    if (menschen === 0 && LOESCHT_LEERE_SELBST.has(kanal.source)) {
      if (kanal.deleteScheduledAt && kanal.deleteScheduledAt.getTime() <= Date.now()) {
        await deleteTemporaryVoice(kanal, SYSTEM_ACTOR, 'Talk war leer');
        ergebnis.geloescht += 1;
      } else if (!kanal.deleteScheduledAt) {
        await planeLoeschung(kanal, grace);
        ergebnis.geplant += 1;
      }
      continue;
    }

    // --- Nicht leer: ein geplantes Loeschen ist ueberholt ------------------
    if (kanal.deleteScheduledAt) {
      await prisma.temporaryVoiceChannel.updateMany({
        where: { id: kanal.id, closedAt: null },
        data: { deleteScheduledAt: null },
      });
    }

    // Ab hier geht es um Besitz. Auch das ist Sache der Quelle: bei einer
    // Spielersuche ist der Ersteller der Ersteller, und niemand erbt die
    // Suche, nur weil er laenger im Kanal sitzt.
    if (!LOESCHT_LEERE_SELBST.has(kanal.source)) {
      continue;
    }

    // --- Besitzer sitzt gar nicht drin, ohne dass es jemand gemerkt hat ---
    //
    // Zwei Wege fuehren hierher: das Ereignis kam nie an, weil der Bot gerade
    // neu startete - oder der Talk wurde an jemanden uebergeben, der nie im
    // Kanal war. In beiden Faellen laeuft keine Schonfrist, und der Talk
    // haette auf Dauer einen abwesenden Besitzer. Hier faengt die Uhr an; ab
    // dann greift der Block darunter wie bei jedem anderen verwaisten Talk.
    if (!kanal.ownerLeftAt) {
      const besitzerDrin = await prisma.voicePresence.count({
        where: { channelId, discordId: kanal.ownerDiscordId },
      });
      if (besitzerDrin === 0) {
        await merkeBesitzerFort(kanal.id);
        continue;
      }
    }

    // --- Besitzer weg und Schonfrist vorbei -------------------------------
    if (kanal.ownerLeftAt && kanal.ownerLeftAt.getTime() + grace * 1000 <= Date.now()) {
      const uebergeben = await uebergibAnNachfolger(kanal, kanal.preset?.ownerModeration ?? true).catch(
        (error: unknown) => {
          log.warn('Talk konnte nicht übergeben werden', {
            error: error instanceof Error ? error.message : 'unbekannt',
            id: kanal.id,
          });
          return false;
        },
      );
      if (uebergeben) {
        ergebnis.uebergeben += 1;
      }
      continue;
    }

    // --- Besitzer hat den Server verlassen --------------------------------
    const besitzer = await discord.members.get(kanal.ownerDiscordId).catch(() => null);
    if (!besitzer) {
      const nachfolger = await findeNachfolger(kanal);
      if (nachfolger) {
        await uebergibAnNachfolger(kanal, kanal.preset?.ownerModeration ?? true).catch(() => undefined);
        ergebnis.uebergeben += 1;
      } else {
        await planeLoeschung(kanal, grace);
        ergebnis.geplant += 1;
      }
    }
  }

  if (
    ergebnis.verwaist > 0 ||
    ergebnis.geloescht > 0 ||
    ergebnis.uebergeben > 0 ||
    ergebnis.reservierungen > 0
  ) {
    log.info('Voice-Abgleich', { ...ergebnis });
  }
  return ergebnis;
}

/**
 * Loescht alte geschlossene Zeilen.
 *
 * Die Statistik braucht sie eine Weile, aber nicht ewig. Was aelter ist als
 * die Aufbewahrungsfrist, faellt weg - samt Verlauf.
 */
export async function raeumeAlteTalks(tage: number): Promise<number> {
  if (tage <= 0) {
    return 0;
  }
  const grenze = new Date(Date.now() - tage * 24 * 60 * 60 * 1000);
  const { count } = await prisma.temporaryVoiceChannel.deleteMany({
    where: { closedAt: { not: null, lt: grenze } },
  });
  if (count > 0) {
    log.info('Alte Talks entfernt', { count, tage });
  }
  await prisma.voiceHubEvent.deleteMany({ where: { createdAt: { lt: grenze } } });
  return count;
}
