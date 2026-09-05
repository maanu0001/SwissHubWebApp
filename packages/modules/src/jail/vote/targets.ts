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
  return siebeZulaessige(kandidaten, actor, limit, gateway, options.context);
}

/**
 * Aussieben, was ohnehin abgelehnt wuerde.
 *
 * Eine Stelle fuer beide Wege: zwei Fassungen derselben Pruefung liefen
 * frueher oder spaeter auseinander, und dann zeigte der eine Weg Ziele, die
 * der andere verweigert.
 */
async function siebeZulaessige(
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

  const belegt = new Set<string>([
    ...gejailt.map((eintrag) => eintrag.activeKey).filter((key): key is string => key !== null),
    ...laufendeAbstimmungen.map((eintrag) => eintrag.activeKey).filter((key): key is string => key !== null),
  ]);

  return kandidaten
    .filter((mitglied) => !belegt.has(mitglied.discordId))
    .filter(
      (mitglied) =>
        evaluateModerationPolicy({
          // Derselbe Massstab wie beim Starten - sonst zeigte die Suche Ziele,
          // die beim Klick abgewiesen wuerden.
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
        }).allowed,
    )
    .slice(0, limit)
    .map((mitglied) => ({
      discordId: mitglied.discordId,
      username: mitglied.username,
      displayName: mitglied.displayName,
      avatarHash: mitglied.avatarHash,
    }));
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
    const mitglied = await gateway.members.get(query).catch(() => null);
    return mitglied ? [mitglied] : [];
  }
  if (query.length < 2) {
    return [];
  }
  // Grosszuegiger suchen als anzeigen: die Policy siebt anschliessend aus,
  // und sonst bliebe von zwanzig Treffern womoeglich einer uebrig.
  return gateway.members.search(query, Math.min(limit * 2, MAX_KANDIDATEN)).catch(() => []);
}
