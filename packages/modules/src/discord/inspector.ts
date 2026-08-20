import {
  combinePermissions,
  discord,
  hasDiscordPermission,
  missingPermissions,
  DISCORD_PERMISSION_LABELS,
  type DiscordPermissionName,
} from '@swisshub/discord';
import { listModuleDefinitions } from '../registry';
import { enabledModuleIds } from '../module-state';
import { listCachedRoles, type CachedRole } from './sync';

/**
 * Discord Permission Inspector.
 *
 * Beantwortet zwei Fragen, die im Betrieb ständig auftauchen:
 *  1. Darf der Bot alles, was die aktivierten Module brauchen?
 *  2. Steht die Bot-Rolle hoch genug, um die verwalteten Rollen zu vergeben?
 */

/** Berechtigungen, die die Anwendung immer benötigt. */
export const CORE_REQUIRED_PERMISSIONS: DiscordPermissionName[] = [
  'VIEW_CHANNEL',
  'MANAGE_ROLES',
  'SEND_MESSAGES',
  'EMBED_LINKS',
];

export interface BotPermissionCheck {
  permission: DiscordPermissionName;
  label: string;
  granted: boolean;
  /** Module, die diese Berechtigung benötigen (`core` = Grundfunktionen). */
  requiredBy: string[];
}

export interface BotPermissionReport {
  available: boolean;
  botUserId: string | null;
  botUsername: string | null;
  botHighestPosition: number;
  botRoleName: string | null;
  isAdministrator: boolean;
  checks: BotPermissionCheck[];
  missing: DiscordPermissionName[];
}

/** Prüft die Discord-Berechtigungen des Bots gegen die aktivierten Module. */
export async function inspectBotPermissions(): Promise<BotPermissionReport> {
  const [identity, botMember, roles, enabled] = await Promise.all([
    discord.bot.identity().catch(() => null),
    discord.bot.member().catch(() => null),
    listCachedRoles({ includeDeleted: false }).catch(() => [] as CachedRole[]),
    enabledModuleIds().catch(() => new Set<string>()),
  ]);

  if (!identity || !botMember) {
    return {
      available: false,
      botUserId: identity?.id ?? null,
      botUsername: identity?.username ?? null,
      botHighestPosition: 0,
      botRoleName: null,
      isAdministrator: false,
      checks: [],
      missing: [],
    };
  }

  const botRoles = roles.filter((role) => botMember.roleIds.includes(role.id));
  const total = combinePermissions(botRoles.map((role) => role.permissions));
  const highest = botRoles.reduce<CachedRole | null>(
    (best, role) => (best === null || role.position > best.position ? role : best),
    null,
  );

  // Anforderungen der Module einsammeln.
  const requirements = new Map<DiscordPermissionName, Set<string>>();
  for (const permission of CORE_REQUIRED_PERMISSIONS) {
    requirements.set(permission, new Set(['core']));
  }
  for (const definition of listModuleDefinitions()) {
    if (!definition.core && !enabled.has(definition.id)) {
      continue;
    }
    for (const permission of definition.requiredDiscordPermissions ?? []) {
      const entry = requirements.get(permission) ?? new Set<string>();
      entry.add(definition.name);
      requirements.set(permission, entry);
    }
  }

  const checks: BotPermissionCheck[] = [...requirements.entries()]
    .map(([permission, requiredBy]) => ({
      permission,
      label: DISCORD_PERMISSION_LABELS[permission],
      granted: hasDiscordPermission(total, permission),
      requiredBy: [...requiredBy],
    }))
    .sort((a, b) => Number(a.granted) - Number(b.granted) || a.label.localeCompare(b.label));

  return {
    available: true,
    botUserId: identity.id,
    botUsername: identity.username,
    botHighestPosition: highest?.position ?? 0,
    botRoleName: highest?.name ?? null,
    isAdministrator: hasDiscordPermission(total, 'ADMINISTRATOR'),
    checks,
    missing: missingPermissions(total, [...requirements.keys()]),
  };
}

export interface HierarchyEntry {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  isBotRole: boolean;
  /** Kann der Bot diese Rolle vergeben oder entziehen? */
  manageableByBot: boolean;
  /** In der Anwendung verwendete Rolle (z.B. Jail-Rolle) - wird hervorgehoben. */
  usage: string[];
}

export interface HierarchyReport {
  entries: HierarchyEntry[];
  botPosition: number;
  /** Rollen, die die Anwendung braucht, aber nicht verwalten kann. */
  problems: Array<{ roleId: string; roleName: string; usage: string[]; reason: string }>;
}

/**
 * Rollenhierarchie mit Hinweis, welche Rollen der Bot verwalten kann.
 *
 * `usageByRoleId` beschreibt, wofür eine Rolle in der Anwendung verwendet wird.
 * Als Problem gilt eine Rolle nur, wenn der Bot sie tatsächlich vergeben oder
 * entziehen können muss (`mustBeManageable`) - eine Rolle mit
 * Dashboard-Berechtigungen darf ruhig über der Bot-Rolle liegen.
 */
export async function getRoleHierarchy(
  usageByRoleId: ReadonlyMap<string, string[]> = new Map(),
  mustBeManageable: ReadonlySet<string> = new Set(),
): Promise<HierarchyReport> {
  const [roles, botMember] = await Promise.all([
    listCachedRoles({ includeDeleted: false }),
    discord.bot.member().catch(() => null),
  ]);

  const botRoleIds = new Set(botMember?.roleIds ?? []);
  const botPosition = roles
    .filter((role) => botRoleIds.has(role.id))
    .reduce((highest, role) => Math.max(highest, role.position), 0);

  const entries: HierarchyEntry[] = roles.map((role) => {
    const usage = usageByRoleId.get(role.id) ?? [];
    return {
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position,
      managed: role.managed,
      isBotRole: botRoleIds.has(role.id),
      manageableByBot: !role.managed && role.position < botPosition,
      usage,
    };
  });

  const problems = entries
    .filter((entry) => mustBeManageable.has(entry.id) && !entry.manageableByBot && !entry.isBotRole)
    .map((entry) => ({
      roleId: entry.id,
      roleName: entry.name,
      usage: entry.usage,
      reason: entry.managed
        ? 'Die Rolle wird von Discord verwaltet (Integration/Booster) und kann von keinem Bot vergeben werden.'
        : 'Die Rolle liegt auf oder über der Bot-Rolle. Bitte die Bot-Rolle auf Discord höher einordnen.',
    }));

  return { entries, botPosition, problems };
}

/**
 * Discord-Administrator?
 *
 * Wird ausschliesslich für den Erstzugang verwendet: solange die Einrichtung
 * nicht abgeschlossen ist, darf ein Discord-Administrator den Assistenten
 * starten. Danach gelten wieder ausschliesslich die Permissions aus dem
 * Dashboard.
 */
export async function isDiscordAdministrator(discordId: string): Promise<boolean> {
  const [member, roles, guild] = await Promise.all([
    discord.members.get(discordId).catch(() => null),
    listCachedRoles({ includeDeleted: true }).catch(() => [] as CachedRole[]),
    discord.guild.get().catch(() => null),
  ]);

  if (!member) {
    return false;
  }
  if (guild?.ownerId === discordId) {
    return true;
  }

  const memberRoles = roles.filter((role) => member.roleIds.includes(role.id));
  return hasDiscordPermission(
    combinePermissions(memberRoles.map((role) => role.permissions)),
    'ADMINISTRATOR',
  );
}
