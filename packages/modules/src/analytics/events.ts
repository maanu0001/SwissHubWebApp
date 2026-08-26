import { prisma } from '@swisshub/database';
import type {
  DiscordActorSource,
  DiscordEvent,
  DiscordEventCategory,
  DiscordEventSeverity,
  Prisma,
} from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { sanitizeText } from '@swisshub/shared';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { ANALYTICS_MODULE_ID, type AnalyticsSettings } from './config';
import { verknuepfeMitMassnahme } from './dedup';

const log = createLogger('analytics:events');

/**
 * Die Aufnahme eines Ereignisses.
 *
 * Zwei Grundsaetze stehen ueber allem:
 *
 * 1. **Kein erfundener Verursacher.** Discord nennt bei einer geloeschten
 *    Nachricht nicht, wer sie geloescht hat. Wer das errät, schreibt eine
 *    Vermutung in ein Protokoll, und ein Protokoll, das raet, ist schlimmer
 *    als keines: es sieht aus wie ein Beweis. Bleibt `actorSource` auf
 *    `UNKNOWN`, sagt die Oberflaeche «unbekannt».
 * 2. **Die Aufnahme darf nie den Auslöser stoeren.** Faellt das Protokoll
 *    aus, laeuft der Bot weiter. Deshalb faengt `recordEvent` selbst und wirft
 *    nicht - eine misslungene Protokollzeile darf keine Nachricht verschlucken
 *    und keinen Voice-Beitritt scheitern lassen.
 */

/** Feiner Ereignistyp. Als String, damit neue Arten keinen Enum-Umbau erzwingen. */
export const EVENT_TYPES = {
  MESSAGE_EDIT: 'MESSAGE_EDIT',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  MESSAGE_BULK_DELETE: 'MESSAGE_BULK_DELETE',

  VOICE_JOIN: 'VOICE_JOIN',
  VOICE_LEAVE: 'VOICE_LEAVE',
  VOICE_MOVE: 'VOICE_MOVE',

  MEMBER_JOIN: 'MEMBER_JOIN',
  MEMBER_LEAVE: 'MEMBER_LEAVE',
  MEMBER_ROLE_ADD: 'MEMBER_ROLE_ADD',
  MEMBER_ROLE_REMOVE: 'MEMBER_ROLE_REMOVE',
  MEMBER_NICKNAME: 'MEMBER_NICKNAME',
  MEMBER_TIMEOUT: 'MEMBER_TIMEOUT',
  MEMBER_TIMEOUT_END: 'MEMBER_TIMEOUT_END',
  MEMBER_BAN: 'MEMBER_BAN',
  MEMBER_UNBAN: 'MEMBER_UNBAN',

  ROLE_CREATE: 'ROLE_CREATE',
  ROLE_UPDATE: 'ROLE_UPDATE',
  ROLE_DELETE: 'ROLE_DELETE',

  CHANNEL_CREATE: 'CHANNEL_CREATE',
  CHANNEL_UPDATE: 'CHANNEL_UPDATE',
  CHANNEL_DELETE: 'CHANNEL_DELETE',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** Wie lang ein gespeicherter Nachrichtentext hoechstens wird. */
const MAX_CONTENT = 4000;

/**
 * Ereignisse, die von einer Massnahme dieses Dashboards stammen koennen.
 *
 * Nur fuer sie wird nachgeschlagen - ein Kanalwechsel im Voice hat nie eine
 * Moderationsmassnahme als Ursache, und eine Abfrage dafuer waere reine Last.
 */
const VERKNUEPFBAR = new Set<string>([
  'MEMBER_BAN',
  'MEMBER_UNBAN',
  'MEMBER_LEAVE',
  'MEMBER_TIMEOUT',
  'MEMBER_TIMEOUT_END',
]);

export interface RecordEventInput {
  guildId: string;
  category: DiscordEventCategory;
  type: EventType | string;
  severity?: DiscordEventSeverity;

  actorDiscordId?: string | null;
  actorUsername?: string | null;
  /** Ohne ausdrueckliche Quelle bleibt der Verursacher unbekannt. */
  actorSource?: DiscordActorSource;

  subjectDiscordId?: string | null;
  subjectUsername?: string | null;

  channelId?: string | null;
  channelName?: string | null;
  messageId?: string | null;

  contentBefore?: string | null;
  contentAfter?: string | null;

  moderationActionId?: string | null;
  bulkId?: string | null;

  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
}

function kuerze(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) {
    return null;
  }
  const sauber = sanitizeText(wert, MAX_CONTENT);
  // Ein leerer Text ist etwas anderes als kein Text: eine Nachricht, die nur
  // aus einem Bild bestand, hatte tatsaechlich keinen Inhalt.
  return sauber;
}

/**
 * Schreibt ein Ereignis.
 *
 * Liefert den Eintrag oder `null`, wenn nichts geschrieben wurde - weil das
 * Modul aus ist, die Art nicht aufgezeichnet wird, oder das Schreiben
 * fehlschlug. Der Aufrufer muss den Unterschied nicht kennen; er soll nur
 * nicht abbrechen.
 */
