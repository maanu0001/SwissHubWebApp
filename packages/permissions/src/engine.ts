import { ADMIN_FULL } from './registry';

/**
 * Permission Engine.
 *
 * Business-Logik fragt niemals direkt nach Discord-Role-IDs, sondern immer nach
 * Permissions. Die Zuordnung Rolle -> Permission ist zentral konfigurierbar.
 *
 * Eine Zuordnung hat eine Wirkung: sie erlaubt etwas oder sie verweigert es
 * ausdruecklich. Verweigern ist mehr als «nicht erlauben» - es hebt eine
 * Erlaubnis auf, die sonst aus dem Vollzugriff oder einer Wildcard folgen
 * wuerde. Genau deshalb steht die Wirkung als eigenes Feld in der Datenbank
 * und nicht als Sonderzeichen im Permission-String: ein `!` im Schluessel
 * waere weder in der Registry auffindbar noch in der Oberflaeche erklaerbar.
 */

/** Wirkung einer Zuordnung. Fehlt sie, gilt `ALLOW` - so wie bisher. */
export type PermissionEffectValue = 'ALLOW' | 'DENY';

export interface RolePermissionMapping {
  discordRoleId: string;
  permission: string;
  effect?: PermissionEffectValue;
}

export interface PermissionSubject {
  discordId: string;
  /** Aktuelle Discord-Rollen (frisch geladen, nicht aus einer alten Session). */
  roleIds: string[];
  /** Fest konfigurierte Owner-ID aus der Umgebung. */
  isOwner: boolean;
}

export interface PermissionResolution {
  discordId: string;
  isOwner: boolean;
  /** Direkt zugewiesene Permissions (inkl. Wildcards wie `jail.*`). */
  granted: ReadonlySet<string>;
  /** Ausdrueckliche Ausnahmen. Sie schlagen jede Erlaubnis. */
  denied: ReadonlySet<string>;
  /** Rollen, die mindestens eine Permission beigesteuert haben. */
  matchedRoleIds: string[];
}

/**
 * Löst die effektiven Permissions eines Benutzers auf.
 *
 * Erlaubnisse und Verweigerungen werden getrennt gesammelt. Traegt jemand zwei
 * Rollen und verweigert die eine, was die andere erlaubt, gewinnt die
 * Verweigerung - eine Ausnahme, die sich durch das Hinzufuegen einer
 * beliebigen weiteren Rolle aushebeln liesse, waere keine.
 */
export function resolvePermissions(
  subject: PermissionSubject,
  mappings: readonly RolePermissionMapping[],
): PermissionResolution {
  const roleIds = new Set(subject.roleIds);
  const granted = new Set<string>();
  const denied = new Set<string>();
  const matchedRoleIds = new Set<string>();

  for (const mapping of mappings) {
    if (!roleIds.has(mapping.discordRoleId)) {
      continue;
    }
    if (mapping.effect === 'DENY') {
      denied.add(mapping.permission);
    } else {
      granted.add(mapping.permission);
    }
    matchedRoleIds.add(mapping.discordRoleId);
  }

  return {
    discordId: subject.discordId,
    isOwner: subject.isOwner,
    granted,
    denied,
    matchedRoleIds: [...matchedRoleIds],
  };
}

/**
 * Trifft ein Eintrag der Menge diese Permission?
 *
 * Ein Eintrag passt, wenn er die Permission wortgleich nennt oder als
 * Praefix-Wildcard (`jail.*`) einschliesst. Fuer Erlaubnis und Verweigerung
 * gilt dieselbe Regel - sonst waere `jail.*` als Ausnahme etwas anderes als
 * `jail.*` als Erlaubnis, und das kann niemand erraten.
 */
function matches(entries: ReadonlySet<string>, permission: string): boolean {
  if (entries.has(permission)) {
    return true;
  }
  const prefix = permission.split('.')[0];
  return prefix !== undefined && entries.has(`${prefix}.*`);
}

/**
 * Woraus die Entscheidung folgt.
 *
 * `SYSTEM_OWNER`   - der Notzugang aus der Umgebung, nicht entziehbar.
 * `EXPLICIT_DENY`  - ausdrueckliche Ausnahme, schlaegt alles ausser dem Owner.
 * `EXPLICIT_ALLOW` - die Permission ist der Rolle einzeln zugewiesen.
 * `FULL_ACCESS`    - sie folgt aus `admin.full`.
 * `WILDCARD`       - sie folgt aus `<praefix>.*`.
 * `NOT_GRANTED`    - sie wurde schlicht nie erteilt.
 */
