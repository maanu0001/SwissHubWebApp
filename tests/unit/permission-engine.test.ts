import { describe, expect, it } from 'vitest';
import {
  ADMIN_FULL,
  expandPermissions,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  resolvePermissions,
  type RolePermissionMapping,
} from '@swisshub/permissions';

const MODERATOR_ROLE = '900000000000000003';
const SUPPORTER_ROLE = '900000000000000004';
const ADMIN_ROLE = '900000000000000002';

const MAPPINGS: RolePermissionMapping[] = [
  { discordRoleId: ADMIN_ROLE, permission: ADMIN_FULL },
  { discordRoleId: MODERATOR_ROLE, permission: 'jail.view' },
  { discordRoleId: MODERATOR_ROLE, permission: 'jail.create' },
  { discordRoleId: MODERATOR_ROLE, permission: 'jail.release' },
  { discordRoleId: MODERATOR_ROLE, permission: 'members.view' },
  { discordRoleId: SUPPORTER_ROLE, permission: 'members.view' },
];

const subject = (roleIds: string[], isOwner = false) => ({
  discordId: '111111111111111111',
  roleIds,
  isOwner,
});

describe('Permission Engine', () => {
  it('loest Permissions aus den Discord-Rollen auf', () => {
    const resolution = resolvePermissions(subject([MODERATOR_ROLE]), MAPPINGS);

    expect(hasPermission(resolution, 'jail.create')).toBe(true);
    expect(hasPermission(resolution, 'members.view')).toBe(true);
    expect(resolution.matchedRoleIds).toEqual([MODERATOR_ROLE]);
  });

  it('verweigert Permissions, die keiner Rolle zugeordnet sind (Fail Closed)', () => {
    const resolution = resolvePermissions(subject([SUPPORTER_ROLE]), MAPPINGS);

    expect(hasPermission(resolution, 'members.view')).toBe(true);
    expect(hasPermission(resolution, 'jail.create')).toBe(false);
    expect(hasPermission(resolution, 'settings.edit')).toBe(false);
    expect(hasPermission(resolution, 'admin.full')).toBe(false);
  });

  it('gibt ohne passende Rolle keinerlei Berechtigung', () => {
    const resolution = resolvePermissions(subject(['999999999999999999']), MAPPINGS);

    expect(resolution.granted.size).toBe(0);
    expect(hasPermission(resolution, 'members.view')).toBe(false);
  });

  it('behandelt admin.full als Vollzugriff', () => {
    const resolution = resolvePermissions(subject([ADMIN_ROLE]), MAPPINGS);

    expect(hasPermission(resolution, 'jail.create')).toBe(true);
    expect(hasPermission(resolution, 'settings.edit')).toBe(true);
    expect(hasPermission(resolution, 'irgendwas.neues')).toBe(true);
  });

  it('unterstuetzt Wildcards pro Modul', () => {
    const resolution = resolvePermissions(subject([MODERATOR_ROLE]), [
      { discordRoleId: MODERATOR_ROLE, permission: 'jail.*' },
    ]);

    expect(hasPermission(resolution, 'jail.release')).toBe(true);
    expect(hasPermission(resolution, 'jail.settings')).toBe(true);
    expect(hasPermission(resolution, 'settings.edit')).toBe(false);
  });

  it('gibt dem konfigurierten Owner Zugriff', () => {
    const resolution = resolvePermissions(subject([], true), MAPPINGS);

    expect(hasPermission(resolution, 'system.manage')).toBe(true);
  });

  it('unterstuetzt any/all Pruefungen', () => {
    const resolution = resolvePermissions(subject([MODERATOR_ROLE]), MAPPINGS);

    expect(hasAnyPermission(resolution, ['settings.edit', 'jail.view'])).toBe(true);
    expect(hasAllPermissions(resolution, ['settings.edit', 'jail.view'])).toBe(false);
    expect(hasAllPermissions(resolution, ['jail.view', 'jail.create'])).toBe(true);
  });

  it('rollt Permissions fuer die UI korrekt aus', () => {
    const resolution = resolvePermissions(subject([SUPPORTER_ROLE]), MAPPINGS);
    const expanded = expandPermissions(resolution, ['members.view', 'jail.view', 'audit.view']);

    expect(expanded).toEqual(['members.view']);
  });
});