export async function recordEvent(input: RecordEventInput): Promise<DiscordEvent | null> {
  try {
    if (!(await isModuleEnabled(ANALYTICS_MODULE_ID))) {
      return null;
    }
    const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
    if (!istAufzuzeichnen(input, settings)) {
      return null;
    }

    // Inhalt nur, wenn er ausdruecklich gespeichert werden soll. Die
    // Einstellung wirkt hier und nicht erst in der Anzeige: was nicht in der
    // Datenbank steht, kann auch nicht versehentlich sichtbar werden.
    const inhalteErlaubt = settings.storeMessageContent;

    const eintrag = await prisma.discordEvent.create({
      data: {
        guildId: input.guildId,
        category: input.category,
        type: input.type,
        severity: input.severity ?? 'INFO',
        actorDiscordId: input.actorDiscordId ?? null,
        actorUsername: input.actorUsername ?? null,
        // Ein Verursacher ohne belegte Quelle ist eine Vermutung - und die
        // wird hier nicht zur Tatsache gemacht.
        actorSource: input.actorDiscordId ? (input.actorSource ?? 'UNKNOWN') : 'UNKNOWN',
        subjectDiscordId: input.subjectDiscordId ?? null,
        subjectUsername: input.subjectUsername ?? null,
        channelId: input.channelId ?? null,
        channelName: input.channelName ?? null,
        messageId: input.messageId ?? null,
        contentBefore: inhalteErlaubt ? kuerze(input.contentBefore) : null,
        contentAfter: inhalteErlaubt ? kuerze(input.contentAfter) : null,
        moderationActionId: input.moderationActionId ?? null,
        bulkId: input.bulkId ?? null,
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ?? new Date(),
      },
    });

    // Kam das Ereignis von einer Massnahme aus diesem Dashboard, wird es
    // damit verknuepft - beide Zeilen bleiben, aber die Zeitleiste weiss,
    // dass es ein Geschehen war. Schlaegt der Abgleich fehl, bleibt der
    // Eintrag wie er ist; das ist kein Grund, ihn zu verwerfen.
    if (VERKNUEPFBAR.has(input.type)) {
      await verknuepfeMitMassnahme(eintrag.id);
    }

    return eintrag;
  } catch (error) {
    // Bewusst nur eine Warnung: das Protokoll ist wichtig, aber nicht so
    // wichtig, dass sein Ausfall den Betrieb anhaelt.
    log.warn('Ereignis konnte nicht protokolliert werden', { type: input.type, error });
    return null;
  }
}

/** Filtert nach den Einstellungen - Kategorie, ausgenommene Kanaele, Bots. */
function istAufzuzeichnen(input: RecordEventInput, settings: AnalyticsSettings): boolean {
  if (input.channelId && settings.ignoredChannelIds.includes(input.channelId)) {
    return false;
  }
  switch (input.category) {
    case 'MESSAGE':
      return settings.logMessages;
    case 'VOICE':
      return settings.logVoice;
    case 'MEMBER':
      return settings.logMembers;
    case 'ROLE':
    case 'CHANNEL':
    case 'SERVER':
      return settings.logAdmin;
    default:
      return true;
  }
}

// --- Nachrichtenstand -------------------------------------------------------

export interface MessageSnapshotInput {
  messageId: string;
  guildId: string;
  channelId: string;
  authorDiscordId: string;
  authorUsername: string;
  content: string;
  attachmentCount?: number;
  replyToMessageId?: string | null;
  postedAt: Date;
}

/**
 * Haelt den letzten bekannten Stand einer Nachricht fest.
 *
 * Discord liefert beim Loeschen nur die Kennung. Ohne diesen Stand stuende im
 * Protokoll «eine Nachricht wurde geloescht» - eine Zeile, die niemandem
 * hilft.
 */
export async function rememberMessage(input: MessageSnapshotInput): Promise<void> {
  try {
    if (!(await isModuleEnabled(ANALYTICS_MODULE_ID))) {
      return;
    }
    const settings = await getModuleSettings<AnalyticsSettings>(ANALYTICS_MODULE_ID);
    if (!settings.logMessages || !settings.storeMessageContent) {
      return;
    }
    if (settings.ignoredChannelIds.includes(input.channelId)) {
      return;
    }

    const daten = {
      guildId: input.guildId,
      channelId: input.channelId,
      authorDiscordId: input.authorDiscordId,
      authorUsername: sanitizeText(input.authorUsername, 100),
      content: sanitizeText(input.content, MAX_CONTENT),
      attachmentCount: input.attachmentCount ?? 0,
      replyToMessageId: input.replyToMessageId ?? null,
      postedAt: input.postedAt,
    };

    await prisma.discordMessageSnapshot.upsert({
      where: { messageId: input.messageId },
      create: { messageId: input.messageId, ...daten },
      update: daten,
    });
  } catch (error) {
    log.warn('Nachrichtenstand konnte nicht gesichert werden', { error });
  }
}

/** Der letzte bekannte Stand - `null`, wenn wir die Nachricht nie gesehen haben. */
export async function recallMessage(messageId: string) {
  return prisma.discordMessageSnapshot.findUnique({ where: { messageId } }).catch(() => null);
}

/** Vergisst einen Stand, sobald das zugehoerige Ereignis geschrieben ist. */
export async function forgetMessage(messageId: string): Promise<void> {
  await prisma.discordMessageSnapshot.deleteMany({ where: { messageId } }).catch(() => undefined);
}
