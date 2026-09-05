import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import {
  discord as defaultDiscord,
  DISCORD_PERMISSIONS,
  type DiscordGateway,
  type GuildRole,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { highestRolePosition, isRoleManageableByBot, MEMBER_PERMISSIONS } from '@swisshub/permissions';
import { AppError } from '@swisshub/shared';
import type { MemberViewer } from './access';

const log = createLogger('members:roles');

/**
 * Rollen aus dem Member Center vergeben und entziehen.
 *
 * Drei Sperren, und jede fuer sich genuegt zum Nein:
 *
 * 1. **Die Berechtigung im System.** `members.roles.manage` - sonst gar nicht.
 * 2. **Die eigene Rollenhoehe.** Niemand vergibt eine Rolle, die ueber seiner
 *    eigenen liegt. Ohne diese Sperre waere jede Rollen-Berechtigung faktisch
 *    eine Administrator-Berechtigung: einmal die hoechste Rolle vergeben, und
 *    der Server gehoert jemand anderem.
 * 3. **Die Rollenhoehe des Bots.** Was ueber ihm liegt, kann er ohnehin nicht
 *    setzen - Discord lehnt es ab. Das vorher zu wissen erspart eine
 *    Fehlermeldung, die aussieht wie ein Defekt.
 *
 * Dazu kommen zwei harte Riegel: gefaehrliche Rollen und die eigene Person.
 */

/**
 * Rollen, die das Member Center grundsaetzlich nicht anfasst.
 *
 * Wer `ADMINISTRATOR` oder `MANAGE_ROLES` traegt, kann den Server umbauen.
 * Solche Rollen ueber eine Mitgliederakte zu vergeben ist der kuerzeste Weg
 * zur Rechteausweitung - dafuer gibt es die Rollenverwaltung von Discord, wo
 * die Tragweite sichtbar ist.
 */
export function istGefaehrlich(role: GuildRole): boolean {
  const bits = BigInt(role.permissions || '0');
  return (
    (bits & DISCORD_PERMISSIONS.ADMINISTRATOR) !== 0n || (bits & DISCORD_PERMISSIONS.MANAGE_ROLES) !== 0n
  );
}

export interface RollenAngebot {
  id: string;
  name: string;
  color: number;
  position: number;
  /** Traegt das Mitglied sie bereits? */
  vergeben: boolean;
  /** Darf der Betrachter sie setzen oder nehmen? */
  verwaltbar: boolean;
  /** Warum nicht - fuer eine Meldung, die erklaert statt zu blockieren. */
  grund: string | null;
}

/**
 * Was dieser Betrachter bei diesem Mitglied an Rollen tun kann.
 *
 * Liefert bewusst auch die gesperrten Rollen mit einem Grund. Eine Liste, die
 * verschweigt, was fehlt, laesst den Verwalter raten, warum eine Rolle nicht
 * auftaucht.
 */
export async function rollenAngebot(
  viewer: MemberViewer,
  ziel: { discordId: string; roleIds: readonly string[] },
  options: { gateway?: DiscordGateway } = {},
): Promise<RollenAngebot[]> {
  const gateway = options.gateway ?? defaultDiscord;
  if (!viewer.can(MEMBER_PERMISSIONS.rolesManage)) {
    return [];
  }

  const [rollen, botHoehe] = await Promise.all([
    gateway.roles.list(),
    gateway.bot.highestRolePosition().catch(() => 0),
  ]);

  const eigeneHoehe = highestRolePosition(viewer.roleIds, rollen);
  const selbst = ziel.discordId === viewer.discordId;
  const vergebene = new Set(ziel.roleIds);

  return rollen
    .filter((role) => role.position > 0)
    .sort((a, b) => b.position - a.position)
    .map((role) => {
      const grund = pruefe(role, { eigeneHoehe, botHoehe, selbst });
      return {
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        vergeben: vergebene.has(role.id),
        verwaltbar: grund === null,
        grund,
      };
    });
}

function pruefe(
  role: GuildRole,
  kontext: { eigeneHoehe: number; botHoehe: number; selbst: boolean },
): string | null {
  if (kontext.selbst) {
    return 'Eigene Rollen lassen sich hier nicht ändern.';
  }
  if (role.managed) {
    return 'Discord verwaltet diese Rolle selbst.';
  }
  if (istGefaehrlich(role)) {
    return 'Rolle mit Administrationsrechten - nur direkt in Discord vergeben.';
  }
  if (!isRoleManageableByBot(role, kontext.botHoehe)) {
    return 'Die Rolle steht über dem Bot.';
  }
  if (role.position >= kontext.eigeneHoehe) {
    return 'Die Rolle steht über deiner eigenen.';
  }
  return null;
}

export interface RollenAktion {
  viewer: MemberViewer;
  actor: { discordId: string; username: string };
  targetDiscordId: string;
  targetLabel?: string | null;
  roleId: string;
  gateway?: DiscordGateway;
}

/**
 * Prueft eine einzelne Rollenaenderung - und zwar hier, nicht in der
 * Oberflaeche.
 *
 * Die Liste oben entscheidet, welche Schaltflaechen jemand sieht. Diese
 * Pruefung entscheidet, was tatsaechlich geschieht: eine Kennung aus dem
 * Browser sagt nichts darueber, ob sie erlaubt war.
 */
async function pruefeAktion(eingabe: RollenAktion): Promise<{ gateway: DiscordGateway; role: GuildRole }> {
  const gateway = eingabe.gateway ?? defaultDiscord;

  if (!eingabe.viewer.can(MEMBER_PERMISSIONS.rolesManage)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Rollen verwalten.' });
  }
  if (eingabe.targetDiscordId === eingabe.viewer.discordId) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Eigene Rollen lassen sich hier nicht ändern.',
    });
  }

  const [rollen, botHoehe] = await Promise.all([
    gateway.roles.list(),
    gateway.bot.highestRolePosition().catch(() => 0),
  ]);
  const role = rollen.find((eintrag) => eintrag.id === eingabe.roleId);
  if (!role) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Rolle gibt es nicht.' });
  }

  const grund = pruefe(role, {
    eigeneHoehe: highestRolePosition(eingabe.viewer.roleIds, rollen),
    botHoehe,
    selbst: false,
  });
  if (grund !== null) {
    throw new AppError('FORBIDDEN', { userMessage: grund });
  }

  return { gateway, role };
}

