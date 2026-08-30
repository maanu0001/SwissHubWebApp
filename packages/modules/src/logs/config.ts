import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { DiscordLogCategory, DiscordLogChannel, DiscordLogHealth } from '@swisshub/database';
import {
  DISCORD_PERMISSION_LABELS,
  discord as defaultDiscord,
  hasDiscordPermission,
  resolveGuildId,
  type DiscordGateway,
  type GuildChannel,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { kategorie, LOG_KATEGORIEN } from './registry';

const log = createLogger('logs:config');

/**
 * Wohin welche Log-Kategorie geht.
 *
 * Die Datenbank ist die Wahrheit - keine Kanalkennung in `.env`, keine im
 * Quelltext. Eine Kategorie ohne Zeile ist schlicht nicht eingerichtet, und
 * das ist der Normalzustand nach der Installation.
 *
 * ## Die Rechte, die ein Log-Kanal braucht
 *
 * Genau drei, und keines mehr:
 *
 * - **Kanal ansehen** - sonst existiert er fuer den Bot nicht.
 * - **Nachrichten senden** - das eigentliche Anliegen.
 * - **Links einbetten** - ohne dieses Recht verwirft Discord das Embed
 *   stillschweigend und es kaeme eine leere Nachricht an.
 *
 * `Dateien anhaengen` steht bewusst nicht dabei: kein Formatter haengt etwas
 * an. Ein Recht zu verlangen, das nie gebraucht wird, ist keine Vorsicht,
 * sondern Nachlaessigkeit.
 */

/** Die Rechte, ohne die ein Log-Ziel nicht funktioniert. */
export const BENOETIGTE_RECHTE = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'EMBED_LINKS'] as const;

/** Discord-Kanaltypen, in die sich sinnvoll schreiben laesst. */
const ERLAUBTE_TYPEN = new Set([
  0, // Text
  5, // Ankuendigungen
]);

export interface LogZielSicht {
  category: DiscordLogCategory;
  label: string;
  beschreibung: string;
  beispiel: string;
  channelId: string | null;
  channelName: string | null;
  enabled: boolean;
  health: DiscordLogHealth;
  healthNote: string | null;
  checkedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
}

/**
 * Alle Kategorien - eingerichtete und nicht eingerichtete.
 *
 * Bewusst immer vollstaendig: die Uebersicht soll zeigen, was **nicht**
 * konfiguriert ist. Eine Liste, die nur die eingerichteten Ziele zeigt,
 * verschweigt genau die Luecke, die man sucht.
 */
export async function ladeZiele(): Promise<LogZielSicht[]> {
  const zeilen = await prisma.discordLogChannel.findMany();
  const nachKategorie = new Map(zeilen.map((zeile) => [zeile.category, zeile]));

  return LOG_KATEGORIEN.map((definition) => {
    const zeile = nachKategorie.get(definition.id);
    return {
      category: definition.id,
      label: definition.label,
      beschreibung: definition.beschreibung,
      beispiel: definition.beispiel,
      channelId: zeile?.channelId ?? null,
      channelName: zeile?.channelName ?? null,
      enabled: zeile?.enabled ?? false,
      health: zeile ? zeile.health : 'DISABLED',
      healthNote: zeile?.healthNote ?? null,
      checkedAt: zeile?.checkedAt ?? null,
      lastErrorAt: zeile?.lastErrorAt ?? null,
      lastErrorCode: zeile?.lastErrorCode ?? null,
    };
  });
}

/** Das aktive Ziel einer Kategorie - oder nichts. */
export async function zielFuer(category: DiscordLogCategory): Promise<DiscordLogChannel | null> {
  const zeile = await prisma.discordLogChannel.findUnique({ where: { category } });
  if (!zeile || !zeile.enabled || zeile.health === 'INVALID') {
    return null;
  }
  return zeile;
}

