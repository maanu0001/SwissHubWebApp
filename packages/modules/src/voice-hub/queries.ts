import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel, VoiceHub, VoicePreset } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';

/**
 * Abfragen fuer Uebersicht, Verwaltung und Statistik.
 *
 * Alles nach Server gefiltert. Der Bestand traegt die Serverkennung ueberall
 * mit, und sie auszuwerten kostet nichts - ohne sie zeigte eine
 * wiederhergestellte Sicherung fremde Talks.
 */

export interface AktiverTalk {
  kanal: TemporaryVoiceChannel;
  hub: Pick<VoiceHub, 'id' | 'name'> | null;
  preset: Pick<VoicePreset, 'id' | 'name' | 'maxUserLimit'> | null;
  /** Wer gerade drin sitzt - aus der Anwesenheitstabelle, nicht von Discord. */
  mitglieder: Array<{ discordId: string; displayName: string | null; isBot: boolean }>;
}

/**
 * Die laufenden Talks.
 *
 * Die Mitglieder kommen aus `VoicePresence` - der Tabelle, die der Bot aus dem
 * Gateway mitschreibt. Die WebApp ist ein eigener Prozess und sieht die
 * Voice-Zustaende nicht; Discord dafuer je Kanal zu fragen waere ein Aufruf
 * pro Talk bei jedem Seitenaufbau.
 */