/** Gibt einem Mitglied eine Rolle. */
export async function grantMemberRole(eingabe: RollenAktion): Promise<void> {
  const { gateway, role } = await pruefeAktion(eingabe);

  await gateway.roles.add(eingabe.targetDiscordId, role.id, `Member Center: ${eingabe.actor.username}`);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MEMBER_ROLE_GRANTED,
    module: 'members',
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: eingabe.targetDiscordId,
    targetLabel: eingabe.targetLabel ?? null,
    metadata: { roleId: role.id, roleName: role.name },
  });
  log.info('Rolle vergeben', { roleId: role.id, target: eingabe.targetDiscordId });
}

/** Nimmt einem Mitglied eine Rolle. */
export async function revokeMemberRole(eingabe: RollenAktion): Promise<void> {
  const { gateway, role } = await pruefeAktion(eingabe);

  await gateway.roles.remove(eingabe.targetDiscordId, role.id, `Member Center: ${eingabe.actor.username}`);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MEMBER_ROLE_REVOKED,
    module: 'members',
    actorDiscordId: eingabe.actor.discordId,
    actorUsername: eingabe.actor.username,
    targetDiscordId: eingabe.targetDiscordId,
    targetLabel: eingabe.targetLabel ?? null,
    metadata: { roleId: role.id, roleName: role.name },
  });
  log.info('Rolle entzogen', { roleId: role.id, target: eingabe.targetDiscordId });
}
