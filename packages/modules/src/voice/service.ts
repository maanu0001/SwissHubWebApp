import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel, TemporaryVoiceSource, VoiceHubEventKind } from '@swisshub/database';
import {
  discord,
  resolveGuildId,
  type ChannelOverwrite,
  type DiscordGateway,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import {
  BOT_ERLAUBT,
  EVERYONE_VERWALTET,
  besitzerRechte,
  everyoneAusnahme,

  verschmelze,
} from './permissions';
import { pruefeName } from './naming';

const log = createLogger('voice:service');

/**
 * Die Engine fuer temporaere Sprachkanaele.
 *
 * Eine Stelle fuer alle Module. Der Voice Hub erzeugt Talks, die Spielersuche
 * erzeugt Gruppenkanaele, spaeter vielleicht ein Turnier seine Matchraeume -
 * alle mit demselben Lebenszyklus, demselben Aufraeumen nach einem Neustart
 * und derselben Rechtestrategie. Drei Module mit drei eigenen Fassungen
 * derselben Sache waeren drei Stellen, an denen ein leerer Kanal stehen
 * bleibt.
 *
 * Was hier passiert, passiert immer in dieser Reihenfolge: erst die Zeile,
 * dann Discord. Die Zeile ist die Wahrheit; scheitert Discord, laesst sich der
 * Kanal nachziehen. Andersherum stuende ein Kanal da, von dem niemand weiss.
 */

/** Wer eine Aktion ausloest - fuer Verlauf und Protokoll. */
export interface VoiceActor {
  discordId: string;
  username: string;
  /** WEBAPP, DISCORD oder SYSTEM. */
  source: 'WEBAPP' | 'DISCORD' | 'SYSTEM';
}

export const SYSTEM_ACTOR: VoiceActor = {
  discordId: 'system',
  username: 'System',
  source: 'SYSTEM',
};

export interface CreateTemporaryVoiceInput {
  guildId: string;
  ownerDiscordId: string;
  ownerUsername: string;
  name: string;
  parentId: string;
  /** Ausweichkategorie, falls die erste voll ist. */
  overflowParentId?: string | null;
  source: TemporaryVoiceSource;
  hubId?: string | null;
  presetId?: string | null;
  externalRef?: string | null;
  userLimit?: number;
  bitrate?: number | null;
  locked?: boolean;
  hidden?: boolean;
  ownerModeration?: boolean;
  /** Wie lange ein leerer Kanal stehen bleibt. */
  deleteGraceSeconds?: number;
  /**
   * Ausdrueckliche Erlaubnis fuer `@everyone`.
   *
   * Normalerweise bekommt `@everyone` gar keine Ausnahme und der Kanal erbt
   * von seiner Kategorie - ein oeffentlicher Talk in einer geschlossenen
   * Kategorie soll geschlossen bleiben.
   *
   * Die Spielersuche will das Gegenteil: ihr Gruppenkanal ist ausdruecklich
   * fuer alle offen, damit spontan jemand dazustossen kann, und zwar
   * unabhaengig davon, was die Kategorie sagt. Genau dafuer ist dieses Feld.
   */
  everyoneAllow?: bigint | null;
  /**
   * Der zu verwendende Zugang zu Discord.
   *
   * Ohne Angabe der uebliche. Die Spielersuche reicht seit jeher ihren
   * eigenen durch - unter anderem, damit sich im Test ein Fehlschlag beim
   * Anlegen nachstellen laesst. Diese Moeglichkeit soll ihr die gemeinsame
   * Engine nicht nehmen.
   */
  gateway?: DiscordGateway;
}

/**
 * Legt einen temporaeren Sprachkanal an.
 *
 * Zwei Schritte mit Absicht: erst die Reservierung in der Datenbank, dann der
 * Kanal auf Discord. Die Reservierung ist eine Zeile ohne `discordChannelId`,
 * und die Eindeutigkeit ueber `activeOwnerKey` laesst je Hub nur eine
 * offene Zeile pro Person zu. Zwei gleichzeitige Beitritte kaempfen damit in
 * der Datenbank um den Platz statt bei Discord - dort haetten beide einen
 * Kanal bekommen.
 *
 * Der Discord-Aufruf liegt ausdruecklich nicht in der Transaktion: er dauert
 * je nach Laune der API hunderte Millisekunden, und solange haelt niemand eine
 * Sperre.
 */
export async function createTemporaryVoice(
  input: CreateTemporaryVoiceInput,
): Promise<TemporaryVoiceChannel> {
  const namePruefung = pruefeName(input.name);
  const name = namePruefung.ok ? namePruefung.name : `${input.ownerUsername} Stübli`.slice(0, 100);

  // --- Reservierung ------------------------------------------------------
  let reservierung: TemporaryVoiceChannel;
  try {
    reservierung = await prisma.temporaryVoiceChannel.create({
      data: {
        guildId: input.guildId,
        discordChannelId: null,
        hubId: input.hubId ?? null,
        presetId: input.presetId ?? null,
        source: input.source,
        externalRef: input.externalRef ?? null,
        ownerDiscordId: input.ownerDiscordId,
        ownerUsername: input.ownerUsername.slice(0, 64),
        // Der Schluessel, an dem sich zwei gleichzeitige Beitritte stossen.
        // Er folgt dem Besitz und wandert bei einer Uebergabe mit; ohne Hub
        // bleibt er leer. Beides ist im Schema begruendet.
        activeOwnerKey: input.hubId ? input.ownerDiscordId : null,
        name,
        userLimit: input.userLimit ?? 0,
        bitrate: input.bitrate ?? null,
        locked: input.locked ?? false,
        hidden: input.hidden ?? false,
      },
    });
  } catch (error) {
    // Die Eindeutigkeit hat zugeschlagen: jemand war schneller. Das ist kein
    // Fehler, sondern die Antwort auf ein doppeltes Ereignis.
    if (istEindeutigkeitsFehler(error)) {
      throw new AppError('CONFLICT', {
        userMessage: 'Du hast hier bereits einen Talk.',
      });
    }
    throw error;
  }

  // --- Discord -----------------------------------------------------------
  //
  // Ausserhalb der Reservierung, weil der Aufruf je nach Laune der API
  // hunderte Millisekunden dauert - solange soll niemand eine Sperre halten.
  const gateway = input.gateway ?? discord;
  let angelegt: { id: string; name: string } | null = null;
  try {
    const overwrites = await baueStartAusnahmen(input);

    const kanal = await erstelleMitAusweich(
      {
        name,
        parentId: input.parentId,
        userLimit: input.userLimit ?? 0,
        bitrate: input.bitrate ?? null,
        overwrites,
        reason: `Voice Hub: Talk von ${input.ownerUsername}`,
      },
      input.overflowParentId ?? null,
      gateway,
    );
    angelegt = { id: kanal.id, name: kanal.name };

    const fertig = await prisma.temporaryVoiceChannel.update({
      where: { id: reservierung.id },
      data: { discordChannelId: kanal.id, name: kanal.name, lastActiveAt: new Date() },
    });

    await schreibeEreignis(fertig, 'VOICE_CREATED', {
      discordId: input.ownerDiscordId,
      username: input.ownerUsername,
      source: 'DISCORD',
    });

    log.info('Temporärer Sprachkanal erstellt', {
      id: fertig.id,
      channelId: kanal.id,
      source: input.source,
    });
    return fertig;
  } catch (error) {
    // Der Kanal steht schon auf Discord, aber die Zeile dazu nicht. Ohne
    // dieses Aufraeumen bliebe ein Kanal stehen, von dem die Anwendung nichts
    // weiss - und den folglich auch kein Abgleich je wieder findet.
    if (angelegt) {
      await gateway.managedChannels
        .remove(angelegt.id, 'Talk konnte nicht vollständig angelegt werden')
        .catch(() => undefined);
    }

    // Die Reservierung wieder freigeben - sonst blockiert sie den naechsten
    // Versuch derselben Person auf Dauer.
    await prisma.temporaryVoiceChannel
      .delete({ where: { id: reservierung.id } })
      .catch(() => undefined);

    log.error('Sprachkanal konnte nicht erstellt werden', {
      error: error instanceof Error ? error.message : 'unbekannt',
      ownerDiscordId: input.ownerDiscordId,
      aufgeraeumt: angelegt !== null,
    });
    throw error;
  }
}

/**
 * Legt den Kanal an und weicht auf die zweite Kategorie aus, wenn die erste
 * voll ist.
 *
 * Discord erlaubt 50 Kanaele je Kategorie. Ohne Ausweichkategorie steht der
 * Betrieb, sobald die Kategorie voll ist - und zwar fuer alle, nicht nur fuer
 * den, der gerade beitritt.
 */
async function erstelleMitAusweich(
  eingabe: {
    name: string;
    parentId: string;
    userLimit: number;
    bitrate: number | null;
    overwrites: ChannelOverwrite[];
    reason: string;
  },
  ausweichId: string | null,
  gateway: DiscordGateway,
) {
  try {
    return await gateway.managedChannels.createVoice(eingabe);
  } catch (error) {
    if (!ausweichId) {
      throw error;
    }
    log.warn('Zielkategorie nimmt keinen Kanal mehr - weiche aus', {
      parentId: eingabe.parentId,
      ausweichId,
    });
    return gateway.managedChannels.createVoice({ ...eingabe, parentId: ausweichId });
  }
}

/** Die Ausnahmen, mit denen ein neuer Kanal startet. */
async function baueStartAusnahmen(input: CreateTemporaryVoiceInput): Promise<ChannelOverwrite[]> {
  const gateway = input.gateway ?? discord;
  const overwrites: ChannelOverwrite[] = [
    {
      id: input.ownerDiscordId,
      type: 1,
      allow: besitzerRechte(input.ownerModeration ?? true),
      deny: 0n,
    },
  ];

  if (input.everyoneAllow !== undefined && input.everyoneAllow !== null) {
    overwrites.push({ id: input.guildId, type: 0, allow: input.everyoneAllow, deny: 0n });
  } else {
    const everyone = everyoneAusnahme(input.guildId, {
      locked: input.locked ?? false,
      hidden: input.hidden ?? false,
    });
    if (everyone) {
      overwrites.push(everyone);
    }
  }

  const bot = await gateway.bot.identity().catch(() => null);
  if (bot) {
    overwrites.push({ id: bot.id, type: 1, allow: BOT_ERLAUBT, deny: 0n });
  }

  return overwrites;
}

// --- Lesen -----------------------------------------------------------------

/** Ein offener Talk anhand seiner Discord-Kennung. */
export async function findeOffenenKanal(
  discordChannelId: string,
): Promise<TemporaryVoiceChannel | null> {
  return prisma.temporaryVoiceChannel.findFirst({
    where: { discordChannelId, closedAt: null },
  });
}

/** Ein offener Talk anhand der eigenen Kennung, auf die Guild geprueft. */
export async function ladeOffenenKanal(
  id: string,
  guildId: string,
): Promise<TemporaryVoiceChannel | null> {
  return prisma.temporaryVoiceChannel.findFirst({ where: { id, guildId, closedAt: null } });
}

/** Die offenen Talks, die dieser Person gehoeren. */
export async function eigeneOffeneKanaele(
  guildId: string,
  ownerDiscordId: string,
  source?: TemporaryVoiceSource,
): Promise<TemporaryVoiceChannel[]> {
  return prisma.temporaryVoiceChannel.findMany({
    where: {
      guildId,
      ownerDiscordId,
      closedAt: null,
      ...(source ? { source } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
}

// --- Aendern ---------------------------------------------------------------

/**
 * Benennt einen Talk um.
 *
 * Die Abkuehlzeit ist keine Schikane, sondern Notwehr: Discord laesst zwei
 * Umbenennungen je zehn Minuten und Kanal zu. Wer darueber hinaus umbenennt,
 * bekommt kein «langsamer», sondern ein Rate-Limit, das alle
 * Kanalaenderungen des Bots mitblockiert - auch die anderer Module.
 */
export async function renameTemporaryVoice(
  kanal: TemporaryVoiceChannel,
  name: string,
  actor: VoiceActor,
  optionen: { cooldownSeconds: number; ignoriereCooldown?: boolean } = { cooldownSeconds: 300 },
): Promise<TemporaryVoiceChannel> {
  const pruefung = pruefeName(name);
  if (!pruefung.ok) {
    throw new AppError('VALIDATION_FAILED', { userMessage: pruefung.grund });
  }

  if (!optionen.ignoriereCooldown && kanal.lastRenamedAt) {
    const frei = kanal.lastRenamedAt.getTime() + optionen.cooldownSeconds * 1000;
    const rest = frei - Date.now();
    if (rest > 0) {
      throw new AppError('RATE_LIMITED', {
        userMessage: `Du kannst deinen Talk in ${verbleibend(rest)} erneut umbenennen.`,
      });
    }
  }

  if (!kanal.discordChannelId) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Talk wird gerade erst erstellt.' });
  }

  await discord.managedChannels.updateVoice(
    kanal.discordChannelId,
    { name: pruefung.name },
    `Umbenannt von ${actor.username}`,
  );

  const aktualisiert = await prisma.temporaryVoiceChannel.update({
    where: { id: kanal.id },
    data: { name: pruefung.name, lastRenamedAt: new Date(), lastActiveAt: new Date() },
  });

  await schreibeEreignis(aktualisiert, 'VOICE_RENAMED', actor, { name: pruefung.name });
  return aktualisiert;
}

/** Verbleibende Zeit in Worten - «3 Minuten», «40 Sekunden». */
function verbleibend(ms: number): string {
  const sekunden = Math.ceil(ms / 1000);
  if (sekunden < 60) {
    return `${sekunden} Sekunde${sekunden === 1 ? '' : 'n'}`;
  }
  const minuten = Math.ceil(sekunden / 60);
  return `${minuten} Minute${minuten === 1 ? '' : 'n'}`;
}

/** Setzt das Teilnehmerlimit. 0 = unbegrenzt. */
export async function setTemporaryVoiceLimit(
  kanal: TemporaryVoiceChannel,
  limit: number,
  actor: VoiceActor,
  maxLimit = 99,
): Promise<TemporaryVoiceChannel> {
  if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das Limit muss zwischen 0 und 99 liegen. 0 heisst unbegrenzt.',
    });
  }
  if (limit > maxLimit) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `In diesem Talk sind höchstens ${maxLimit} Personen erlaubt.`,
    });
  }
  if (!kanal.discordChannelId) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Talk wird gerade erst erstellt.' });
  }

  await discord.managedChannels.updateVoice(
    kanal.discordChannelId,
    { userLimit: limit },
    `Limit gesetzt von ${actor.username}`,
  );

  const aktualisiert = await prisma.temporaryVoiceChannel.update({
    where: { id: kanal.id },
    data: { userLimit: limit, lastActiveAt: new Date() },
  });
  await schreibeEreignis(aktualisiert, 'VOICE_LIMIT_CHANGED', actor, { limit });
  return aktualisiert;
}

