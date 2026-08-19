import { describe, expect, it } from 'vitest';
import { filterManageableRoles, highestRolePosition, isRoleManageableByBot } from '@swisshub/permissions';
import { jail } from '@swisshub/modules';
import type { GuildRole } from '@swisshub/discord';

const ROLES: GuildRole[] = [
  { id: 'r-admin', name: 'Administrator', color: 0, position: 90, managed: false, permissions: '8' },
  { id: 'r-bot', name: 'Bot', color: 0, position: 80, managed: true, permissions: '0' },
  { id: 'r-mod', name: 'Moderator', color: 0, position: 70, managed: false, permissions: '0' },
  { id: 'r-booster', name: 'Booster', color: 0, position: 40, managed: true, permissions: '0' },
  { id: 'r-member', name: 'Member', color: 0, position: 5, managed: false, permissions: '0' },
  { id: 'r-jail', name: 'Jail', color: 0, position: 3, managed: false, permissions: '0' },
];

const BOT_POSITION = 80;

describe('Rollenhierarchie', () => {
  it('bestimmt die hoechste Rollenposition', () => {
    expect(highestRolePosition(['r-member', 'r-mod'], ROLES)).toBe(70);
    expect(highestRolePosition([], ROLES)).toBe(0);
    expect(highestRolePosition(['unbekannt'], ROLES)).toBe(0);
  });

  it('erkennt vom Bot verwaltbare Rollen', () => {
    expect(isRoleManageableByBot(ROLES[4], BOT_POSITION)).toBe(true);
    expect(isRoleManageableByBot(ROLES[0], BOT_POSITION)).toBe(false);
    expect(isRoleManageableByBot(ROLES[3], BOT_POSITION)).toBe(false);
    expect(isRoleManageableByBot(undefined, BOT_POSITION)).toBe(false);
  });

  it('trennt verwaltbare von blockierten Rollen', () => {
    const result = filterManageableRoles(['r-member', 'r-admin', 'r-booster'], ROLES, BOT_POSITION);

    expect(result.manageable).toEqual(['r-member']);
    expect(result.blocked).toEqual(['r-admin', 'r-booster']);
  });
});

describe('Jail-Rollenplanung', () => {
  it('entfernt verwaltbare Rollen und vergibt die Jail-Rolle', () => {
    const plan = jail.planJailRoles({
      currentRoleIds: ['r-member', 'r-mod'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
      keepRoleIds: new Set(),
    });

    expect(plan.nextRoleIds).toEqual(['r-jail']);
    expect(plan.removedRoleIds.sort()).toEqual(['r-member', 'r-mod']);
    expect(plan.snapshotRoleIds.sort()).toEqual(['r-member', 'r-mod']);
  });

  it('behaelt konfigurierte Rollen (z.B. Booster) bei', () => {
    const plan = jail.planJailRoles({
      currentRoleIds: ['r-member', 'r-mod'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
      keepRoleIds: new Set(['r-member']),
    });

    expect(plan.keptRoleIds).toEqual(['r-member']);
    expect(plan.nextRoleIds).toContain('r-member');
    expect(plan.nextRoleIds).toContain('r-jail');
    expect(plan.removedRoleIds).toEqual(['r-mod']);
  });

  it('laesst nicht verwaltbare Rollen unangetastet', () => {
    const plan = jail.planJailRoles({
      currentRoleIds: ['r-admin', 'r-booster', 'r-member'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
      keepRoleIds: new Set(),
    });

    expect(plan.untouchableRoleIds.sort()).toEqual(['r-admin', 'r-booster']);
    expect(plan.nextRoleIds).toContain('r-admin');
    expect(plan.nextRoleIds).toContain('r-booster');
    expect(plan.nextRoleIds).not.toContain('r-member');
  });

  it('vermeidet doppelte Jail-Rollen', () => {
    const plan = jail.planJailRoles({
      currentRoleIds: ['r-jail', 'r-member'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
      keepRoleIds: new Set(),
    });

    expect(plan.nextRoleIds.filter((id) => id === 'r-jail')).toHaveLength(1);
    expect(plan.snapshotRoleIds).not.toContain('r-jail');
  });
});

describe('Release-Rollenplanung', () => {
  it('stellt gesicherte Rollen wieder her und entfernt die Jail-Rolle', () => {
    const plan = jail.planReleaseRoles({
      currentRoleIds: ['r-jail'],
      snapshotRoleIds: ['r-member', 'r-mod'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
    });

    expect(plan.nextRoleIds.sort()).toEqual(['r-member', 'r-mod']);
    expect(plan.restorableRoleIds.sort()).toEqual(['r-member', 'r-mod']);
    expect(plan.unrestorableRoleIds).toEqual([]);
  });

  it('ueberspringt geloeschte Rollen statt den Release scheitern zu lassen', () => {
    const plan = jail.planReleaseRoles({
      currentRoleIds: ['r-jail'],
      snapshotRoleIds: ['r-member', 'r-geloescht'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
    });

    expect(plan.restorableRoleIds).toEqual(['r-member']);
    expect(plan.unrestorableRoleIds).toEqual(['r-geloescht']);
    expect(plan.nextRoleIds).not.toContain('r-jail');
  });

  it('stellt Rollen oberhalb der Bot-Rolle nicht wieder her', () => {
    const plan = jail.planReleaseRoles({
      currentRoleIds: ['r-jail'],
      snapshotRoleIds: ['r-admin', 'r-member'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
    });

    expect(plan.restorableRoleIds).toEqual(['r-member']);
    expect(plan.unrestorableRoleIds).toEqual(['r-admin']);
  });

  it('behaelt Rollen, die das Mitglied waehrend des Jails erhalten hat', () => {
    const plan = jail.planReleaseRoles({
      currentRoleIds: ['r-jail', 'r-booster'],
      snapshotRoleIds: ['r-member'],
      guildRoles: ROLES,
      botHighestPosition: BOT_POSITION,
      jailRoleId: 'r-jail',
    });

    expect(plan.nextRoleIds.sort()).toEqual(['r-booster', 'r-member']);
  });
});
