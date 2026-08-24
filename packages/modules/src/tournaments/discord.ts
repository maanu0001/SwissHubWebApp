import { prisma } from '@swisshub/database';
import type { Tournament, TournamentMatch } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { discord, resolveGuildId, BUTTON_STYLE, DISCORD_PERMISSIONS } from '@swisshub/discord';
import type { ChannelOverwrite, DiscordEmbedField, DiscordMessagePayload } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { ACCENT_COLOR, TOURNAMENTS_MODULE_ID, type TournamentSettings } from './config';
import { slugify } from './events';

const logger = createLogger('tournaments:discord');

/**
 * Die Discord-Seite des Turniermoduls.
 *
 * Es werden ausschliesslich Mitglieder-Ausnahmen gesetzt, keine temporaeren
 * Team-Rollen. Rollen waeren bequemer zu lesen, kosten aber einen zweiten
 * Lebenszyklus: sie muessen angelegt, vergeben, entzogen und geloescht
 * werden, sie haengen an der Rollenhierarchie des Bots, und eine vergessene
 * Rolle bleibt fuer immer am Mitglied haengen. Discord erlaubt 500 Ausnahmen
 * je Kanal - fuer zwei Teams und die Leitung ist das reichlich.
 */

/** Kennungen der Knoepfe. Genau eine Stelle - der Bot erkennt sie wieder. */
export const TOURNAMENT_BUTTON = {
  /** `tournaments:checkin:<tournamentId>` */
  checkinPrefix: 'tournaments:checkin:',
  ready: 'tournaments:ready',
  report: 'tournaments:report',
  callAdmin: 'tournaments:admin',
} as const;

/** Discord erlaubt 500 Ausnahmen je Kanal. */
const MAX_OVERWRITES = 500;

/** Rechte, die ein Teilnehmer im Match-Kanal braucht. */
const TEILNEHMER_RECHTE =
  DISCORD_PERMISSIONS.VIEW_CHANNEL |
  DISCORD_PERMISSIONS.SEND_MESSAGES |
  DISCORD_PERMISSIONS.ATTACH_FILES |
  DISCORD_PERMISSIONS.EMBED_LINKS |
  DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY;

/**
 * Eine vom Modul angelegte Discord-Ressource vermerken.
 *
 * Nur was hier steht, wird spaeter auch wieder entfernt. Ohne diese Liste
 * muesste das Aufraeumen raten, welcher Kanal zum Turnier gehoert - und
 * loeschte irgendwann einen, der jemand anderem gehoert.
 */
async function merkeRessource(
  tournamentId: string,
  kind: 'MATCH_CHANNEL' | 'ANNOUNCEMENT_MESSAGE' | 'PARTICIPANT_ROLE' | 'WINNER_ROLE',
  discordId: string,
  options: { parentId?: string | null; label?: string | null } = {},
): Promise<void> {
  await prisma.tournamentResource.upsert({
    where: { tournamentId_kind_discordId: { tournamentId, kind, discordId } },
    create: {
      tournamentId,
      kind,
      discordId,
      parentId: options.parentId ?? null,
      label: options.label ?? null,
    },
    update: { removedAt: null, missingSince: null },
  });
}

// --- Match-Kanaele ---------------------------------------------------------

/** Wer an diesem Match beteiligt ist - fuer die Kanalrechte. */
async function beteiligte(match: TournamentMatch): Promise<string[]> {
  const ids = new Set<string>();

  for (const participantId of [match.participantAId, match.participantBId]) {
    if (!participantId) {
      continue;
    }
    const teilnehmer = await prisma.tournamentParticipant.findUnique({
      where: { id: participantId },
      select: { discordId: true, teamId: true },
    });
    if (!teilnehmer) {
      continue;
    }
    if (teilnehmer.discordId) {
      ids.add(teilnehmer.discordId);
      continue;
    }
    if (teilnehmer.teamId) {
      const mitglieder = await prisma.tournamentTeamMember.findMany({
        where: { teamId: teilnehmer.teamId, removedAt: null },
        select: { discordId: true },
      });
      for (const mitglied of mitglieder) {
        ids.add(mitglied.discordId);
      }
    }
  }

  return [...ids];
}

