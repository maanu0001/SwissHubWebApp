import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel } from '@swisshub/database';
import { discord, resolveGuildId } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { baueKanalName } from '../voice/naming';
import { createTemporaryVoice } from '../voice/service';
import { allowMember } from '../voice/members';
import { VOICE_HUB_MODULE_ID, type VoiceHubSettings } from './config';
import { darfHubNutzen, findeHubZuKanal, type HubMitPreset } from './hubs';

const log = createLogger('voice-hub:join');

/**
 * Was beim Betreten eines Hubs geschieht.
 *
 * Der Ablauf ist bewusst kurz und in dieser Reihenfolge: pruefen, ob es
 * ueberhaupt losgehen darf; nachsehen, ob schon ein Talk existiert; erst dann
 * einen neuen anlegen; und ganz zum Schluss verschieben. Wer den Hub verlaesst,
 * bevor der Kanal steht, bekommt keinen halben Talk, sondern gar keinen - der
 * Kanal wird dann gleich wieder aufgeraeumt.
 */

export type JoinErgebnis =
  | { art: 'ERSTELLT'; kanal: TemporaryVoiceChannel; hub: HubMitPreset }
  | { art: 'VORHANDEN'; kanal: TemporaryVoiceChannel; hub: HubMitPreset }
  | { art: 'ABGELEHNT'; grund: string }
  | { art: 'KEIN_HUB' };

export interface JoinAnfrage {
  discordId: string;
  username: string;
  displayName: string;
  roleIds: string[];
  isBot: boolean;
  /** Der betretene Kanal. */
  channelId: string;
  /** Darf diese Person das Modul ueberhaupt nutzen? */
  darfNutzen: boolean;
}

/**
 * Behandelt das Betreten eines Kanals.
 *
 * Idempotent: laeuft der Aufruf zweimal fuer dasselbe Ereignis, entsteht
 * trotzdem nur ein Talk. Dafuer sorgt der Teilindex in der Datenbank - die
 * zweite Reservierung scheitert dort und wird hier als «schon vorhanden»
 * gelesen.
 */
