import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel, VoiceAccessKind } from '@swisshub/database';
import { discord, DISCORD_PERMISSIONS } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { besitzerRechte, TEILNEHMER_ERLAUBT } from './permissions';
import { schreibeEreignis, type VoiceActor } from './service';

const log = createLogger('voice:members');

/**
 * Wer einen Talk betreten darf - und wer nicht.
 *
 * Zwei Listen, beide persoenlich: eine Erlaubnis sticht Sperre und
 * Sichtbarkeit, ein Verbot sticht alles. Beides sind Kanalausnahmen und wirken
 * ausschliesslich in diesem einen Kanal.
 */

/** Bits, die dieses Modul an einzelne Mitglieder vergibt oder entzieht. */
const MITGLIED_VERWALTET =
  DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.CONNECT | DISCORD_PERMISSIONS.SPEAK;

/**
 * Gibt einer Person Zutritt.
 *
 * Sie kommt danach auch in einen gesperrten oder versteckten Talk - genau
 * dafuer ist die Liste da.
 */
export async function allowMember(
  kanal: TemporaryVoiceChannel,
  ziel: { discordId: string; username?: string | null },
  actor: VoiceActor,
): Promise<void> {
  await setzeZugriff(kanal, ziel, 'ALLOW', actor);
}

/**
 * Sperrt eine Person aus.
 *
 * Wer schon drin sitzt, wird dadurch nicht hinausgeworfen - das ist ein
 * eigener Schritt und eine eigene Entscheidung. Die Oberflaeche fragt danach.
 */
export async function denyMember(
  kanal: TemporaryVoiceChannel,
  ziel: { discordId: string; username?: string | null },
  actor: VoiceActor,
): Promise<void> {
  if (ziel.discordId === kanal.ownerDiscordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Du kannst dich nicht aus deinem eigenen Talk sperren.',
    });
  }
  await setzeZugriff(kanal, ziel, 'DENY', actor);
}

async function setzeZugriff(
  kanal: TemporaryVoiceChannel,
  ziel: { discordId: string; username?: string | null },
  kind: VoiceAccessKind,
  actor: VoiceActor,
): Promise<void> {
  if (!kanal.discordChannelId) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Talk wird gerade erst erstellt.' });
  }

  const erlaubt = kind === 'ALLOW' ? TEILNEHMER_ERLAUBT & MITGLIED_VERWALTET : 0n;
  const verboten = kind === 'DENY' ? MITGLIED_VERWALTET : 0n;

  await discord.managedChannels.setOverwrite(
    kanal.discordChannelId,
    { id: ziel.discordId, type: 1, allow: erlaubt, deny: verboten },
    kind === 'ALLOW' ? `Zutritt erteilt von ${actor.username}` : `Gesperrt von ${actor.username}`,
  );

  await prisma.temporaryVoiceAccess.upsert({
    where: { channelId_discordId: { channelId: kanal.id, discordId: ziel.discordId } },
    create: {
      channelId: kanal.id,
      discordId: ziel.discordId,
      username: ziel.username ?? null,
      kind,
    },
    update: { kind, username: ziel.username ?? null },
  });

  await schreibeEreignis(kanal, kind === 'ALLOW' ? 'MEMBER_ALLOWED' : 'MEMBER_DENIED', actor, {
    ziel: ziel.discordId,
  });
}

/** Nimmt eine persoenliche Ausnahme wieder zurueck. */
export async function clearMemberAccess(
  kanal: TemporaryVoiceChannel,
  discordId: string,
  actor: VoiceActor,
): Promise<void> {
  if (!kanal.discordChannelId) {
    return;
  }
  if (discordId === kanal.ownerDiscordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Rechte des Besitzers lassen sich nicht entfernen.',
    });
  }

  await discord.managedChannels
    .clearOverwrite(kanal.discordChannelId, discordId, `Ausnahme entfernt von ${actor.username}`)
    .catch((error: unknown) => {
      log.warn('Ausnahme konnte nicht entfernt werden', {
        error: error instanceof Error ? error.message : 'unbekannt',
        channelId: kanal.discordChannelId,
      });
    });

  await prisma.temporaryVoiceAccess
    .delete({ where: { channelId_discordId: { channelId: kanal.id, discordId } } })
    .catch(() => undefined);
}

/**
 * Wirft jemanden aus dem Sprachkanal.
 *
 * Ausdruecklich kein Serverbann und kein Kick vom Server: die Person wird nur
 * aus diesem Kanal getrennt. Wer sie dauerhaft draussen halten will, sperrt
 * sie zusaetzlich - das ist ein eigener Knopf.
 */