export type PermissionSource =
  'SYSTEM_OWNER' | 'EXPLICIT_DENY' | 'EXPLICIT_ALLOW' | 'FULL_ACCESS' | 'WILDCARD' | 'NOT_GRANTED';

export interface PermissionExplanation {
  permission: string;
  allowed: boolean;
  source: PermissionSource;
  /** Satz fuer die Oberflaeche - warum diese Berechtigung greift oder nicht. */
  reason: string;
}

/**
 * Erklaert eine einzelne Entscheidung.
 *
 * Die Oberflaeche darf keinen Zustand zeigen, dessen Herkunft sie nicht
 * benennen kann. Deshalb liegt die Begruendung hier, neben der Regel, und
 * nicht als zweite Wahrheit im Browser.
 */
export function explainPermission(
  input: { isOwner: boolean; granted: ReadonlySet<string>; denied: ReadonlySet<string> },
  permission: string,
): PermissionExplanation {
  if (input.isOwner) {
    return {
      permission,
      allowed: true,
      source: 'SYSTEM_OWNER',
      reason: 'Erlaubt als System-Owner - dieser Zugang lässt sich nicht entziehen.',
    };
  }

  if (matches(input.denied, permission)) {
    const durchVollzugriff = input.granted.has(ADMIN_FULL);
    const wortgleich = input.denied.has(permission);
    return {
      permission,
      allowed: false,
      source: 'EXPLICIT_DENY',
      reason: durchVollzugriff
        ? 'Erlaubt durch Vollzugriff, aber verweigert durch eine ausdrückliche Ausnahme.'
        : wortgleich
          ? 'Verweigert durch eine ausdrückliche Ausnahme.'
          : 'Verweigert durch eine ausdrückliche Ausnahme für den ganzen Bereich.',
    };
  }

  if (input.granted.has(permission)) {
    return {
      permission,
      allowed: true,
      source: 'EXPLICIT_ALLOW',
      reason: 'Dieser Rolle einzeln zugewiesen.',
    };
  }

  if (input.granted.has(ADMIN_FULL)) {
    return {
      permission,
      allowed: true,
      source: 'FULL_ACCESS',
      reason: 'Erlaubt durch Vollzugriff.',
    };
  }

  const prefix = permission.split('.')[0];
  if (prefix !== undefined && input.granted.has(`${prefix}.*`)) {
    return {
      permission,
      allowed: true,
      source: 'WILDCARD',
      reason: `Erlaubt durch die Bereichsberechtigung «${prefix}.*».`,
    };
  }

  return {
    permission,
    allowed: false,
    source: 'NOT_GRANTED',
    reason: 'Dieser Rolle nicht zugewiesen.',
  };
}

/**
 * Prüft eine einzelne Permission.
 *
 * Unterstützt `admin.full` (Vollzugriff) sowie Wildcards pro Präfix
 * (`jail.*` deckt `jail.create`, `jail.release`, ... ab). Eine ausdrueckliche
 * Verweigerung schlaegt beides.
 *
 * Der System-Owner bleibt aussen vor: sein Zugang stammt aus der Umgebung,
 * nicht aus der Datenbank, und liesse sich sonst ueber die Oberflaeche
 * entziehen - womit niemand mehr an die Oberflaeche kaeme, die ihn
 * zurueckgeben koennte.
 */
export function hasPermission(resolution: PermissionResolution, permission: string): boolean {
  if (resolution.isOwner) {
    return true;
  }
  if (matches(resolution.denied, permission)) {
    return false;
  }
  if (resolution.granted.has(ADMIN_FULL)) {
    return true;
  }
  return matches(resolution.granted, permission);
}

export function hasAnyPermission(resolution: PermissionResolution, permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(resolution, permission));
}

export function hasAllPermissions(resolution: PermissionResolution, permissions: string[]): boolean {
  return permissions.every((permission) => hasPermission(resolution, permission));
}

/**
 * Erweitert die aufgelösten Permissions zu einer konkreten Liste.
 * Wird ans Frontend gegeben, damit `PermissionGuard` Elemente ausblenden kann.
 * Sicherheitsrelevant ist ausschliesslich die serverseitige Prüfung.
 */
export function expandPermissions(resolution: PermissionResolution, knownPermissions: string[]): string[] {
  return knownPermissions.filter((permission) => hasPermission(resolution, permission));
}