/**
 * Den Kanal eines Matches anlegen.
 *
 * @everyone sieht nichts; hinein duerfen beide Teams, die Turnierleitung und
 * der Bot. Der Bot bekommt seine Rechte ausdruecklich: erbt er sie nur von der
 * Kategorie, verliert er sie, sobald jemand die Kategorie umstellt.
 */
export async function createMatchChannel(matchId: string): Promise<string | null> {
  const match = await prisma.tournamentMatch.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      tournament: true,
      participantA: { select: { username: true, team: { select: { name: true } } } },
      participantB: { select: { username: true, team: { select: { name: true } } } },
    },
  });

  if (match.discordChannelId && !match.channelMissing) {
    return match.discordChannelId;
  }
  if (!match.tournament.createMatchChannels) {
    return null;
  }

  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  const kategorie = match.tournament.matchCategoryId ?? settings.defaultMatchCategoryId;
  if (!kategorie) {
    throw new AppError('CONFLICT', {
      userMessage: 'Es ist keine Discord-Kategorie für Match-Channels eingerichtet.',
    });
  }

  const guildId = await resolveGuildId();
  const staff = await prisma.tournamentStaff.findMany({
    where: { tournamentId: match.tournamentId },
    select: { discordId: true },
  });
  const spieler = await beteiligte(match);
  const botIdentitaet = await discord.bot.identity();

  const overwrites: ChannelOverwrite[] = [
    // @everyone sieht nichts. Die Rolle traegt die Guild-ID.
    { id: guildId, type: 0, allow: 0n, deny: DISCORD_PERMISSIONS.VIEW_CHANNEL },
    {
      id: botIdentitaet.id,
      type: 1,
      allow: TEILNEHMER_RECHTE | DISCORD_PERMISSIONS.MANAGE_MESSAGES | DISCORD_PERMISSIONS.MANAGE_CHANNELS,
      deny: 0n,
    },
    ...settings.defaultStaffRoleIds.map((rolle) => ({
      id: rolle,
      type: 0 as const,
      allow: TEILNEHMER_RECHTE | DISCORD_PERMISSIONS.MANAGE_MESSAGES,
      deny: 0n,
    })),
  ];

  const einzeln = [...new Set([...spieler, ...staff.map((eintrag) => eintrag.discordId)])].filter(
    (id) => id !== 'system',
  );

  // Sicherheitsnetz gegen Discords Grenze. Bleibt jemand aussen vor, ist das
  // ein Fehler, den die Leitung sehen soll - nicht einer, der still passiert.
  if (overwrites.length + einzeln.length > MAX_OVERWRITES) {
    logger.warn('Zu viele Berechtigungsausnahmen für einen Match-Channel', {
      matchId,
      anzahl: overwrites.length + einzeln.length,
    });
  }

  for (const discordId of einzeln.slice(0, MAX_OVERWRITES - overwrites.length)) {
    overwrites.push({ id: discordId, type: 1, allow: TEILNEHMER_RECHTE, deny: 0n });
  }

  const name = matchKanalName(match.matchNumber, {
    a: match.participantA?.team?.name ?? match.participantA?.username ?? null,
    b: match.participantB?.team?.name ?? match.participantB?.username ?? null,
  });

  const kanal = await discord.managedChannels.createText({
    name,
    parentId: kategorie,
    topic: `${match.tournament.name} · Match #${match.matchNumber}`,
    overwrites,
    reason: `Turnier ${match.tournament.name}, Match #${match.matchNumber}`,
  });

  await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: { discordChannelId: kanal.id, channelMissing: false },
  });
  await merkeRessource(match.tournamentId, 'MATCH_CHANNEL', kanal.id, {
    parentId: kategorie,
    label: name,
  });

  return kanal.id;
}

