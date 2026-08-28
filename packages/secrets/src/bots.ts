import { bumpConfigRevision, prisma } from '@swisshub/database';
import type { IntegrationBot, IntegrationBotKind, IntegrationHealth } from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { botProvider, BOT_TOKEN_FIELD } from './catalog';
import { deleteProvider, getSecret, setSecret } from './store';
import { validateBotToken, type BotIdentity } from './discord-test';

/**
 * Discord-Bots mit eigenen Zugangsdaten.
 *
 * Der SwissHub-Bot und die Musik-Bots unterscheiden sich für diese Verwaltung
 * nicht: jeder hat einen Namen, eine Anwendungs-ID, ein Token und einen
 * Zustand. Deshalb eine Liste statt fester Felder - «Music Worker 4» soll man
 * hinzufügen können, ohne den Code anzufassen (§36).
 *
 * Das Token steht nie in dieser Tabelle. Es liegt verschlüsselt unter
 * `provider = "bot:<id>"`, damit sich ein einzelnes austauschen lässt, ohne
 * die übrigen zu berühren.
 */

export const SYSTEM_BOT_SLUG = 'SYSTEM_BOT';
export const MUSIC_CONTROLLER_SLUG = 'MUSIC_CONTROLLER';

export interface BotZeile {
  id: string;
  kind: IntegrationBotKind;
  label: string;
  slug: string;
  clientId: string | null;
  botUsername: string | null;
  botUserId: string | null;
  status: IntegrationHealth;
  lastError: string | null;
  lastCheckedAt: Date | null;
  lastLoginAt: Date | null;
  position: number;
  enabled: boolean;
  /** Liegt ein Token vor? Der Wert selbst verlässt den Server nie. */
  hasToken: boolean;
}

function zuZeile(bot: IntegrationBot, hasToken: boolean): BotZeile {
  return {
    id: bot.id,
    kind: bot.kind,
    label: bot.label,
    slug: bot.slug,
    clientId: bot.clientId,
    botUsername: bot.botUsername,
    botUserId: bot.botUserId,
    status: bot.status,
    lastError: bot.lastError,
    lastCheckedAt: bot.lastCheckedAt,
    lastLoginAt: bot.lastLoginAt,
    position: bot.position,
    enabled: bot.enabled,
    hasToken,
  };
}

export async function listBots(): Promise<BotZeile[]> {
  const bots = await prisma.integrationBot.findMany({
    orderBy: [{ kind: 'asc' }, { position: 'asc' }, { label: 'asc' }],
  });
  const tokens = await prisma.integrationSecret.findMany({
    where: { provider: { in: bots.map((bot) => botProvider(bot.id)) }, key: BOT_TOKEN_FIELD },
    select: { provider: true },
  });
  const vorhanden = new Set(tokens.map((eintrag) => eintrag.provider));
  return bots.map((bot) => zuZeile(bot, vorhanden.has(botProvider(bot.id))));
}

export async function getBot(id: string): Promise<BotZeile | null> {
  const bot = await prisma.integrationBot.findUnique({ where: { id } });
  if (!bot) {
    return null;
  }
  const token = await prisma.integrationSecret.findFirst({
    where: { provider: botProvider(bot.id), key: BOT_TOKEN_FIELD },
    select: { id: true },
  });
  return zuZeile(bot, token !== null);
}

/** Das Token eines Bots - ausschliesslich für den Verbindungsaufbau. */
export async function botToken(botId: string): Promise<string | null> {
  return getSecret(botProvider(botId), BOT_TOKEN_FIELD);
}

/** Das Token nach stabilem Kurznamen - so fragt die Laufzeit. */
export async function botTokenBySlug(slug: string): Promise<string | null> {
  const bot = await prisma.integrationBot.findUnique({ where: { slug }, select: { id: true } });
  return bot ? botToken(bot.id) : null;
}

export interface BotEingabe {
  kind: IntegrationBotKind;
  label: string;
  slug: string;
  clientId?: string | null;
  position?: number;
}

export async function createBot(eingabe: BotEingabe, actorDiscordId?: string | null): Promise<BotZeile> {
  const vorhanden = await prisma.integrationBot.findUnique({ where: { slug: eingabe.slug } });
  if (vorhanden) {
    throw conflict(`Es gibt bereits einen Bot mit dem Kurznamen «${eingabe.slug}».`);
  }
  const bot = await prisma.integrationBot.create({
    data: {
      kind: eingabe.kind,
      label: eingabe.label,
      slug: eingabe.slug,
      clientId: eingabe.clientId ?? null,
      position: eingabe.position ?? 0,
      updatedBy: actorDiscordId ?? null,
    },
  });
  await bumpConfigRevision(`integration:bot ${bot.slug} angelegt`, actorDiscordId ?? null);
  return zuZeile(bot, false);
}