export async function handleHubJoin(anfrage: JoinAnfrage): Promise<JoinErgebnis> {
  // Bots loesen nichts aus. Ein Musikbot, den jemand in den Hub zieht, soll
  // keinen Talk erben, den er nie verwalten koennte.
  if (anfrage.isBot) {
    return { art: 'KEIN_HUB' };
  }

  const hub = await findeHubZuKanal(anfrage.channelId);
  if (!hub) {
    return { art: 'KEIN_HUB' };
  }

  if (!(await isModuleEnabled(VOICE_HUB_MODULE_ID))) {
    return { art: 'KEIN_HUB' };
  }

  const settings = await getModuleSettings<VoiceHubSettings>(VOICE_HUB_MODULE_ID);
  if (settings.maintenanceMode) {
    return { art: 'ABGELEHNT', grund: 'Der Voice Hub ist gerade im Wartungsmodus.' };
  }

  if (!anfrage.darfNutzen) {
    return { art: 'ABGELEHNT', grund: 'Dir fehlt die Berechtigung, einen Talk zu erstellen.' };
  }

  const rollenPruefung = darfHubNutzen(hub, anfrage.roleIds);
  if (!rollenPruefung.erlaubt) {
    return { art: 'ABGELEHNT', grund: rollenPruefung.grund ?? 'Dieser Hub ist nicht für dich.' };
  }

  const guildId = await resolveGuildId();

  // --- Hat diese Person schon einen Talk? --------------------------------
  const eigene = await prisma.temporaryVoiceChannel.findMany({
    where: {
      guildId,
      ownerDiscordId: anfrage.discordId,
      closedAt: null,
      source: 'VOICE_HUB',
      discordChannelId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Zeilen, deren Kanal es auf Discord nicht mehr gibt, zaehlen nicht mit.
  // Sonst blockierte ein von Hand geloeschter Kanal die Person auf Dauer.
  const lebendige: TemporaryVoiceChannel[] = [];
  for (const kandidat of eigene) {
    const existiert = await discord.managedChannels
      .get(kandidat.discordChannelId!)
      .catch(() => null);
    if (existiert) {
      lebendige.push(kandidat);
    } else {
      await prisma.temporaryVoiceChannel.updateMany({
        where: { id: kandidat.id, closedAt: null },
        data: { closedAt: new Date(), deleteScheduledAt: null },
      });
      log.info('Verwaiste Talk-Zeile beim Beitritt bereinigt', { id: kandidat.id });
    }
  }

  if (lebendige.length >= settings.maxActivePerUser) {
    // Statt eines zweiten Talks zurueck in den eigenen. Das ist fast immer,
    // was gemeint war - und ein zweiter Talk waere ein Kanal, in dem niemand
    // sitzt.
    const ziel = lebendige[0]!;
    await verschiebe(anfrage.discordId, ziel.discordChannelId!, 'Zurück in den eigenen Talk');
    return { art: 'VORHANDEN', kanal: ziel, hub };
  }

  // --- Neuen Talk anlegen -------------------------------------------------
  const vorlieben = settings.userPreferencesEnabled
    ? await prisma.voiceUserPreference.findUnique({
        where: { guildId_discordId: { guildId, discordId: anfrage.discordId } },
      })
    : null;
  const uebernehmen = vorlieben?.applyPreferences === true;

  const name =
    uebernehmen && vorlieben?.preferredName
      ? vorlieben.preferredName
      : baueKanalName(hub.preset.nameTemplate, {
          username: anfrage.username,
          displayName: anfrage.displayName,
        });

  const limit =
    uebernehmen && vorlieben?.preferredLimit !== null && vorlieben?.preferredLimit !== undefined
      ? Math.min(vorlieben.preferredLimit, hub.preset.maxUserLimit)
      : hub.preset.userLimit;

  const bitrate =
    uebernehmen && vorlieben?.preferredBitrate
      ? Math.min(vorlieben.preferredBitrate, settings.maxBitrate)
      : hub.preset.bitrate;

  let kanal: TemporaryVoiceChannel;
  try {
    kanal = await createTemporaryVoice({
      guildId,
      ownerDiscordId: anfrage.discordId,
      ownerUsername: anfrage.displayName || anfrage.username,
      name,
      parentId: hub.preset.targetCategoryId ?? hub.targetCategoryId,
      overflowParentId: hub.overflowCategoryId,
      source: 'VOICE_HUB',
      hubId: hub.id,
      presetId: hub.preset.id,
      userLimit: limit,
      bitrate,
      locked: hub.preset.lockedDefault,
      hidden: hub.preset.hiddenDefault,
      ownerModeration: hub.preset.ownerModeration,
    });
  } catch (error) {
    // Der Teilindex hat zugeschlagen - ein zweites Ereignis fuer denselben
    // Beitritt. Der andere Vorgang legt den Kanal an; hier ist nichts zu tun.
    if (error instanceof AppError && error.code === 'CONFLICT') {
      log.debug('Doppeltes Beitrittsereignis abgefangen', { discordId: anfrage.discordId });
      const schon = await prisma.temporaryVoiceChannel.findFirst({
        where: { guildId, ownerDiscordId: anfrage.discordId, hubId: hub.id, closedAt: null },
      });
      if (schon?.discordChannelId) {
        return { art: 'VORHANDEN', kanal: schon, hub };
      }
      return { art: 'KEIN_HUB' };
    }
    throw error;
  }

  // --- Vertrauenspersonen -------------------------------------------------
  if (settings.trustedMembersEnabled && vorlieben?.autoAllowTrusted) {
    const vertraute = await prisma.voiceTrustedMember.findMany({
      where: { guildId, ownerDiscordId: anfrage.discordId },
      take: 25,
    });
    for (const person of vertraute) {
      await allowMember(
        kanal,
        { discordId: person.discordId, username: person.username },
        { discordId: anfrage.discordId, username: anfrage.username, source: 'DISCORD' },
      ).catch(() => undefined);
    }
  }

  // --- Verschieben --------------------------------------------------------
  const verschoben = await verschiebe(
    anfrage.discordId,
    kanal.discordChannelId!,
    'Eigener Talk erstellt',
  );

  if (!verschoben) {
    // Die Person hat den Hub schon wieder verlassen. Ein leerer Kanal bliebe
    // sonst stehen, bis der Abgleich ihn findet - besser gleich aufraeumen.
    log.info('Talk sofort wieder aufgeräumt: niemand zum Verschieben da', { id: kanal.id });
    const { deleteTemporaryVoice } = await import('../voice/lifecycle');
    await deleteTemporaryVoice(
      kanal,
      { discordId: 'system', username: 'System', source: 'SYSTEM' },
      'Beitritt abgebrochen',
    );
    return { art: 'KEIN_HUB' };
  }

  return { art: 'ERSTELLT', kanal, hub };
}

async function verschiebe(discordId: string, channelId: string, grund: string): Promise<boolean> {
  return discord.members.moveToVoice(discordId, channelId, grund).catch((error: unknown) => {
    log.warn('Mitglied konnte nicht verschoben werden', {
      error: error instanceof Error ? error.message : 'unbekannt',
      discordId,
      channelId,
    });
    return false;
  });
}