/**
 * Der Name eines Match-Kanals.
 *
 * Discord erlaubt nur Kleinbuchstaben, Ziffern und Bindestriche. Ein
 * ungefilterter Teamname ergaebe sonst einen Namen, den Discord ablehnt - und
 * die Kanalerstellung schluege fehl, ohne dass jemand versteht warum.
 */
export function matchKanalName(nummer: number, gegner: { a: string | null; b: string | null }): string {
  const teil = (name: string | null): string => (name ? slugify(name).slice(0, 20) : 'tbd');
  const basis = `match-${nummer}-${teil(gegner.a)}-vs-${teil(gegner.b)}`;
  return basis.replace(/-+/gu, '-').replace(/^-|-$/gu, '').slice(0, 90);
}

/**
 * Die Startnachricht im Match-Kanal.
 *
 * Ohne Datenbankzugriff, damit sie sich pruefen laesst. Die Knopfkennungen
 * sind genau die, die der Bot beim Klick wiedererkennt.
 */
export function matchStartNachricht(input: {
  matchNumber: number;
  turnier: string;
  a: string | null;
  b: string | null;
  bestOf: number;
  scheduledAt: Date | null;
  mapPool: string[];
  stage: string;
  runde: number;
  teilnehmerIds: string[];
  accentColor: number | null;
}): DiscordMessagePayload {
  const felder: DiscordEmbedField[] = [
    { name: 'Format', value: `Best of ${input.bestOf}`, inline: true },
    { name: 'Runde', value: `${input.stage} · Runde ${input.runde}`, inline: true },
  ];

  if (input.scheduledAt) {
    felder.push({
      name: 'Start',
      value: `<t:${Math.floor(input.scheduledAt.getTime() / 1000)}:f>`,
      inline: true,
    });
  }
  if (input.mapPool.length > 0) {
    felder.push({ name: 'Map Pool', value: input.mapPool.join(' · ').slice(0, 1024) });
  }

  return {
    content: input.teilnehmerIds
      .map((id) => `<@${id}>`)
      .join(' ')
      .slice(0, 1900),
    embeds: [
      {
        title: `🏆 Match #${input.matchNumber}`,
        description: `**${input.a ?? 'Noch offen'}**\nvs\n**${input.b ?? 'Noch offen'}**`,
        color: input.accentColor ?? ACCENT_COLOR,
        fields: felder,
        footer: { text: input.turnier.slice(0, 2048) },
        timestamp: new Date().toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: BUTTON_STYLE.SUCCESS,
            label: 'Bereit',
            custom_id: TOURNAMENT_BUTTON.ready,
            emoji: { name: '✅' },
          },
          {
            type: 2,
            style: BUTTON_STYLE.PRIMARY,
            label: 'Resultat melden',
            custom_id: TOURNAMENT_BUTTON.report,
            emoji: { name: '📊' },
          },
          {
            type: 2,
            style: BUTTON_STYLE.DANGER,
            label: 'Admin rufen',
            custom_id: TOURNAMENT_BUTTON.callAdmin,
            emoji: { name: '🚨' },
          },
        ],
      },
    ],
    // Ausdruecklich nur die Beteiligten. Ein `@everyone` in einem Teamnamen
    // bleibt wirkungslos.
    allowedMentions: { parse: [], users: input.teilnehmerIds.slice(0, 100) },
  };
}

