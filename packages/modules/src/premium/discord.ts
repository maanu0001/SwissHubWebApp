import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { PremiumDiscordResource, PremiumEntitlement } from '@swisshub/database';
import { discord, DISCORD_PERMISSIONS } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { getGuildConfig } from '../guild/config';
import { PREMIUM_MODULE_ID, type PremiumSettings } from './config';
import { grantsEntitlements } from './entitlements';

const logger = createLogger('premium:discord');

/**
 * Discord-Anspruechen eines Mitglieds.
 *
 * Der Kern dieses Moduls und die Stelle mit den strengsten Anforderungen:
 *
 *  - Idempotent. Doppelklick, Webhook-Wiederholung, Neustart des Bots und der
 *    regelmaessige Abgleich rufen dieselbe Funktion auf. Sie muss beliebig oft
 *    laufen duerfen, ohne je ein zweites Stuebli anzulegen.
 *  - Abgleichend statt anweisend. Verglichen wird der tatsaechliche
 *    Discord-Zustand mit dem gewuenschten, nicht "was zuletzt passiert ist".
 *  - Ein Discord-Fehler macht niemals eine Zahlung rueckgaengig. Er wird
 *    vermerkt und spaeter erneut versucht.
 */

export interface SyncResult {
  userId: string;
  discordId: string;
  entitlements: PremiumEntitlement[];
  rolesAdded: string[];
  rolesRemoved: string[];
  channelCreated: string | null;
  channelRemoved: string | null;
  channelRepaired: boolean;
  ok: boolean;
  error: string | null;
}

/** Der Kanalname aus der Vorlage. Discord erlaubt hoechstens 100 Zeichen. */
export function stuebliName(template: string, username: string): string {
  const sauber = username
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
  return template.replace('{user}', sauber || 'mitglied').slice(0, 100);
}

/**
 * Die Rechte des Besitzers in seinem eigenen Kanal.
 *
 * Ausschliesslich als Ausnahme auf genau diesem Kanal - niemals als Rolle.
 * Damit gelten sie nirgends sonst auf dem Server. `Administrator`,
 * `Manage Guild`, `Manage Roles`, `Kick` und `Ban` sind nicht dabei und
 * duerfen es auch nie werden: das waeren serverweite Rechte.
 */
export function ownerPermissions(managePermissions: boolean): bigint {
  let allow =
    DISCORD_PERMISSIONS.VIEW_CHANNEL |
    DISCORD_PERMISSIONS.CONNECT |
    DISCORD_PERMISSIONS.SPEAK |
    DISCORD_PERMISSIONS.STREAM |
    DISCORD_PERMISSIONS.USE_VAD |
    DISCORD_PERMISSIONS.PRIORITY_SPEAKER |
    DISCORD_PERMISSIONS.MUTE_MEMBERS |
    DISCORD_PERMISSIONS.DEAFEN_MEMBERS |
    DISCORD_PERMISSIONS.MOVE_MEMBERS |
    DISCORD_PERMISSIONS.MANAGE_CHANNELS;

  if (managePermissions) {
    allow |= DISCORD_PERMISSIONS.MANAGE_ROLES;
  }
  return allow;
}

interface GewuenschterZustand {
  entitlements: Set<PremiumEntitlement>;
  premiumRoleId: string | null;
  stuebliRoleId: string | null;
  bundleRoleId: string | null;
  categoryId: string | null;
  settings: PremiumSettings;
}

/** Was das Mitglied laut Datenbank haben soll. */
async function gewuenscht(userId: string): Promise<GewuenschterZustand> {
  const settings = await getModuleSettings<PremiumSettings>(PREMIUM_MODULE_ID);
  const subscription = await prisma.premiumSubscription.findFirst({
    where: { userId, activeUserKey: { not: null } },
    include: { product: true },
  });

  const entitlements = new Set<PremiumEntitlement>();
  if (subscription && grantsEntitlements(subscription.status)) {
    for (const entitlement of subscription.product.entitlements) {
      entitlements.add(entitlement);
    }
  }

  return {
    entitlements,
    premiumRoleId: settings.premiumRoleId,
    stuebliRoleId: settings.stuebliRoleId,
    // Die Bundle-Rolle bekommt, wer beide Ansprüche hat.
    bundleRoleId:
      entitlements.has('PREMIUM_ROLE') && entitlements.has('PREMIUM_STUEBLI_ROLE')
        ? settings.bundleRoleId
        : null,
    categoryId: settings.stuebliCategoryId,
    settings,
  };
}

/**
 * Gleicht Rollen und Stuebli eines Mitglieds mit Discord ab.
 *
 * Sicher gegen parallele Aufrufe: die Ressourcenzeile wird gesperrt, bevor
 * irgendetwas auf Discord passiert. Zwei gleichzeitige Syncs reihen sich damit
 * auf, statt zwei Kanaele anzulegen.
 */