/** Die Kennungen aller eingerichteten Log-Kanaele - fuer die Schleifensicherung. */
export async function logKanalIds(): Promise<Set<string>> {
  const zeilen = await prisma.discordLogChannel.findMany({ select: { channelId: true } });
  return new Set(zeilen.map((zeile) => zeile.channelId));
}

export interface PruefErgebnis {
  ok: boolean;
  /** Klartext fuer die Oberflaeche - kein Fehlercode. */
  grund?: string;
  kanal?: GuildChannel;
}

/**
 * Taugt dieser Kanal als Log-Ziel?
 *
 * Vier Fragen in dieser Reihenfolge, weil jede die naechste voraussetzt: gibt
 * es ihn, ist er ein Textkanal, sieht der Bot ihn, darf er schreiben und
 * einbetten. Die Antwort ist Klartext, weil sie im Dashboard steht.
 */
export async function pruefeKanal(
  channelId: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<PruefErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;

  let kanaele: GuildChannel[];
  try {
    kanaele = await gateway.channels.list();
  } catch (error) {
    log.warn('Kanalliste nicht abrufbar', { error });
    return { ok: false, grund: 'Discord ist gerade nicht erreichbar.' };
  }

  const kanal = kanaele.find((eintrag) => eintrag.id === channelId);
  if (!kanal) {
    return { ok: false, grund: 'Diesen Kanal gibt es auf dem Server nicht (mehr).' };
  }
  if (!ERLAUBTE_TYPEN.has(kanal.type)) {
    return { ok: false, grund: 'In diesen Kanaltyp kann der Bot keine Logs schreiben.' };
  }

  let rechte: bigint;
  try {
    rechte = await gateway.channels.botPermissions(channelId);
  } catch (error) {
    log.warn('Kanalrechte nicht abrufbar', { error, channelId });
    return { ok: false, grund: 'Die Rechte des Bots konnten nicht geprüft werden.', kanal };
  }

  const fehlend = BENOETIGTE_RECHTE.filter((recht) => !hasDiscordPermission(rechte, recht));
  if (fehlend.length > 0) {
    return {
      ok: false,
      grund: `Dem Bot fehlt in diesem Kanal: ${fehlend.map(rechtName).join(', ')}.`,
      kanal,
    };
  }

  return { ok: true, kanal };
}

/** Die Beschriftungen stehen zentral im Discord-Paket - nicht ein zweites Mal hier. */
function rechtName(recht: (typeof BENOETIGTE_RECHTE)[number]): string {
  return DISCORD_PERMISSION_LABELS[recht];
}

export interface SetzeZielEingabe {
  category: DiscordLogCategory;
  /** `null` schaltet die Kategorie ab. */
  channelId: string | null;
  actor: { discordId: string; username: string };
}

/**
 * Richtet eine Kategorie ein - oder schaltet sie ab.
 *
 * Geprueft wird **vor** dem Speichern: eine Konfiguration, die von vornherein
 * nicht funktioniert, gehoert nicht in die Datenbank. Wer sie trotzdem
 * anlegen liesse, verschoebe den Fehler auf den Moment, in dem das erste Log
 * verloren geht.
 *
 * Derselbe Kanal darf mehrfach vorkommen. Wer alles in einen `#server-logs`
 * schreiben will, soll das koennen.
 */
