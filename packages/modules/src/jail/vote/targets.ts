import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway, type GuildMember } from '@swisshub/discord';
import { evaluateModerationPolicy } from '@swisshub/permissions';
import { isSnowflake, sanitizeText } from '@swisshub/shared';
import { loadJailContext, type JailExecutionContext } from '../context';
import type { VoteJailActor } from './service';

/**
 * Wie ein Vote Jail zu seinem Ziel kommt.
 *
 * Bedient wird das wie bei «Bannen»: derselbe Picker, dasselbe Tippen,
 * dieselben Vorschlaege. Das ist Absicht - wer eine Abstimmung startet, soll
 * nicht erst eine Discord-Kennung aus dem Profil klauben muessen, waehrend
 * das Team nebenan einfach einen Namen eintippt.
 *
 * Was sich unterscheidet, steht nicht im Formular, sondern in der Antwort.
 * Die allgemeine Mitgliedersuche beantwortet «wer ist alles da?» und gehoert
 * zum Member Center - mit Profilen, Notizen und Moderationsakte dahinter.
 * Diese hier beantwortet nur «gegen wen koennte ich abstimmen lassen?».
 *
 * Zurueck kommt deshalb ausschliesslich, gegen wen dieser Handelnde
 * tatsaechlich eine Abstimmung starten koennte - dieselbe Policy, die
 * `startVoteJail` anwendet. Ein Ziel, das beim Klick abgelehnt wuerde, waere
 * in der Liste zugleich eine Auskunft darueber, wer geschuetzt ist.
 *
 * Und es kommt wenig zurueck: Name, Anzeigename, Avatar. Keine Rollen, kein
 * Beitrittsdatum, keine Moderationsakte. Was hier nicht steht, laesst sich
 * ueber diesen Weg auch nicht erfragen.
 *
 * Eine Kennung wird ebenso aufgeloest wie ein Name - durch dieselbe Suche,
 * durch dieselbe Pruefung. Wer eine kennt, tippt sie einfach ein.
 */

export interface VoteJailTarget {
  discordId: string;
  username: string;
  displayName: string;
  avatarHash: string | null;
  /**
   * Ob gegen dieses Mitglied abgestimmt werden darf.
   *
   * Frueher wurden die Unzulaessigen einfach weggelassen. Das hat einen Fall
   * unsichtbar gemacht, der haeufiger vorkommt als gedacht: die Suche fand
   * jemanden, die Policy sortierte ihn aus, und uebrig blieb eine leere
   * Liste, die aussah wie «gibt es nicht». Wer wusste, dass die Person auf
   * dem Server ist, stand vor einem Raetsel.
   *
   * Jetzt steht der Treffer da und sagt, warum er nicht geht. Preisgegeben
   * wird damit nichts, was nicht ohnehin auf Discord sichtbar waere - eine
   * Rolle ist oeffentlich.
   */
  waehlbar: boolean;
  /** Kurze Begruendung, wenn `waehlbar` false ist. */
  grund: string | null;
  /**
   * Was man dagegen tun kann - wenn ueberhaupt etwas.
   *
   * Der Grund allein sagt «geht nicht». Bei einer Moderationsstufe ist das
   * aber keine Eigenschaft der Person, sondern eine Einstellung an einer
   * Rolle, und die laesst sich aendern. Wer das nicht weiss, haelt es fuer
   * einen Fehler des Systems.
   */
  hinweis: string | null;
}

export interface VoteJailTargetOptions {
  limit?: number;
  gateway?: DiscordGateway;
  context?: JailExecutionContext;
}

/** Obergrenze der Kandidaten, die geprüft werden. */
const MAX_KANDIDATEN = 50;

export async function searchVoteJailTargets(
  rawQuery: string,
  actor: VoteJailActor,
  options: VoteJailTargetOptions = {},
): Promise<VoteJailTarget[]> {
  const gateway = options.gateway ?? defaultDiscord;
  const query = sanitizeText(rawQuery, 100);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_KANDIDATEN);

  const kandidaten = await ladeKandidaten(query, limit, gateway);
  return bewerteKandidaten(kandidaten, actor, limit, gateway, options.context);
}