export async function syncDiscordEntitlements(userId: string): Promise<SyncResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error(`Benutzer ${userId} nicht gefunden`);
  }

  const ergebnis: SyncResult = {
    userId,
    discordId: user.discordId,
    entitlements: [],
    rolesAdded: [],
    rolesRemoved: [],
    channelCreated: null,
    channelRemoved: null,
    channelRepaired: false,
    ok: true,
    error: null,
  };

  try {
    const ziel = await gewuenscht(userId);
    ergebnis.entitlements = [...ziel.entitlements];

    await syncRoles(user.discordId, ziel, ergebnis);
    await syncStuebli(user.id, user.discordId, user.username, ziel, ergebnis);

    await prisma.premiumSubscription.updateMany({
      where: { userId, activeUserKey: { not: null } },
      data: { discordSyncStatus: 'SYNCED', lastSyncAt: new Date(), lastSyncError: null },
    });
  } catch (error) {
    // Ein Discord-Fehler darf die Zahlung nicht anfassen. Er wird vermerkt,
    // der naechste Durchgang versucht es erneut.
    ergebnis.ok = false;
    ergebnis.error = error instanceof Error ? error.message : String(error);
    await prisma.premiumSubscription.updateMany({
      where: { userId, activeUserKey: { not: null } },
      data: { discordSyncStatus: 'FAILED', lastSyncAt: new Date(), lastSyncError: ergebnis.error },
    });
    logger.warn('Discord-Abgleich fehlgeschlagen', { userId, error: ergebnis.error });
  }

  return ergebnis;
}

/** Rollen setzen bzw. entziehen - jede einzeln, damit ein Fehler nicht alles kippt. */
async function syncRoles(
  discordId: string,
  ziel: GewuenschterZustand,
  ergebnis: SyncResult,
): Promise<void> {
  const member = await discord.members.get(discordId);
  if (!member) {
    // Kein Mitglied mehr auf dem Server - es gibt keine Rolle zu setzen.
    return;
  }
  const vorhanden = new Set(member.roleIds);

  const zuordnung: Array<{ roleId: string | null; soll: boolean }> = [
    { roleId: ziel.premiumRoleId, soll: ziel.entitlements.has('PREMIUM_ROLE') },
    { roleId: ziel.stuebliRoleId, soll: ziel.entitlements.has('PREMIUM_STUEBLI_ROLE') },
    { roleId: ziel.settings.bundleRoleId, soll: ziel.bundleRoleId !== null },
  ];

  for (const { roleId, soll } of zuordnung) {
    if (!roleId) {
      continue;
    }
    if (soll && !vorhanden.has(roleId)) {
      await discord.roles.add(discordId, roleId, 'SwissHub Premium');
      ergebnis.rolesAdded.push(roleId);
    } else if (!soll && vorhanden.has(roleId)) {
      await discord.roles.remove(discordId, roleId, 'SwissHub Premium abgelaufen');
      ergebnis.rolesRemoved.push(roleId);
    }
  }
}

/**
 * Genau ein Stuebli.
 *
 * Die Eindeutigkeit haengt an drei Dingen, die zusammenwirken muessen:
 *
 *  1. dem eindeutigen Schluessel `(userId, resourceType)` in der Datenbank,
 *  2. der Zeilensperre, die parallele Aufrufe aufreiht,
 *  3. der Pruefung, ob der eingetragene Kanal auf Discord ueberhaupt noch
 *     existiert - sonst entstuende bei jedem Lauf ein neuer.
 */