export async function kickMember(
  kanal: TemporaryVoiceChannel,
  discordId: string,
  actor: VoiceActor,
): Promise<boolean> {
  if (discordId === kanal.ownerDiscordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Du kannst dich nicht selbst aus deinem Talk werfen.',
    });
  }

  // Nur trennen, wer wirklich in *diesem* Kanal sitzt. Ohne diese Pruefung
  // koennte der Besitzer eines Talks jemanden aus einem fremden Kanal
  // trennen, indem er eine beliebige Kennung schickt.
  const anwesend = await prisma.voicePresence.findFirst({
    where: { discordId, channelId: kanal.discordChannelId ?? '' },
    select: { discordId: true },
  });
  if (!anwesend) {
    return false;
  }

  const getrennt = await discord.members
    .disconnectFromVoice(discordId, `Aus dem Talk entfernt von ${actor.username}`)
    .catch(() => false);

  if (getrennt) {
    await schreibeEreignis(kanal, 'MEMBER_KICKED', actor, { ziel: discordId });
  }
  return getrennt;
}

/**
 * Uebergibt den Talk an jemand anderen.
 *
 * Zuerst die Rechte auf Discord, dann die Zeile - und die Zeile nur, wenn
 * Discord mitgespielt hat. Andersherum haette die Anwendung einen neuen
 * Besitzer, der im Kanal nichts darf.
 */
export async function transferOwnership(
  kanal: TemporaryVoiceChannel,
  neuerBesitzer: { discordId: string; username: string },
  actor: VoiceActor,
  optionen: { ownerModeration?: boolean; automatisch?: boolean } = {},
): Promise<TemporaryVoiceChannel> {
  if (neuerBesitzer.discordId === kanal.ownerDiscordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Person besitzt den Talk bereits.',
    });
  }
  if (!kanal.discordChannelId) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Talk wird gerade erst erstellt.' });
  }

  const mitglied = await discord.members.get(neuerBesitzer.discordId).catch(() => null);
  if (mitglied?.isBot) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Ein Bot kann keinen Talk besitzen.',
    });
  }

  const rechte = besitzerRechte(optionen.ownerModeration ?? true);
  await discord.managedChannels.setOverwrite(
    kanal.discordChannelId,
    { id: neuerBesitzer.discordId, type: 1, allow: rechte, deny: 0n },
    `Talk übergeben von ${actor.username}`,
  );

  // Die Zeile nur aendern, wenn der Besitzer noch der erwartete ist. Zwei
  // gleichzeitige Uebergaben duerfen nicht beide gewinnen.
  const { count } = await prisma.temporaryVoiceChannel.updateMany({
    where: { id: kanal.id, ownerDiscordId: kanal.ownerDiscordId, closedAt: null },
    data: {
      ownerDiscordId: neuerBesitzer.discordId,
      ownerUsername: neuerBesitzer.username.slice(0, 64),
      ownerLeftAt: null,
      lastActiveAt: new Date(),
    },
  });

  if (count === 0) {
    // Jemand war schneller. Die eben gesetzten Rechte schaden nicht - sie
    // machen den Betreffenden zum Teilnehmer mit Zusatzrechten, nicht zum
    // Besitzer.
    throw new AppError('CONFLICT', {
      userMessage: 'Der Talk wurde soeben schon übergeben. Lade die Seite neu.',
    });
  }

  // Dem bisherigen Besitzer die Sonderrechte nehmen - er bleibt gewoehnlicher
  // Teilnehmer.
  await discord.managedChannels
    .setOverwrite(
      kanal.discordChannelId,
      { id: kanal.ownerDiscordId, type: 1, allow: TEILNEHMER_ERLAUBT, deny: 0n },
      'Nicht mehr Besitzer',
    )
    .catch(() => undefined);

  const aktualisiert = await prisma.temporaryVoiceChannel.findUniqueOrThrow({
    where: { id: kanal.id },
  });

  await schreibeEreignis(
    aktualisiert,
    optionen.automatisch ? 'OWNER_AUTO_TRANSFERRED' : 'OWNER_TRANSFERRED',
    actor,
    { von: kanal.ownerDiscordId, an: neuerBesitzer.discordId },
  );

  log.info('Talk übergeben', {
    id: kanal.id,
    von: kanal.ownerDiscordId,
    an: neuerBesitzer.discordId,
    automatisch: optionen.automatisch ?? false,
  });
  return aktualisiert;
}

/** Die persoenlichen Ausnahmen eines Talks. */
export async function listAccess(channelId: string) {
  return prisma.temporaryVoiceAccess.findMany({
    where: { channelId },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
  });
}