export async function updateBot(
  id: string,
  eingabe: Partial<Pick<BotEingabe, 'label' | 'clientId' | 'position'>> & { enabled?: boolean },
  actorDiscordId?: string | null,
): Promise<BotZeile> {
  const bot = await prisma.integrationBot.update({
    where: { id },
    data: {
      ...(eingabe.label !== undefined ? { label: eingabe.label } : {}),
      ...(eingabe.clientId !== undefined ? { clientId: eingabe.clientId } : {}),
      ...(eingabe.position !== undefined ? { position: eingabe.position } : {}),
      ...(eingabe.enabled !== undefined ? { enabled: eingabe.enabled } : {}),
      updatedBy: actorDiscordId ?? null,
    },
  });
  await bumpConfigRevision(`integration:bot ${bot.slug} geändert`, actorDiscordId ?? null);
  const token = await prisma.integrationSecret.findFirst({
    where: { provider: botProvider(id), key: BOT_TOKEN_FIELD },
    select: { id: true },
  });
  return zuZeile(bot, token !== null);
}

export async function deleteBot(id: string, actorDiscordId?: string | null): Promise<void> {
  const bot = await prisma.integrationBot.findUnique({ where: { id } });
  if (!bot) {
    throw notFound('Diesen Bot gibt es nicht.');
  }
  await deleteProvider(botProvider(id), { actorDiscordId });
  await prisma.integrationBot.delete({ where: { id } });
  await bumpConfigRevision(`integration:bot ${bot.slug} entfernt`, actorDiscordId ?? null);
}

export interface RotationsErgebnis {
  ok: boolean;
  /** Nur bei Erfolg: wie Discord den Bot nennt. */
  identity?: BotIdentity;
  /** Bereinigte Meldung - niemals eine Anbieter-Rohantwort. */
  fehler?: string;
}

/**
 * Ein neues Token übernehmen - erst prüfen, dann speichern (§16/§17).
 *
 * Die Reihenfolge ist der ganze Punkt: wird zuerst gespeichert und dann
 * geprüft, hat ein Tippfehler das funktionierende Token bereits gelöscht und
 * der Bot ist draussen. Ein ungültiges Token erreicht die Datenbank hier
 * überhaupt nicht - der alte Wert bleibt unangetastet.
 */
export async function rotateBotToken(
  id: string,
  neuesToken: string,
  actorDiscordId?: string | null,
): Promise<RotationsErgebnis> {
  const bot = await prisma.integrationBot.findUnique({ where: { id } });
  if (!bot) {
    throw notFound('Diesen Bot gibt es nicht.');
  }

  const pruefung = await validateBotToken(neuesToken);
  if (!pruefung.ok) {
    await prisma.integrationBot.update({
      where: { id },
      data: { lastCheckedAt: new Date(), lastError: pruefung.fehler ?? 'Token ungültig' },
    });
    return { ok: false, ...(pruefung.fehler ? { fehler: pruefung.fehler } : {}) };
  }

  await setSecret(botProvider(id), BOT_TOKEN_FIELD, neuesToken, { actorDiscordId });
  await prisma.integrationBot.update({
    where: { id },
    data: {
      status: 'CONNECTED',
      botUsername: pruefung.identity?.username ?? null,
      botUserId: pruefung.identity?.id ?? null,
      clientId: bot.clientId ?? pruefung.identity?.id ?? null,
      lastError: null,
      lastCheckedAt: new Date(),
      lastLoginAt: new Date(),
      updatedBy: actorDiscordId ?? null,
    },
  });

  return { ok: true, ...(pruefung.identity ? { identity: pruefung.identity } : {}) };
}

/** Das hinterlegte Token erneut prüfen und den Zustand nachführen. */
export async function checkBot(id: string): Promise<RotationsErgebnis> {
  const token = await botToken(id);
  if (!token) {
    await prisma.integrationBot.update({
      where: { id },
      data: { status: 'NOT_CONFIGURED', lastCheckedAt: new Date(), lastError: null },
    });
    return { ok: false, fehler: 'Für diesen Bot ist kein Token hinterlegt.' };
  }

  const pruefung = await validateBotToken(token);
  await prisma.integrationBot.update({
    where: { id },
    data: {
      status: pruefung.ok ? 'CONNECTED' : 'ERROR',
      ...(pruefung.ok
        ? {
            botUsername: pruefung.identity?.username ?? null,
            botUserId: pruefung.identity?.id ?? null,
            lastLoginAt: new Date(),
            lastError: null,
          }
        : { lastError: pruefung.fehler ?? 'Token ungültig' }),
      lastCheckedAt: new Date(),
    },
  });
  return pruefung.ok
    ? { ok: true, ...(pruefung.identity ? { identity: pruefung.identity } : {}) }
    : { ok: false, ...(pruefung.fehler ? { fehler: pruefung.fehler } : {}) };
}

/**
 * Den Eintrag für den SwissHub-Bot anlegen, falls er fehlt.
 *
 * Damit die Übersicht auch bei einer bestehenden Installation sofort etwas
 * zeigt und der Systembot dieselbe Behandlung erfährt wie die Musik-Bots.
 * Legt ausdrücklich kein Token an - das kommt aus der Übernahme oder von Hand.
 */
export async function ensureSystemBot(): Promise<BotZeile> {
  const vorhanden = await prisma.integrationBot.findUnique({ where: { slug: SYSTEM_BOT_SLUG } });
  if (vorhanden) {
    return zuZeile(vorhanden, (await botToken(vorhanden.id)) !== null);
  }
  const bot = await prisma.integrationBot.create({
    data: {
      kind: 'SYSTEM',
      label: 'SwissHub System',
      slug: SYSTEM_BOT_SLUG,
      position: 0,
    },
  });
  return zuZeile(bot, false);
}