/**
 * Jeden Kandidaten bewerten - und keinen verschweigen.
 *
 * Eine Stelle fuer alle Wege: zwei Fassungen derselben Pruefung liefen
 * frueher oder spaeter auseinander, und dann zeigte der eine Weg Ziele, die
 * der andere verweigert.
 *
 * Bewertet statt gefiltert. Der Unterschied ist der zwischen «da ist niemand»
 * und «da ist jemand, aber gegen den geht es nicht» - und genau den hat die
 * alte Fassung eingeebnet.
 */
async function bewerteKandidaten(
  kandidaten: GuildMember[],
  actor: VoteJailActor,
  limit: number,
  gateway: DiscordGateway,
  vorhandenerKontext?: JailExecutionContext,
): Promise<VoteJailTarget[]> {
  if (kandidaten.length === 0) {
    return [];
  }

  const context = vorhandenerKontext ?? (await loadJailContext(gateway));

  // Wer bereits gejailt ist oder gegen wen schon abgestimmt wird, ist kein
  // Ziel mehr - `startVoteJail` weist beides ab.
  const ids = kandidaten.map((mitglied) => mitglied.discordId);
  const [gejailt, laufendeAbstimmungen] = await Promise.all([
    prisma.jailEntry.findMany({
      where: { activeKey: { in: ids } },
      select: { activeKey: true },
    }),
    prisma.voteJail.findMany({
      where: { activeKey: { in: ids } },
      select: { activeKey: true },
    }),
  ]);

  const imJail = new Set(
    gejailt.map((eintrag) => eintrag.activeKey).filter((key): key is string => key !== null),
  );
  const inAbstimmung = new Set(
    laufendeAbstimmungen.map((eintrag) => eintrag.activeKey).filter((key): key is string => key !== null),
  );

  return kandidaten.slice(0, limit).map((mitglied) => {
    const grund = ablehnungsgrund(mitglied, actor, context, imJail, inAbstimmung);
    return {
      discordId: mitglied.discordId,
      username: mitglied.username,
      displayName: mitglied.displayName,
      avatarHash: mitglied.avatarHash,
      waehlbar: grund === null,
      grund,
      hinweis: grund === 'Moderationsstufe' ? stufenHinweis(mitglied, context) : null,
    };
  });
}

/**
 * Warum gegen dieses Mitglied keine Abstimmung laufen kann - oder `null`.
 *
 * Kurz gehalten und ohne Innenansicht: «Moderation» sagt genug, «traegt Rolle
 * X mit Stufe 2» waere eine Auskunft ueber die Rollenordnung.
 */
function ablehnungsgrund(
  mitglied: GuildMember,
  actor: VoteJailActor,
  context: JailExecutionContext,
  imJail: ReadonlySet<string>,
  inAbstimmung: ReadonlySet<string>,
): string | null {
  if (imJail.has(mitglied.discordId)) {
    return 'Bereits gejailt';
  }
  if (inAbstimmung.has(mitglied.discordId)) {
    return 'Abstimmung läuft bereits';
  }

  const entscheidung = evaluateModerationPolicy({
    // Derselbe Massstab wie beim Starten - sonst zeigte die Suche Ziele, die
    // beim Klick abgewiesen wuerden.
    kind: 'COMMUNITY_VOTE',
    actor: {
      discordId: actor.discordId,
      roleIds: actor.roleIds,
      isOwner: actor.isOwner,
      moderationLevel: actor.moderationLevel,
    },
    target: mitglied,
    guildRoles: context.guildRoles,
    protectedRoleIds: context.protectedRoleIds,
    moderationLevels: context.moderationLevels,
    botHighestPosition: context.botHighestPosition,
    botUserId: context.botUserId,
    guildOwnerId: context.guildOwnerId,
  });
  if (entscheidung.allowed) {
    return null;
  }

  switch (entscheidung.code) {
    case 'SELF_TARGET':
      return 'Du selbst';
    case 'TARGET_IS_BOT':
      return 'Bot';
    case 'TARGET_IS_OWNER':
      return 'Serverleitung';
    case 'TARGET_PROTECTED_ROLE':
      return 'Geschützte Rolle';
    case 'TARGET_HIGHER_MODERATION_LEVEL':
      return 'Moderationsstufe';
    case 'BOT_ROLE_TOO_LOW':
      // Der einzige Grund, der keine Eigenschaft des Ziels ist, sondern eine
      // der Einrichtung. Deshalb sagt er das auch: sonst suchte jemand den
      // Fehler beim Mitglied, und die Rollenordnung bliebe, wie sie ist.
      return 'Bot-Rolle zu niedrig';
    default:
      return 'Nicht möglich';
  }
}

