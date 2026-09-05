import { bumpConfigRevision, prisma } from '@swisshub/database';
import type { IntegrationBot, IntegrationBotKind, IntegrationHealth } from '@swisshub/database';
import { conflict, notFound } from '@swisshub/shared';
import { botProvider, BOT_TOKEN_FIELD, DISCORD_INTEGRATION_ID } from './catalog';
import { deleteProvider, getSecret, hasSecret, setSecret } from './store';
import { validateBotToken, type BotIdentity } from './discord-test';

/**
 * Discord-Bots mit eigenen Zugangsdaten.
 *
 * Zwei Arten, und der Unterschied liegt beim Token:
 *
 * - **Der Systembot** ist die SwissHub-Anwendung selbst. Sein Token steht
 *   nicht hier, sondern unter Integrationen → Discord - es ist dasselbe, mit
 *   dem sich der Bot am Gateway anmeldet. Ein zweites Feld dafür wäre
 *   derselbe Wert an zwei Stellen, und zwei Stellen laufen auseinander.
 *   Er dient zugleich als Musik-Controller.
 * - **Musik-Worker** sind eigene Discord-Anwendungen mit eigenem Token. Sie
 *   werden hier angelegt, geprüft und ausgetauscht; «Music Worker 4» soll man
 *   hinzufügen können, ohne den Code anzufassen.
 *
 * Ein Worker-Token steht nie in dieser Tabelle. Es liegt verschlüsselt unter
 * `provider = "bot:<id>"`, damit sich ein einzelnes austauschen lässt, ohne
 * die übrigen zu berühren.
 */

export const SYSTEM_BOT_SLUG = 'SYSTEM_BOT';

/** Der Systembot verwaltet sein Token nicht selbst - es ist das der Anwendung. */
export const istSystemBot = (bot: { kind: IntegrationBotKind }): boolean => bot.kind === 'SYSTEM';

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

/**
 * Liegt für diesen Bot ein Token vor?
 *
 * Beim Systembot ist das die Frage nach dem Bot-Token der Anwendung; bei
 * einem Worker die nach seinem eigenen. Beide Male nur «ja» oder «nein» -
 * der Wert selbst wird hier nicht angefasst.
 */
async function hatToken(bot: { id: string; kind: IntegrationBotKind }): Promise<boolean> {
  if (istSystemBot(bot)) {
    return hasSecret(DISCORD_INTEGRATION_ID, 'botToken');
  }
  const zeile = await prisma.integrationSecret.findFirst({
    where: { provider: botProvider(bot.id), key: BOT_TOKEN_FIELD },
    select: { id: true },
  });
  return zeile !== null;
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
  const systembotHatToken = await hasSecret(DISCORD_INTEGRATION_ID, 'botToken').catch(() => false);

  return bots.map((bot) =>
    zuZeile(bot, istSystemBot(bot) ? systembotHatToken : vorhanden.has(botProvider(bot.id))),
  );
}

export async function getBot(id: string): Promise<BotZeile | null> {
  const bot = await prisma.integrationBot.findUnique({ where: { id } });
  if (!bot) {
    return null;
  }
  return zuZeile(bot, await hatToken(bot));
}

/**
 * Das Token eines Bots - ausschliesslich für den Verbindungsaufbau.
 *
 * Der Systembot verweist auf das Token der Anwendung. Damit benutzt der
 * Musik-Controller dasselbe Konto wie der Bot selbst und braucht keine eigene
 * Discord-Anwendung mehr.
 */
export async function botToken(botId: string): Promise<string | null> {
  const bot = await prisma.integrationBot.findUnique({
    where: { id: botId },
    select: { kind: true },
  });
  if (bot && istSystemBot(bot)) {
    return getSecret(DISCORD_INTEGRATION_ID, 'botToken');
  }
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
  // Der Systembot ist die Anwendung selbst - es gibt genau einen, und er
  // entsteht beim Start, nicht von Hand. Ein Controller mit eigener
  // Anwendung wird nicht mehr angelegt: diese Rolle hat der Systembot.
  if (eingabe.kind !== 'MUSIC_WORKER') {
    throw conflict('Hier lassen sich ausschliesslich Musik-Worker anlegen.');
  }
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
  if (istSystemBot(bot)) {
    throw conflict('Der Systembot lässt sich nicht entfernen - er ist die SwissHub-Anwendung selbst.');
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
  if (istSystemBot(bot)) {
    // Sonst laege derselbe Token an zwei Stellen, und beim naechsten Wechsel
    // wuerde eine davon vergessen.
    throw conflict('Das Token des Systembots wird unter Integrationen → Discord gepflegt, nicht hier.');
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
 * zeigt. Legt ausdrücklich kein Token an: der Systembot benutzt das der
 * Anwendung aus Integrationen → Discord, und dasselbe Token dient der
 * Musik-Laufzeit als Controller.
 */
export async function ensureSystemBot(): Promise<BotZeile> {
  const vorhanden = await prisma.integrationBot.findUnique({ where: { slug: SYSTEM_BOT_SLUG } });
  if (vorhanden) {
    return zuZeile(vorhanden, (await botToken(vorhanden.id)) !== null);
  }
  const bot = await prisma.integrationBot.create({
    data: {
      kind: 'SYSTEM',
      label: 'SwissHub System (auch Musik-Controller)',
      slug: SYSTEM_BOT_SLUG,
      position: 0,
    },
  });
  return zuZeile(bot, false);
}