/** Die Startnachricht senden. */
export async function sendeMatchStart(matchId: string): Promise<void> {
  const match = await prisma.tournamentMatch.findUniqueOrThrow({
    where: { id: matchId },
    include: {
      tournament: { select: { name: true, mapPool: true, accentColor: true } },
      stage: { select: { name: true } },
      participantA: { select: { username: true, team: { select: { name: true } } } },
      participantB: { select: { username: true, team: { select: { name: true } } } },
    },
  });

  if (!match.discordChannelId || match.channelMissing) {
    return;
  }

  await discord.channels
    .send(
      match.discordChannelId,
      matchStartNachricht({
        matchNumber: match.matchNumber,
        turnier: match.tournament.name,
        a: match.participantA?.team?.name ?? match.participantA?.username ?? null,
        b: match.participantB?.team?.name ?? match.participantB?.username ?? null,
        bestOf: match.bestOf,
        scheduledAt: match.scheduledAt,
        mapPool: match.tournament.mapPool,
        stage: match.stage.name,
        runde: match.round,
        teilnehmerIds: await beteiligte(match),
        accentColor: match.tournament.accentColor,
      }),
    )
    .catch((fehler: unknown) => {
      // Das Match steht bereits - eine fehlende Startnachricht ist aergerlich,
      // aber kein Grund, den Kanal wieder zu verwerfen.
      logger.warn('Match-Startnachricht konnte nicht gesendet werden', {
        matchId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    });
}

/**
 * Eine Systemmeldung im Match-Kanal mit ausdruecklicher Erwaehnung.
 *
 * Nur fuer den Ruf nach der Turnierleitung: dort ist die Erwaehnung der
 * Zweck. Ueberall sonst bleibt sie aus - ein Kanal, in dem jede Meldung
 * pingt, wird stummgeschaltet, und dann kommt auch der Ruf nicht mehr an.
 */
export async function matchMeldungMitErwaehnung(
  matchId: string,
  text: string,
  erwaehnen: string[],
): Promise<void> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      discordChannelId: true,
      channelMissing: true,
      tournament: { select: { accentColor: true } },
    },
  });
  if (!match?.discordChannelId || match.channelMissing) {
    return;
  }

  const ziele = erwaehnen.slice(0, 20);

  await discord.channels
    .send(match.discordChannelId, {
      content: ziele.map((id) => `<@${id}>`).join(' '),
      embeds: [{ description: text.slice(0, 2000), color: match.tournament.accentColor ?? ACCENT_COLOR }],
      // Ausdruecklich nur die genannten Personen - was im Text nach einer
      // Erwaehnung aussieht, bleibt wirkungslos.
      allowedMentions: { parse: [], users: ziele },
    })
    .catch(() => undefined);
}

/**
 * Eine Systemmeldung im Match-Kanal.
 *
 * Scheitert nie laut: der Vorgang, den sie begleitet, ist bereits erledigt.
 */
export async function matchMeldung(matchId: string, text: string): Promise<void> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    select: { discordChannelId: true, channelMissing: true, tournament: { select: { accentColor: true } } },
  });
  if (!match?.discordChannelId || match.channelMissing) {
    return;
  }

  await discord.channels
    .send(match.discordChannelId, {
      embeds: [{ description: text.slice(0, 2000), color: match.tournament.accentColor ?? ACCENT_COLOR }],
      allowedMentions: { parse: [] },
    })
    .catch(() => undefined);
}

// --- Ankuendigungen --------------------------------------------------------

export type AnnouncementKind =
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSING'
  | 'REGISTRATION_CLOSED'
  | 'CHECKIN_OPEN'
  | 'CHECKIN_REMINDER'
  | 'TOURNAMENT_START'
  | 'ROUND_START'
  | 'STREAM_LIVE'
  | 'WINNER'
  | 'TOURNAMENT_COMPLETED'
  | 'TOURNAMENT_CANCELLED';

export interface AnnouncementText {
  title: string;
  content: string;
}

/**
 * Der Text einer Ankuendigung.
 *
 * Ohne Datenbank und ohne Discord - so laesst sich pruefen, was tatsaechlich
 * im Kanal steht. Die Discord-Zeitstempel rechnet jeder Client in seine
 * eigene Zeitzone um; ein fest hingeschriebenes «20:00» waere fuer die
 * Haelfte falsch.
 */