export async function listActiveTalks(
  optionen: { source?: 'VOICE_HUB' | 'PLAYER_SEARCH'; ownerDiscordId?: string; limit?: number } = {},
): Promise<AktiverTalk[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }

  const kanaele = await prisma.temporaryVoiceChannel.findMany({
    where: {
      guildId,
      closedAt: null,
      discordChannelId: { not: null },
      ...(optionen.source ? { source: optionen.source } : {}),
      ...(optionen.ownerDiscordId ? { ownerDiscordId: optionen.ownerDiscordId } : {}),
    },
    include: {
      hub: { select: { id: true, name: true } },
      preset: { select: { id: true, name: true, maxUserLimit: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: optionen.limit ?? 200,
  });

  if (kanaele.length === 0) {
    return [];
  }

  const kennungen = kanaele.map((kanal) => kanal.discordChannelId!).filter(Boolean);
  const anwesend = await prisma.voicePresence.findMany({
    where: { guildId, channelId: { in: kennungen } },
    select: { discordId: true, channelId: true, displayName: true, isBot: true },
  });

  const nachKanal = new Map<
    string,
    Array<{ discordId: string; displayName: string | null; isBot: boolean }>
  >();
  for (const eintrag of anwesend) {
    const liste = nachKanal.get(eintrag.channelId) ?? [];
    liste.push({
      discordId: eintrag.discordId,
      displayName: eintrag.displayName,
      isBot: eintrag.isBot,
    });
    nachKanal.set(eintrag.channelId, liste);
  }

  return kanaele.map(({ hub, preset, ...kanal }) => ({
    kanal,
    hub,
    preset,
    mitglieder: nachKanal.get(kanal.discordChannelId!) ?? [],
  }));
}

/** Ein einzelner Talk samt Mitgliedern und Ausnahmen. */
export async function getTalkDetail(kanalId: string) {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }

  const kanal = await prisma.temporaryVoiceChannel.findFirst({
    where: { id: kanalId, guildId },
    include: {
      hub: { select: { id: true, name: true } },
      preset: true,
      access: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!kanal) {
    return null;
  }

  const mitglieder = kanal.discordChannelId
    ? await prisma.voicePresence.findMany({
        where: { guildId, channelId: kanal.discordChannelId },
        orderBy: { updatedAt: 'asc' },
      })
    : [];

  return { ...kanal, mitglieder };
}

export interface VoiceHubStats {
  aktiveTalks: number;
  personenInTalks: number;
  talksHeute: number;
  talks7Tage: number;
  talks30Tage: number;
  /** Durchschnittliche Dauer in Minuten; `null`, wenn nichts gemessen. */
  durchschnittsdauerMinuten: number | null;
  /** Durchschnittlicher Hoechststand an Teilnehmern; `null` ohne Daten. */
  durchschnittTeilnehmer: number | null;
  /** Groesste gleichzeitige Zahl offener Talks im Beobachtungszeitraum. */
  peakTalks: number;
  beliebtesteHubs: Array<{ name: string; anzahl: number }>;
}

/**
 * Kennzahlen des Moduls.
 *
 * Nur gemessene Zahlen. Wo nichts gemessen wurde, steht `null` und die
 * Oberflaeche zeigt einen Strich - eine erfundene Durchschnittsdauer waere
 * schlimmer als gar keine, weil man sich auf sie verliesse.
 *
 * Bewusst aggregiert: wer wann wie lange in welchem Talk sass, waere eine
 * Bewegungsakte und steht hier nicht.
 */
export async function getVoiceHubStats(): Promise<VoiceHubStats> {
  const guildId = await resolveGuildId().catch(() => null);
  const leer: VoiceHubStats = {
    aktiveTalks: 0,
    personenInTalks: 0,
    talksHeute: 0,
    talks7Tage: 0,
    talks30Tage: 0,
    durchschnittsdauerMinuten: null,
    durchschnittTeilnehmer: null,
    peakTalks: 0,
    beliebtesteHubs: [],
  };
  if (!guildId) {
    return leer;
  }

  const jetzt = new Date();
  const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const vor7 = new Date(jetzt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const vor30 = new Date(jetzt.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [aktive, talksHeute, talks7, talks30, geschlossene, nachHub] = await Promise.all([
    prisma.temporaryVoiceChannel.findMany({
      where: { guildId, closedAt: null, discordChannelId: { not: null } },
      select: { discordChannelId: true },
    }),
    prisma.temporaryVoiceChannel.count({ where: { guildId, createdAt: { gte: heute } } }),
    prisma.temporaryVoiceChannel.count({ where: { guildId, createdAt: { gte: vor7 } } }),
    prisma.temporaryVoiceChannel.count({ where: { guildId, createdAt: { gte: vor30 } } }),
    prisma.temporaryVoiceChannel.findMany({
      where: { guildId, closedAt: { not: null, gte: vor30 } },
      select: { createdAt: true, closedAt: true, peakMembers: true },
      take: 5000,
    }),
    prisma.temporaryVoiceChannel.groupBy({
      by: ['hubId'],
      where: { guildId, createdAt: { gte: vor30 }, hubId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { hubId: 'desc' } },
      take: 5,
    }),
  ]);

  const kennungen = aktive.map((eintrag) => eintrag.discordChannelId!).filter(Boolean);
  const personen =
    kennungen.length > 0
      ? await prisma.voicePresence.count({
          where: { guildId, channelId: { in: kennungen }, isBot: false },
        })
      : 0;

  const dauern = geschlossene
    .filter((eintrag) => eintrag.closedAt !== null)
    .map((eintrag) => (eintrag.closedAt!.getTime() - eintrag.createdAt.getTime()) / 60_000)
    // Reservierungen, die nie ein Kanal wurden, verzerren den Schnitt.
    .filter((minuten) => minuten > 0.1);

  const hubNamen = await prisma.voiceHub.findMany({
    where: { id: { in: nachHub.map((eintrag) => eintrag.hubId!).filter(Boolean) } },
    select: { id: true, name: true },
  });
  const nameZuId = new Map(hubNamen.map((hub) => [hub.id, hub.name]));

  return {
    aktiveTalks: aktive.length,
    personenInTalks: personen,
    talksHeute,
    talks7Tage: talks7,
    talks30Tage: talks30,
    durchschnittsdauerMinuten:
      dauern.length === 0
        ? null
        : Math.round(dauern.reduce((summe, wert) => summe + wert, 0) / dauern.length),
    durchschnittTeilnehmer:
      geschlossene.length === 0
        ? null
        : Math.round(
            (geschlossene.reduce((summe, eintrag) => summe + eintrag.peakMembers, 0) / geschlossene.length) *
              10,
          ) / 10,
    peakTalks: await peakGleichzeitig(guildId, vor30),
    beliebtesteHubs: nachHub.map((eintrag) => ({
      name: nameZuId.get(eintrag.hubId!) ?? 'Entfernter Hub',
      anzahl: eintrag._count._all,
    })),
  };
}

/**
 * Der Hoechststand gleichzeitig offener Talks.
 *
 * Gerechnet aus Beginn und Ende der Zeilen: jeder Beginn erhoeht den Zaehler,
 * jedes Ende senkt ihn. Das ist genauer als eine Stichprobe alle paar Minuten
 * und kostet keine zusaetzliche Tabelle.
 */
async function peakGleichzeitig(guildId: string, seit: Date): Promise<number> {
  const zeilen = await prisma.temporaryVoiceChannel.findMany({
    where: { guildId, createdAt: { gte: seit }, discordChannelId: { not: null } },
    select: { createdAt: true, closedAt: true },
    take: 5000,
  });

  const punkte: Array<{ zeit: number; delta: number }> = [];
  for (const zeile of zeilen) {
    punkte.push({ zeit: zeile.createdAt.getTime(), delta: 1 });
    punkte.push({ zeit: (zeile.closedAt ?? new Date()).getTime(), delta: -1 });
  }
  // Endet und beginnt etwas im selben Moment, zuerst das Ende zaehlen - sonst
  // entstuende ein Hoechststand, den es nie gab.
  punkte.sort((a, b) => a.zeit - b.zeit || a.delta - b.delta);

  let laufend = 0;
  let peak = 0;
  for (const punkt of punkte) {
    laufend += punkt.delta;
    peak = Math.max(peak, laufend);
  }
  return peak;
}

/** Der Verlauf eines Talks. */
export async function getTalkEvents(kanalId: string, limit = 50) {
  return prisma.voiceHubEvent.findMany({
    where: { channelId: kanalId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
