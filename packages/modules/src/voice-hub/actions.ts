import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';
import { allowMember, clearMemberAccess, denyMember, kickMember, transferOwnership } from '../voice/members';
import { deleteTemporaryVoice } from '../voice/lifecycle';
import {
  renameTemporaryVoice,
  setTemporaryVoiceLimit,
  setTemporaryVoiceLocked,
  type VoiceActor,
} from '../voice/service';
import { aktualisiereBedienfeld } from './control-panel';
import { assertVoiceRecht, assertWebAppErlaubt, ladeKanalMitZugriff, type VoiceViewer } from './access';

/**
 * Die Aktionen eines Talks.
 *
 * Genau eine Fassung fuer beide Oberflaechen: der Knopf im Discord-Bedienfeld
 * und der Knopf im Dashboard rufen dieselbe Funktion auf. Zwei Fassungen
 * derselben Regel laufen frueher oder spaeter auseinander - und dann verhaelt
 * sich der Talk auf Discord anders als im Dashboard.
 *
 * Jede Funktion hier laedt den Talk selbst und prueft den Zugriff selbst. Sie
 * verlaesst sich nicht darauf, dass der Aufrufer das schon getan hat.
 */

export interface AktionsKontext {
  viewer: VoiceViewer;
  actor: VoiceActor;
}

/**
 * Talk laden, Zugriff pruefen - und den Weg pruefen.
 *
 * `wegPruefen` ist der Regelfall: den eigenen Talk bedient man auf Discord.
 * Zwei Bedienfelder fuer dieselbe Sache waren eines zu viel, und das im
 * Browser war das umstaendlichere - es verlangte, den Server zu verlassen, um
 * den Kanal zu aendern, in dem man gerade sitzt.
 *
 * Die Verwaltung bleibt ausgenommen: sie greift von aussen ein, oft in einen
 * Talk, in dem sie gar nicht sitzt.
 */
async function lade(kontext: AktionsKontext, kanalId: string, wegPruefen = true) {
  const guildId = await resolveGuildId();
  const ergebnis = await ladeKanalMitZugriff(kontext.viewer, kanalId, guildId);
  if (wegPruefen && kontext.actor.source === 'WEBAPP') {
    assertWebAppErlaubt(ergebnis.zugriff);
  }
  return ergebnis;
}

export async function renameTalk(
  kontext: AktionsKontext,
  kanalId: string,
  name: string,
): Promise<TemporaryVoiceChannel> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'manage', 'Du kannst diesen Talk nicht umbenennen.');

  const aktualisiert = await renameTemporaryVoice(kanal, name, kontext.actor, {
    cooldownSeconds: kanal.preset?.renameCooldownSeconds ?? 300,
    // Die Verwaltung umgeht die Abkuehlzeit nicht: das Rate-Limit kommt von
    // Discord und trifft den Bot, nicht die Person.
    ignoriereCooldown: false,
  });
  await aktualisiereBedienfeld(aktualisiert);
  return aktualisiert;
}

export async function setTalkLimit(
  kontext: AktionsKontext,
  kanalId: string,
  limit: number,
): Promise<TemporaryVoiceChannel> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'manage', 'Du kannst das Limit dieses Talks nicht ändern.');

  const aktualisiert = await setTemporaryVoiceLimit(
    kanal,
    limit,
    kontext.actor,
    kanal.preset?.maxUserLimit ?? 99,
  );
  await aktualisiereBedienfeld(aktualisiert);
  return aktualisiert;
}

export async function setTalkLocked(
  kontext: AktionsKontext,
  kanalId: string,
  locked: boolean,
): Promise<TemporaryVoiceChannel> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'manage', 'Du kannst diesen Talk nicht sperren.');

  const aktualisiert = await setTemporaryVoiceLocked(kanal, locked, kontext.actor);
  await aktualisiereBedienfeld(aktualisiert);
  return aktualisiert;
}

/** Setzt das Spiel als Metadatum - Discord-Aktivitaeten bleiben unberuehrt. */
export async function setTalkGame(
  kontext: AktionsKontext,
  kanalId: string,
  spiel: string | null,
): Promise<TemporaryVoiceChannel> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'manage', 'Du kannst dieses Talk-Thema nicht ändern.');

  const aktualisiert = await prisma.temporaryVoiceChannel.update({
    where: { id: kanal.id },
    data: { gameName: spiel?.slice(0, 60) ?? null, lastActiveAt: new Date() },
  });
  await aktualisiereBedienfeld(aktualisiert);
  return aktualisiert;
}