async function syncStuebli(
  userId: string,
  discordId: string,
  username: string,
  ziel: GewuenschterZustand,
  ergebnis: SyncResult,
): Promise<void> {
  const soll = ziel.entitlements.has('PRIVATE_VOICE');
  const guild = await getGuildConfig();
  const guildId = guild.guildId ?? '';

  // Gesperrt wird die Benutzerzeile, nicht die Ressourcenzeile.
  //
  // Das ist der Unterschied zwischen "reiht sich auf" und "faellt in den
  // eindeutigen Schluessel": beim ersten Abgleich gibt es die Ressourcenzeile
  // noch nicht, und `FOR UPDATE` auf eine leere Treffermenge sperrt nichts.
  // Zehn gleichzeitige Abgleiche saehen dann alle "nichts da" und wollten alle
  // anlegen - neun scheiterten am Schluessel und meldeten einen fehlerhaften
  // Sync, obwohl gar nichts falsch war. Die Benutzerzeile existiert immer.
  const resource = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const vorhanden = await tx.premiumDiscordResource.findUnique({
      where: { userId_resourceType: { userId, resourceType: 'PREMIUM_STUEBLI_VOICE' } },
    });
    if (vorhanden || !soll) {
      return vorhanden;
    }
    return tx.premiumDiscordResource.create({
      data: {
        userId,
        discordId,
        guildId,
        resourceType: 'PREMIUM_STUEBLI_VOICE',
        discordCategoryId: ziel.categoryId,
        state: 'PENDING',
      },
    });
  });

  if (!soll) {
    if (resource && resource.state !== 'REMOVED') {
      await removeStuebli(resource, ergebnis);
    }
    return;
  }

  if (!resource) {
    return;
  }
  if (!ziel.categoryId) {
    throw new Error('Es ist keine Kategorie für die Stübli konfiguriert.');
  }

  // Existiert der eingetragene Kanal wirklich noch?
  const bestehend = resource.discordResourceId
    ? await discord.voice.get(resource.discordResourceId)
    : null;

  if (!bestehend) {
    const name = stuebliName(ziel.settings.stuebliNameTemplate, username);
    const channel = await discord.voice.create({
      name,
      parentId: ziel.categoryId,
      userLimit: ziel.settings.stuebliUserLimit > 0 ? ziel.settings.stuebliUserLimit : null,
      overwrites: [
        {
          id: discordId,
          type: 1,
          allow: ownerPermissions(ziel.settings.stuebliOwnerManagePermissions),
          deny: 0n,
        },
      ],
      reason: 'SwissHub Premium-Stübli',
    });
    await prisma.premiumDiscordResource.update({
      where: { id: resource.id },
      data: {
        discordResourceId: channel.id,
        discordCategoryId: ziel.categoryId,
        name,
        state: 'ACTIVE',
        lastSyncAt: new Date(),
        lastSyncError: null,
        removedAt: null,
      },
    });
    ergebnis.channelCreated = channel.id;
    logger.info('Stübli angelegt', { userId, channelId: channel.id });
    return;
  }

  // Der Kanal existiert - stimmen Kategorie und Rechte noch?
  let repariert = false;
  if (bestehend.parentId !== ziel.categoryId) {
    // Der Kanal wurde von Hand aus der Kategorie geschoben. Er gehört zurück -
    // sonst steht ein bezahltes Stübli irgendwo im Server herum.
    await discord.voice.move(bestehend.id, ziel.categoryId, 'SwissHub Premium-Stübli');
    repariert = true;
  }

  const eigen = bestehend.overwrites?.find((entry) => entry.id === discordId);
  const erwartet = ownerPermissions(ziel.settings.stuebliOwnerManagePermissions);
  if (!eigen || (BigInt(eigen.allow) & erwartet) !== erwartet) {
    await discord.voice.setOverwrite(
      bestehend.id,
      { id: discordId, type: 1, allow: erwartet, deny: 0n },
      'SwissHub Premium-Stübli: Rechte wiederhergestellt',
    );
    repariert = true;
  }

  await prisma.premiumDiscordResource.update({
    where: { id: resource.id },
    data: {
      state: 'ACTIVE',
      discordCategoryId: bestehend.parentId ?? ziel.categoryId,
      lastSyncAt: new Date(),
      lastSyncError: null,
    },
  });
  ergebnis.channelRepaired = repariert;
}

/** Entfernt das Stuebli, sobald der Anspruch endgueltig entfallen ist. */
async function removeStuebli(resource: PremiumDiscordResource, ergebnis: SyncResult): Promise<void> {
  await prisma.premiumDiscordResource.update({
    where: { id: resource.id },
    data: { state: 'REMOVING' },
  });

  if (resource.discordResourceId) {
    const vorhanden = await discord.voice.get(resource.discordResourceId);
    if (vorhanden) {
      await discord.voice.remove(resource.discordResourceId, 'SwissHub Premium abgelaufen');
      ergebnis.channelRemoved = resource.discordResourceId;
    }
  }

  await prisma.premiumDiscordResource.update({
    where: { id: resource.id },
    data: { state: 'REMOVED', removedAt: new Date(), lastSyncAt: new Date(), lastSyncError: null },
  });
  logger.info('Stübli entfernt', { userId: resource.userId, channelId: resource.discordResourceId });
}

/** Das Stuebli eines Mitglieds - fuer Oberflaechen. */
export async function getStuebli(userId: string): Promise<PremiumDiscordResource | null> {
  return prisma.premiumDiscordResource.findUnique({
    where: { userId_resourceType: { userId, resourceType: 'PREMIUM_STUEBLI_VOICE' } },
  });
}

/** Abgleich von Hand, mit Protokolleintrag. */
export async function manualSync(
  userId: string,
  actor: { discordId: string; username: string },
): Promise<SyncResult> {
  const ergebnis = await syncDiscordEntitlements(userId);
  await safeRecordAudit({
    action: AUDIT_ACTIONS.PREMIUM_MANUAL_SYNC,
    module: PREMIUM_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: ergebnis.discordId,
    success: ergebnis.ok,
    metadata: {
      rollenGesetzt: ergebnis.rolesAdded.length,
      rollenEntfernt: ergebnis.rolesRemoved.length,
      kanalAngelegt: ergebnis.channelCreated !== null,
      kanalRepariert: ergebnis.channelRepaired,
    },
  });
  return ergebnis;
}