export function ankuendigungsText(
  kind: AnnouncementKind,
  tournament: Pick<
    Tournament,
    'name' | 'gameName' | 'slug' | 'startsAt' | 'registrationClosesAt' | 'checkinClosesAt' | 'maxParticipants'
  >,
  extra: { runde?: number; sieger?: string; streamUrl?: string; grund?: string; frei?: number } = {},
): AnnouncementText {
  const zeit = (wert: Date | null): string =>
    wert ? `<t:${Math.floor(wert.getTime() / 1000)}:F>` : 'noch offen';
  const relativ = (wert: Date | null): string => (wert ? `<t:${Math.floor(wert.getTime() / 1000)}:R>` : '');

  switch (kind) {
    case 'REGISTRATION_OPEN':
      return {
        title: `🏆 ${tournament.name} - Anmeldung offen`,
        content: [
          `**${tournament.gameName}**`,
          '',
          `Start: ${zeit(tournament.startsAt)}`,
          `Anmeldeschluss: ${zeit(tournament.registrationClosesAt)}`,
          tournament.maxParticipants > 0 ? `Plätze: ${tournament.maxParticipants}` : '',
          '',
          `Anmelden: /turniere/${tournament.slug}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };

    case 'REGISTRATION_CLOSING':
      return {
        title: `⏳ ${tournament.name} - Anmeldung schliesst bald`,
        content: [
          `Der Anmeldeschluss ist ${relativ(tournament.registrationClosesAt)}.`,
          extra.frei !== undefined && extra.frei > 0 ? `Noch ${extra.frei} Plätze frei.` : '',
          '',
          `Anmelden: /turniere/${tournament.slug}`,
        ]
          .filter(Boolean)
          .join('\n'),
      };

    case 'REGISTRATION_CLOSED':
      return {
        title: `🔒 ${tournament.name} - Anmeldung geschlossen`,
        content: `Die Teilnehmerliste steht. Start: ${zeit(tournament.startsAt)}`,
      };

    case 'CHECKIN_OPEN':
      return {
        title: `✅ ${tournament.name} - Check-in offen`,
        content: [
          `Bitte jetzt einchecken. Der Check-in schliesst ${relativ(tournament.checkinClosesAt)}.`,
          '',
          'Wer nicht eincheckt, tritt nicht an.',
        ].join('\n'),
      };

    case 'CHECKIN_REMINDER':
      return {
        title: `⏰ ${tournament.name} - Check-in schliesst gleich`,
        content: `Der Check-in schliesst ${relativ(tournament.checkinClosesAt)}. Wer noch nicht eingecheckt hat, sollte das jetzt tun.`,
      };

    case 'TOURNAMENT_START':
      return {
        title: `🚀 ${tournament.name} - es geht los`,
        content: [
          `Das Bracket steht. Alle Matches und Zeiten stehen auf der Turnierseite.`,
          '',
          `/turniere/${tournament.slug}`,
        ].join('\n'),
      };

    case 'ROUND_START':
      return {
        title: `▶️ ${tournament.name} - Runde ${extra.runde ?? ''}`.trim(),
        content: [
          `Runde ${extra.runde ?? ''} beginnt. Die Match-Channels sind offen.`.trim(),
          '',
          `/turniere/${tournament.slug}`,
        ].join('\n'),
      };

    case 'STREAM_LIVE':
      return {
        title: `🔴 ${tournament.name} - wir sind live`,
        content: extra.streamUrl ?? `/turniere/${tournament.slug}`,
      };

    case 'WINNER':
      return {
        title: `🏆 ${tournament.name} - der Sieger steht fest`,
        content: [
          `**${extra.sieger ?? 'Unbekannt'}** gewinnt ${tournament.name}.`,
          '',
          `Alle Resultate: /turniere/${tournament.slug}`,
        ].join('\n'),
      };

    case 'TOURNAMENT_COMPLETED':
      return {
        title: `🎉 ${tournament.name} - abgeschlossen`,
        content: `Danke fürs Mitspielen. Bracket, Resultate und Platzierungen bleiben auf /turniere/${tournament.slug}.`,
      };

    case 'TOURNAMENT_CANCELLED':
      return {
        title: `❌ ${tournament.name} - abgesagt`,
        content: extra.grund
          ? `Das Turnier findet nicht statt.\n\nGrund: ${extra.grund}`
          : 'Das Turnier findet nicht statt.',
      };

    default:
      return { title: tournament.name, content: `/turniere/${tournament.slug}` };
  }
}

export interface AnnounceOptions {
  /** Erwaehnte Rolle - nur, wenn sie in den Einstellungen freigegeben ist. */
  mentionRoleId?: string | null;
  /** Einen bereits gesendeten Typ nochmals senden. */
  erneut?: boolean;
  actorDiscordId?: string;
}

/**
 * Eine Ankuendigung senden.
 *
 * Ueber das bestehende Kommunikationsmodul - es gibt keine zweite
 * Versandinfrastruktur. Dadurch landet jede Turnier-Ankuendigung im selben
 * Verlauf wie jede andere Nachricht des Bots, mit denselben Pruefungen und
 * demselben Audit.
 *
 * Jede Art wird je Turnier nur einmal gesendet. Sonst schickt ein zweimal
 * laufender Zeitgeber dieselbe Erinnerung zweimal - und das faellt erst auf,
 * wenn sich jemand beschwert.
 */
export async function announce(
  tournamentId: string,
  kind: AnnouncementKind,
  options: AnnounceOptions = {},
): Promise<boolean> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);

  const kanal = tournament.announcementChannelId ?? settings.defaultAnnouncementChannelId;
  if (!kanal) {
    return false;
  }

  const schluessel = kind === 'ROUND_START' ? kind : kind;
  const vorhanden = await prisma.tournamentAnnouncement.findUnique({
    where: { tournamentId_kind: { tournamentId, kind: schluessel } },
  });
  if (vorhanden && !options.erneut) {
    return false;
  }

  // Erwaehnung nur, wenn die Rolle sowohl am Turnier als auch in den
  // Moduleinstellungen freigegeben ist. Ein Textfeld fuer beliebige Rollen
  // waere ein Ping-Knopf fuer den ganzen Server.
  const erlaubteRollen = new Set([...settings.defaultPingRoleIds, ...tournament.pingRoleIds]);
  const rolle =
    options.mentionRoleId && erlaubteRollen.has(options.mentionRoleId) ? options.mentionRoleId : null;

  const text = ankuendigungsText(kind, tournament, {
    grund: tournament.cancelReason ?? undefined,
  });

  const { sendNews } = await import('../communication/service');
  const { randomUUID } = await import('node:crypto');

  try {
    const ergebnis = await sendNews(
      {
        channelId: kanal,
        title: text.title.slice(0, 256),
        content: text.content.slice(0, 4000),
        bannerUrl: tournament.bannerUrl ?? undefined,
        mention: rolle ? 'role' : 'none',
        ...(rolle ? { mentionTarget: rolle } : {}),
        idempotencyKey: randomUUID(),
      },
      {
        discordId: options.actorDiscordId ?? 'system',
        username: 'Turnierleitung',
        // Der Versand laeuft im Namen des Moduls. Die Rolle wurde oben bereits
        // gegen die Freigabeliste geprueft - hier steht deshalb genau die
        // Berechtigung, die das Kommunikationsmodul dafuer verlangt, und
        // nichts darueber hinaus: `@everyone` bleibt fuer Turniere gesperrt.
        permissionKeys: rolle ? ['communication.mention'] : [],
        isOwner: false,
      },
      { source: 'WEBAPP' },
    );

    await prisma.tournamentAnnouncement.upsert({
      where: { tournamentId_kind: { tournamentId, kind: schluessel } },
      create: {
        tournamentId,
        kind: schluessel,
        channelId: kanal,
        discordMessageId: ergebnis.message.discordMessageId,
        communicationMessageId: ergebnis.message.id,
        sentByDiscordId: options.actorDiscordId ?? null,
      },
      update: {
        channelId: kanal,
        discordMessageId: ergebnis.message.discordMessageId,
        communicationMessageId: ergebnis.message.id,
        sentAt: new Date(),
      },
    });

    if (ergebnis.message.discordMessageId) {
      await merkeRessource(tournamentId, 'ANNOUNCEMENT_MESSAGE', ergebnis.message.discordMessageId, {
        parentId: kanal,
        label: kind,
      });
    }

    logger.info('Turnier-Ankündigung gesendet', { tournamentId, kind });
    return true;
  } catch (fehler) {
    logger.warn('Turnier-Ankündigung fehlgeschlagen', {
      tournamentId,
      kind,
      grund: fehler instanceof Error ? fehler.message : 'unbekannt',
    });
    return false;
  }
}

/**
 * Die Check-in-Nachricht mit Knopf.
 *
 * Bewusst kein gewoehnlicher Beitrag: der Knopf ist der Grund, warum die
 * Nachricht existiert. Er traegt die Turnierkennung, damit der Bot beim Klick
 * weiss, um welches Turnier es geht - auch nach einem Neustart.
 */
export async function sendeCheckinAufruf(tournamentId: string): Promise<boolean> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  const kanal = tournament.announcementChannelId ?? settings.defaultAnnouncementChannelId;
  if (!kanal) {
    return false;
  }

  const text = ankuendigungsText('CHECKIN_OPEN', tournament);

  try {
    const gesendet = await discord.channels.send(kanal, {
      embeds: [
        {
          title: text.title.slice(0, 256),
          description: text.content.slice(0, 4000),
          color: tournament.accentColor ?? ACCENT_COLOR,
          ...(tournament.checkinClosesAt ? { timestamp: tournament.checkinClosesAt.toISOString() } : {}),
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: BUTTON_STYLE.SUCCESS,
              label: 'Jetzt einchecken',
              custom_id: `${TOURNAMENT_BUTTON.checkinPrefix}${tournamentId}`,
              emoji: { name: '✅' },
            },
          ],
        },
      ],
      allowedMentions: { parse: [] },
    });

    await prisma.tournamentAnnouncement.upsert({
      where: { tournamentId_kind: { tournamentId, kind: 'CHECKIN_OPEN' } },
      create: {
        tournamentId,
        kind: 'CHECKIN_OPEN',
        channelId: kanal,
        discordMessageId: gesendet.id,
      },
      update: { channelId: kanal, discordMessageId: gesendet.id, sentAt: new Date() },
    });
    await merkeRessource(tournamentId, 'ANNOUNCEMENT_MESSAGE', gesendet.id, {
      parentId: kanal,
      label: 'CHECKIN_OPEN',
    });
    return true;
  } catch (fehler) {
    logger.warn('Check-in-Aufruf konnte nicht gesendet werden', {
      tournamentId,
      grund: fehler instanceof Error ? fehler.message : 'unbekannt',
    });
    return false;
  }
}

// --- Aufraeumen und Abgleich ----------------------------------------------

/**
 * Faellige Match-Kanaele entfernen.
 *
 * Nur, was das Modul selbst angelegt hat. Der Verlauf des Matches bleibt in
 * der Datenbank - geloescht wird ein Kanal, kein Resultat.
 */
export async function purgeMatchChannels(jetzt = new Date()): Promise<number> {
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);

  const kandidaten = await prisma.tournamentMatch.findMany({
    where: {
      discordChannelId: { not: null },
      channelMissing: false,
      status: { in: ['COMPLETED', 'FORFEIT', 'CANCELLED'] },
      completedAt: { not: null },
    },
    select: {
      id: true,
      discordChannelId: true,
      completedAt: true,
      matchNumber: true,
      tournamentId: true,
      tournament: {
        select: { status: true, matchChannelRetentionHours: true, completedAt: true },
      },
    },
  });

  let entfernt = 0;

  for (const match of kandidaten) {
    const stunden = match.tournament.matchChannelRetentionHours || settings.matchChannelRetentionHours;

    const faellig =
      stunden > 0
        ? // Nach Frist ab dem Matchende.
          match.completedAt !== null && match.completedAt.getTime() + stunden * 3600_000 <= jetzt.getTime()
        : // 0 bedeutet: am Turnierende.
          ['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(match.tournament.status);

    if (!faellig) {
      continue;
    }

    try {
      await discord.managedChannels.remove(
        match.discordChannelId!,
        `Turnier-Match #${match.matchNumber} abgeschlossen`,
      );
      entfernt += 1;
    } catch (fehler) {
      logger.warn('Match-Channel konnte nicht entfernt werden', {
        matchId: match.id,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    }

    // Auch bei einem Fehler die Markierung loesen: der Kanal ist entweder weg
    // oder von Hand geloescht worden; erneut zu versuchen brachte nichts.
    await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: { discordChannelId: null, channelMissing: true },
    });
    await prisma.tournamentResource.updateMany({
      where: { tournamentId: match.tournamentId, kind: 'MATCH_CHANNEL', discordId: match.discordChannelId! },
      data: { removedAt: new Date() },
    });
  }

  if (entfernt > 0) {
    logger.info('Match-Channels aufgeräumt', { anzahl: entfernt });
  }
  return entfernt;
}