export async function allowInTalk(
  kontext: AktionsKontext,
  kanalId: string,
  ziel: { discordId: string; username?: string | null },
): Promise<void> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'members', 'Du kannst den Zugriff auf diesen Talk nicht steuern.');

  await allowMember(kanal, ziel, kontext.actor);
  await aktualisiereBedienfeld(kanal);
}

export async function denyInTalk(
  kontext: AktionsKontext,
  kanalId: string,
  ziel: { discordId: string; username?: string | null },
  optionen: { auchEntfernen?: boolean } = {},
): Promise<{ entfernt: boolean }> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'members', 'Du kannst den Zugriff auf diesen Talk nicht steuern.');

  await denyMember(kanal, ziel, kontext.actor);

  // Sperren wirft niemanden hinaus - das ist ein eigener Schritt und eine
  // eigene Entscheidung. Wer beides will, sagt es.
  let entfernt = false;
  if (optionen.auchEntfernen) {
    entfernt = await kickMember(kanal, ziel.discordId, kontext.actor);
  }

  await aktualisiereBedienfeld(kanal);
  return { entfernt };
}

export async function clearTalkAccess(
  kontext: AktionsKontext,
  kanalId: string,
  discordId: string,
): Promise<void> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'members', 'Du kannst den Zugriff auf diesen Talk nicht steuern.');

  await clearMemberAccess(kanal, discordId, kontext.actor);
  await aktualisiereBedienfeld(kanal);
}

export async function kickFromTalk(
  kontext: AktionsKontext,
  kanalId: string,
  discordId: string,
): Promise<boolean> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'members', 'Du kannst niemanden aus diesem Talk entfernen.');

  return kickMember(kanal, discordId, kontext.actor);
}

export async function transferTalk(
  kontext: AktionsKontext,
  kanalId: string,
  neuerBesitzer: { discordId: string; username: string },
): Promise<TemporaryVoiceChannel> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'transfer', 'Du kannst diesen Talk nicht übergeben.');

  const aktualisiert = await transferOwnership(kanal, neuerBesitzer, kontext.actor, {
    ownerModeration: kanal.preset?.ownerModeration ?? true,
  });
  await aktualisiereBedienfeld(aktualisiert);
  return aktualisiert;
}

export async function deleteTalk(kontext: AktionsKontext, kanalId: string): Promise<void> {
  const { kanal, zugriff } = await lade(kontext, kanalId);
  assertVoiceRecht(zugriff, 'destroy', 'Du kannst diesen Talk nicht schliessen.');

  await deleteTemporaryVoice(
    kanal,
    kontext.actor,
    zugriff.alsVerwaltung ? 'Von der Serverleitung geschlossen' : 'Vom Besitzer geschlossen',
  );
}

/**
 * Legt das Bedienfeld neu an - fuer den Fall, dass es jemand geloescht hat.
 *
 * Die eine Ausnahme von der Discord-Regel, und zwar aus einem Grund: wer sein
 * Bedienfeld verloren hat, kann es nicht ueber das Bedienfeld zurueckholen.
 * Ohne diesen Weg bliebe ihm nur, den Talk zu schliessen und neu zu oeffnen.
 */
export async function repairTalkPanel(kontext: AktionsKontext, kanalId: string): Promise<boolean> {
  const { kanal, zugriff } = await lade(kontext, kanalId, false);
  assertVoiceRecht(zugriff, 'manage', 'Du kannst dieses Bedienfeld nicht erneuern.');

  const { repariereBedienfeld } = await import('./control-panel');
  return repariereBedienfeld(kanal);
}

/** Der Talk, den diese Person gerade besitzt - fuer die eigene Seite. */
export async function eigenerTalk(discordId: string): Promise<TemporaryVoiceChannel | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.temporaryVoiceChannel.findFirst({
    where: {
      guildId,
      ownerDiscordId: discordId,
      closedAt: null,
      discordChannelId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export { AppError };