/**
 * Welche Rolle die Moderationsstufe mitbringt - und was das heisst.
 *
 * Ohne den Rollennamen bleibt «Moderationsstufe» ein Urteil ohne Begruendung.
 * Mit ihm ist es ein Hinweis: die Stufe steht an einer bestimmten Rolle, sie
 * ist eine Einstellung, und wer sie fuer falsch haelt, findet sie unter
 * Server -> Berechtigungen.
 *
 * Das gibt nichts preis: welche Rollen jemand traegt, steht auf Discord
 * ohnehin neben seinem Namen.
 */
function stufenHinweis(mitglied: GuildMember, context: JailExecutionContext): string | null {
  let hoechste: { name: string; stufe: number } | null = null;
  for (const roleId of mitglied.roleIds) {
    const stufe = context.moderationLevels.get(roleId) ?? 0;
    if (stufe > 0 && (hoechste === null || stufe > hoechste.stufe)) {
      const rolle = context.guildRoles.find((eintrag) => eintrag.id === roleId);
      hoechste = { name: rolle?.name ?? 'unbekannte Rolle', stufe };
    }
  }
  if (!hoechste) {
    return null;
  }
  return (
    `Die Rolle «${hoechste.name}» trägt die Moderationsstufe ${hoechste.stufe} und gilt damit als Team. ` +
    'Soll gegen ihre Träger abgestimmt werden können, ist die Stufe unter Server → Berechtigungen auf 0 zu setzen.'
  );
}

/**
 * Die Kandidaten von Discord.
 *
 * Eine Kennung wird direkt aufgeloest - so laesst sich jemand auch dann
 * waehlen, wenn sein Anzeigename nichts hergibt. Ohne Suchbegriff kommt
 * nichts zurueck: eine leere Eingabe ist keine Anfrage nach der ganzen
 * Mitgliederliste.
 */
async function ladeKandidaten(query: string, limit: number, gateway: DiscordGateway): Promise<GuildMember[]> {
  if (isSnowflake(query)) {
    // Hier bleibt das `catch`: eine Kennung, zu der es niemanden gibt, ist
    // eine gueltige Antwort und kein Fehler.
    const mitglied = await gateway.members.get(query).catch(() => null);
    return mitglied ? [mitglied] : [];
  }
  if (query.length < 2) {
    return [];
  }
  // Grosszuegiger suchen als anzeigen: die Policy siebt anschliessend aus,
  // und sonst bliebe von zwanzig Treffern womoeglich einer uebrig.
  //
  // Ohne `catch`, und das ist der Punkt. Hier stand einmal `.catch(() => [])`,
  // und damit sah jeder Fehler von Discord aus wie ein Ergebnis: keine
  // Berechtigung, ein Rate Limit, ein Aussetzer - alles wurde zur leeren
  // Liste. Im Browser blieb davon ein Ladekringel, der verschwindet, und ein
  // leeres Feld. Wer das sieht, sucht den Fehler bei sich.
  //
  // Ein Fehler ist kein leeres Ergebnis. Er gehoert nach oben durchgereicht,
  // damit die Maske ihn zeigen kann.
  return gateway.members.search(query, Math.min(limit * 2, MAX_KANDIDATEN));
}