export async function setzeZiel(
  eingabe: SetzeZielEingabe,
  options: { gateway?: DiscordGateway } = {},
): Promise<void> {
  const vorher = await prisma.discordLogChannel.findUnique({
    where: { category: eingabe.category },
  });

  if (!eingabe.channelId) {
    if (!vorher) {
      return;
    }
    await prisma.discordLogChannel.update({
      where: { category: eingabe.category },
      data: { enabled: false, health: 'DISABLED', healthNote: null, updatedBy: eingabe.actor.discordId },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.LOG_CHANNEL_DISABLED,
      module: 'logs',
      actorDiscordId: eingabe.actor.discordId,
      actorUsername: eingabe.actor.username,
      metadata: { category: eingabe.category, vorherigerKanal: vorher.channelId },
    });
    return;
  }

  const befund = await pruefeKanal(eingabe.channelId, options);
  if (!befund.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: befund.grund ?? 'Dieser Kanal eignet sich nicht als Log-Ziel.',
    });
  }

  const guildId = await resolveGuildId();
  const daten = {
    guildId,
    channelId: eingabe.channelId,
    channelName: befund.kanal?.name ?? null,
    enabled: true,
    health: 'HEALTHY' as const,
    healthNote: null,
    checkedAt: new Date(),
    updatedBy: eingabe.actor.discordId,
  };

  await prisma.discordLogChannel.upsert({
    where: { category: eingabe.category },
    create: { category: eingabe.category, ...daten },
    update: daten,
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LOG_CHANNEL_CONFIG_CHANGED,
    module: 'logs',
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    metadata: {
      category: eingabe.category,
      vorherigerKanal: vorher?.channelId ?? null,
      neuerKanal: eingabe.channelId,
      kanalName: befund.kanal?.name ?? null,
    },
  });
}

/**
 * Vermerkt, dass eine Zustellung gescheitert ist.
 *
 * Ein einzelner Fehlschlag macht das Ziel `DEGRADED`, kein `INVALID`: ein
 * kurzer Aussetzer bei Discord ist kein kaputter Kanal. `INVALID` setzt nur
 * die Pruefung, die den Kanal tatsaechlich nicht mehr findet.
 */
export async function vermerkeFehler(
  category: DiscordLogCategory,
  code: string,
  dauerhaft: boolean,
): Promise<void> {
  await prisma.discordLogChannel.updateMany({
    where: { category },
    data: {
      lastErrorAt: new Date(),
      lastErrorCode: code.slice(0, 100),
      health: dauerhaft ? 'INVALID' : 'DEGRADED',
      ...(dauerhaft ? { healthNote: 'Der Kanal ist nicht mehr erreichbar oder es fehlen Rechte.' } : {}),
    },
  });
}

/** Vermerkt eine erfolgreiche Zustellung - das Ziel ist damit wieder gesund. */
export async function vermerkeErfolg(category: DiscordLogCategory): Promise<void> {
  await prisma.discordLogChannel.updateMany({
    where: { category, health: 'DEGRADED' },
    data: { health: 'HEALTHY', healthNote: null },
  });
}

/**
 * Prueft alle eingerichteten Ziele.
 *
 * Laeuft als Job, nicht bei jedem Seitenaufruf: eine Uebersichtsseite darf
 * nicht ein Dutzend Discord-Anfragen ausloesen. Die Seite liest den
 * gespeicherten Zustand.
 */
export async function pruefeAlleZiele(
  options: { gateway?: DiscordGateway } = {},
): Promise<{ geprueft: number; ungueltig: number }> {
  const zeilen = await prisma.discordLogChannel.findMany({ where: { enabled: true } });
  let ungueltig = 0;

  for (const zeile of zeilen) {
    const befund = await pruefeKanal(zeile.channelId, options);
    if (befund.ok) {
      await prisma.discordLogChannel.update({
        where: { category: zeile.category },
        data: {
          health: 'HEALTHY',
          healthNote: null,
          checkedAt: new Date(),
          channelName: befund.kanal?.name ?? zeile.channelName,
        },
      });
      continue;
    }
    ungueltig += 1;
    await prisma.discordLogChannel.update({
      where: { category: zeile.category },
      data: { health: 'INVALID', healthNote: befund.grund ?? null, checkedAt: new Date() },
    });
    log.warn('Log-Ziel nicht mehr nutzbar', {
      category: zeile.category,
      grund: befund.grund,
    });
  }

  return { geprueft: zeilen.length, ungueltig };
}

export { kategorie };
