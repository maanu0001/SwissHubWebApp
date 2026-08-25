import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@swisshub/auth';
import { resolvePermissions } from '@swisshub/permissions';

/**
 * Was jemand sieht, entscheiden seine Berechtigungen - nicht der Name seiner
 * Rolle.
 *
 * Diese Prüfungen sind bewusst gegen die Berechtigungen geschrieben und
 * nirgends gegen «Mitglied». Eine Rolle heisst auf dem einen Server
 * «Mitglied», auf dem naechsten «Member» und auf dem uebernaechsten gar
 * nichts - die Oberflaeche darf davon nicht abhaengen.
 */
await import('@swisshub/modules');

const { voiceSections } = await import('@/server/voice');
const { tournamentSections } = await import('@/server/tournaments');
const { premiumSections } = await import('@/server/premium');
const { PERMISSION_PRESETS, resolvePreset } = await import('@swisshub/permissions');

/** Ein Sitzungskontext mit genau diesen Berechtigungen. */
function betrachter(permissions: string[]): AuthContext {
  return {
    isMember: true,
    permissions: resolvePermissions(
      { discordId: '1', roleIds: ['r'], isOwner: false },
      permissions.map((permission) => ({ discordRoleId: 'r', permission })),
    ),
    permissionKeys: permissions,
    roleIds: ['r'],
    moderationLevel: 0,
    sessionId: 's',
    user: { discordId: '1', username: 'test' },
    identity: {},
  } as unknown as AuthContext;
}

const MITGLIED = betrachter(
  resolvePreset(PERMISSION_PRESETS.find((preset) => preset.id === 'mitglied')!),
);
const ADMIN = betrachter(['admin.full']);

const labels = (sections: Array<{ label: string }>): string[] =>
  sections.map((section) => section.label);

describe('Sichtbarkeit für ein gewöhnliches Mitglied', () => {
  it('zeigt im Voice Hub keine Einstellungen', () => {
    const sichtbar = labels(voiceSections(MITGLIED));
    expect(sichtbar).not.toContain('Einstellungen');
    expect(sichtbar).not.toContain('Hub-Channels');
    expect(sichtbar).not.toContain('Presets');
    // Die eigene Sicht bleibt - das Modul wird nicht ganz versteckt.
    expect(sichtbar).toContain('Übersicht');
  });

  it('zeigt in den Turnieren keine Einstellungen', () => {
    const sichtbar = labels(tournamentSections(MITGLIED));
    expect(sichtbar).not.toContain('Einstellungen');
    expect(sichtbar).toContain('Übersicht');
  });

  it('zeigt bei Premium nur das eigene Abo', () => {
    const sichtbar = labels(premiumSections(MITGLIED));
    expect(sichtbar).toEqual(['Mein Abo']);
    expect(sichtbar).not.toContain('Übersicht');
    expect(sichtbar).not.toContain('Abonnements');
    expect(sichtbar).not.toContain('Stübli');
  });
});

describe('Sichtbarkeit für die Verwaltung', () => {
  it('lässt dem Voice Hub seine Verwaltung', () => {
    const sichtbar = labels(voiceSections(ADMIN));
    for (const eintrag of ['Übersicht', 'Aktive Talks', 'Hub-Channels', 'Presets', 'Einstellungen']) {
      expect(sichtbar).toContain(eintrag);
    }
  });

  it('lässt den Turnieren ihre Verwaltung', () => {
    expect(labels(tournamentSections(ADMIN))).toContain('Einstellungen');
  });

  it('lässt Premium seine Verwaltung', () => {
    const sichtbar = labels(premiumSections(ADMIN));
    for (const eintrag of ['Mein Abo', 'Übersicht', 'Abonnements', 'Stübli', 'Einstellungen']) {
      expect(sichtbar).toContain(eintrag);
    }
  });
});

describe('Sichtbarkeit hängt an der Berechtigung, nicht an der Rolle', () => {
  it('blendet die Einstellungen ein, sobald genau diese Berechtigung dazukommt', () => {
    // Gegenprobe zum Test oben: derselbe Betrachter, eine Berechtigung mehr.
    const ohne = betrachter(['voiceHub.view']);
    const mit = betrachter(['voiceHub.view', 'voiceHub.settings']);

    expect(labels(voiceSections(ohne))).not.toContain('Einstellungen');
    expect(labels(voiceSections(mit))).toContain('Einstellungen');
  });

  it('öffnet die Premium-Verwaltung erst mit premium.view', () => {
    expect(labels(premiumSections(betrachter(['premium.self'])))).toEqual(['Mein Abo']);
    expect(labels(premiumSections(betrachter(['premium.view'])))).toContain('Abonnements');
  });
});

/**
 * Was nicht gezeigt wird, wird auch nicht geladen.
 *
 * Der Unterschied ist nicht kosmetisch: die Zahlen kaemen sonst aus der
 * Datenbank, laegen in der Antwort des Servers und stuenden im Fehlerfall im
 * Protokoll - fuer jemanden, der sie nie haette sehen duerfen.
 */
describe('Dashboard lädt nur, was der Betrachter sehen darf', () => {
  it('lässt Jail- und Moderationszahlen ohne Berechtigung ganz weg', async () => {
    const { loadDashboardData } = await import('@/server/dashboard');

    const daten = await loadDashboardData({
      canViewJails: false,
      canViewAudit: false,
      canViewModeration: false,
    });

    // `undefined` und nicht `0`: eine Null waere eine Auskunft ueber den
    // Moderationsstand des Servers.
    expect(daten.jailStats).toBeUndefined();
    expect(daten.actionsToday).toBeUndefined();
    expect(daten.actionsYesterday).toBeUndefined();
    expect(daten.actionsTrend).toBeNull();
    expect(daten.activeJails).toEqual([]);
    expect(daten.recentActivity).toEqual([]);
    // Was jeder sehen darf, bleibt.
    expect(daten.bot).toBeDefined();
  });

  it('liefert sie mit Berechtigung', async () => {
    const { loadDashboardData } = await import('@/server/dashboard');

    const daten = await loadDashboardData({
      canViewJails: true,
      canViewAudit: true,
      canViewModeration: true,
    });

    expect(daten.jailStats).toBeDefined();
    expect(typeof daten.actionsToday).toBe('number');
  });
});
