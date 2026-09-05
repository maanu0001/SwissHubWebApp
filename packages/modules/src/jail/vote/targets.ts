import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway, type GuildMember } from '@swisshub/discord';
import { evaluateModerationPolicy } from '@swisshub/permissions';
import { isSnowflake, sanitizeText } from '@swisshub/shared';
import { loadJailContext, type JailExecutionContext } from '../context';
import type { VoteJailActor } from './service';

/**
 * Die Zielsuche des Vote Jail.
 *
 * Sie besteht, weil die allgemeine Mitgliedersuche die falsche Berechtigung
 * verlangte: `members.view` oeffnet das Member Center mit Profilen, Notizen
 * und Moderationsakte. Wer eine Community-Abstimmung starten darf, brauchte
 * sie trotzdem - und bekam sie entweder nicht (dann liess sich kein Ziel
 * waehlen) oder bekam mit ihr weit mehr, als er sollte.
 *
 * Diese Suche verlangt deshalb genau das Recht, das zur Sache gehoert:
 * `jail.vote.start`. Ein eigener Schluessel nur fuers Suchen waere eine
 * Berechtigung ohne eigenen Sinn - wer keine Abstimmung starten darf, hat
 * kein Ziel zu suchen, und wer eine starten darf, muss eines waehlen koennen.
 *
 * Sie gibt weniger zurueck als die Mitgliedersuche: Name, Anzeigename,
 * Avatar. Keine Rollen, kein Beitrittsdatum, keine Moderationsakte, kein
 * Jail-Grund. Was hier nicht steht, kann ueber diesen Weg auch nicht
 * abgefragt werden.
 *
 * Und sie filtert serverseitig: zurueck kommt ausschliesslich, gegen wen
 * dieser Handelnde tatsaechlich eine Abstimmung starten koennte - dieselbe
 * Policy, die `startVoteJail` anwendet. Eine Liste, die Ziele zeigt, die beim
 * Klick abgelehnt werden, waere zugleich eine Auskunft darueber, wer
 * geschuetzt ist.
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
  if (kandidaten.length === 0) {
    return [];
  }

  const context = options.context ?? (await loadJailContext(gateway));

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
    ...laufendeAbstimmungen
      .map((eintrag) => eintrag.activeKey)
      .filter((key): key is string => key !== null),
  ]);

  return kandidaten
    .filter((mitglied) => !belegt.has(mitglied.discordId))
    .filter(
      (mitglied) =>
        evaluateModerationPolicy({
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
async function ladeKandidaten(
  query: string,
  limit: number,
  gateway: DiscordGateway,
): Promise<GuildMember[]> {
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