/**
 * Discord und Datenbank abgleichen.
 *
 * Ein Kanal kann von Hand geloescht worden sein, eine Ankuendigung ebenso.
 * Das Turnier bleibt vollstaendig - nur die Markierung sagt, dass die
 * Ressource fehlt, damit die Oberflaeche nicht auf etwas zeigt, das es nicht
 * mehr gibt.
 */
export async function reconcileResources(): Promise<{ fehlend: number }> {
  const ressourcen = await prisma.tournamentResource.findMany({
    where: { removedAt: null, missingSince: null, kind: 'MATCH_CHANNEL' },
    select: { id: true, discordId: true, tournamentId: true },
  });

  let fehlend = 0;

  for (const ressource of ressourcen) {
    const kanal = await discord.managedChannels.get(ressource.discordId).catch(() => null);
    if (kanal) {
      continue;
    }
    fehlend += 1;
    await prisma.tournamentResource.update({
      where: { id: ressource.id },
      data: { missingSince: new Date() },
    });
    await prisma.tournamentMatch.updateMany({
      where: { discordChannelId: ressource.discordId },
      data: { channelMissing: true },
    });
  }

  if (fehlend > 0) {
    logger.info('Fehlende Turnier-Ressourcen erkannt', { anzahl: fehlend });
  }
  return { fehlend };
}

/**
 * Nach dem Turnier aufraeumen.
 *
 * Entfernt nur, was in der Ressourcenliste steht - also nur, was das Modul
 * selbst angelegt hat.
 */
export async function cleanupTournamentResources(tournamentId: string): Promise<number> {
  const ressourcen = await prisma.tournamentResource.findMany({
    where: { tournamentId, removedAt: null, kind: 'MATCH_CHANNEL' },
  });

  let entfernt = 0;
  for (const ressource of ressourcen) {
    await discord.managedChannels
      .remove(ressource.discordId, 'Turnier abgeschlossen')
      .then(() => {
        entfernt += 1;
      })
      .catch(() => undefined);
    await prisma.tournamentResource.update({
      where: { id: ressource.id },
      data: { removedAt: new Date() },
    });
  }

  await prisma.tournamentMatch.updateMany({
    where: { tournamentId, discordChannelId: { not: null } },
    data: { discordChannelId: null, channelMissing: true },
  });

  return entfernt;
}