/** Setzt die Bitrate in bit/s. */
export async function setTemporaryVoiceBitrate(
  kanal: TemporaryVoiceChannel,
  bitrate: number,
  actor: VoiceActor,
  maxBitrate: number,
): Promise<TemporaryVoiceChannel> {
  if (bitrate < 8000 || bitrate > maxBitrate) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Die Bitrate muss zwischen 8 und ${Math.floor(maxBitrate / 1000)} kbit/s liegen.`,
    });
  }
  if (!kanal.discordChannelId) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Talk wird gerade erst erstellt.' });
  }

  await discord.managedChannels.updateVoice(
    kanal.discordChannelId,
    { bitrate },
    `Bitrate gesetzt von ${actor.username}`,
  );

  return prisma.temporaryVoiceChannel.update({
    where: { id: kanal.id },
    data: { bitrate, lastActiveAt: new Date() },
  });
}

/**
 * Sperrt oder oeffnet den Talk.
 *
 * Gesperrt heisst: niemand Neues kommt herein. Wer schon drin ist, bleibt -
 * Discord wirft niemanden hinaus, wenn `CONNECT` wegfaellt. Das ist gewollt:
 * ein Gespraech soll nicht dadurch enden, dass jemand die Tuer schliesst.
 */
export async function setTemporaryVoiceLocked(
  kanal: TemporaryVoiceChannel,
  locked: boolean,
  actor: VoiceActor,
): Promise<TemporaryVoiceChannel> {
  return setzeSichtbarkeit(kanal, { locked, hidden: kanal.hidden }, actor);
}

/** Versteckt den Talk oder macht ihn wieder sichtbar. */
export async function setTemporaryVoiceHidden(
  kanal: TemporaryVoiceChannel,
  hidden: boolean,
  actor: VoiceActor,
): Promise<TemporaryVoiceChannel> {
  return setzeSichtbarkeit(kanal, { locked: kanal.locked, hidden }, actor);
}

async function setzeSichtbarkeit(
  kanal: TemporaryVoiceChannel,
  zustand: { locked: boolean; hidden: boolean },
  actor: VoiceActor,
): Promise<TemporaryVoiceChannel> {
  if (!kanal.discordChannelId) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Talk wird gerade erst erstellt.' });
  }

  const neu = everyoneAusnahme(kanal.guildId, zustand);

  if (neu) {
    // Nur die eigenen Bits anfassen: was ein Administrator hier sonst noch
    // eingetragen hat, bleibt stehen.
    const vorhanden = await leseAusnahme(kanal.discordChannelId, kanal.guildId);
    const verschmolzen = verschmelze(vorhanden, neu, EVERYONE_VERWALTET);
    await discord.managedChannels.setOverwrite(
      kanal.discordChannelId,
      { id: kanal.guildId, type: 0, ...verschmolzen },
      `Zugriff geändert von ${actor.username}`,
    );
  } else {
    const vorhanden = await leseAusnahme(kanal.discordChannelId, kanal.guildId);
    const rest = verschmelze(vorhanden, { allow: 0n, deny: 0n }, EVERYONE_VERWALTET);
    if (rest.allow === 0n && rest.deny === 0n) {
      // Nichts Fremdes mehr drin: die Ausnahme ganz entfernen, damit der Kanal
      // wieder von seiner Kategorie erbt.
      await discord.managedChannels
        .clearOverwrite(kanal.discordChannelId, kanal.guildId, `Zugriff geöffnet von ${actor.username}`)
        .catch(() => undefined);
    } else {
      await discord.managedChannels.setOverwrite(
        kanal.discordChannelId,
        { id: kanal.guildId, type: 0, ...rest },
        `Zugriff geöffnet von ${actor.username}`,
      );
    }
  }

  const aktualisiert = await prisma.temporaryVoiceChannel.update({
    where: { id: kanal.id },
    data: { locked: zustand.locked, hidden: zustand.hidden, lastActiveAt: new Date() },
  });

  if (zustand.locked !== kanal.locked) {
    await schreibeEreignis(aktualisiert, zustand.locked ? 'VOICE_LOCKED' : 'VOICE_UNLOCKED', actor);
  }
  if (zustand.hidden !== kanal.hidden) {
    await schreibeEreignis(aktualisiert, zustand.hidden ? 'VOICE_HIDDEN' : 'VOICE_SHOWN', actor);
  }
  return aktualisiert;
}

/** Die bestehende Ausnahme eines Ziels aus dem Kanal lesen. */
async function leseAusnahme(
  channelId: string,
  zielId: string,
): Promise<{ allow: bigint; deny: bigint } | null> {
  const kanal = await discord.managedChannels.get(channelId).catch(() => null);
  const eintrag = kanal?.overwrites.find((e) => e.id === zielId);
  if (!eintrag) {
    return null;
  }
  return { allow: BigInt(eintrag.allow), deny: BigInt(eintrag.deny) };
}

export { schreibeEreignis, istEindeutigkeitsFehler };

/** Haelt einen Lebenszyklus-Vorgang im Verlauf fest. */
async function schreibeEreignis(
  kanal: Pick<TemporaryVoiceChannel, 'id' | 'guildId' | 'hubId'>,
  kind: VoiceHubEventKind,
  actor: VoiceActor,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await prisma.voiceHubEvent
    .create({
      data: {
        guildId: kanal.guildId,
        channelId: kanal.id,
        hubId: kanal.hubId,
        kind,
        actorDiscordId: actor.discordId === 'system' ? null : actor.discordId,
        detail: { ...detail, quelle: actor.source },
      },
    })
    .catch((error: unknown) => {
      // Der Verlauf ist wichtig, aber nicht wichtiger als die Aktion selbst.
      log.warn('Voice-Ereignis konnte nicht geschrieben werden', {
        error: error instanceof Error ? error.message : 'unbekannt',
        kind,
      });
    });
}

/** Prisma meldet einen Verstoss gegen eine Eindeutigkeit mit P2002. */
function istEindeutigkeitsFehler(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export { resolveGuildId };
