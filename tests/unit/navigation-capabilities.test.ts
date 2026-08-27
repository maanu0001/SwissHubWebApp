import { describe, expect, it } from 'vitest';
import type { AuthContext } from '@swisshub/auth';
import { resolvePermissions } from '@swisshub/permissions';

/**
 * Navigation aus Berechtigungen - nicht aus Rollennamen.
 *
 * Der Fall, um den es hier vor allem geht: jemand darf eine Abstimmung
 * starten, aber die Strafakte nicht lesen. Bisher zeigte ihm die Seitenleiste
 * «Jail», und dahinter kam eine 403-Seite. Ein Eintrag, der auf etwas zeigt,
 * das man nicht öffnen darf, ist schlimmer als keiner.
 */
await import('@swisshub/modules');

const { buildNavigation } = await import('@swisshub/modules');
const { jail, premium, level } = await import('@swisshub/modules');
const { jailSections } = await import('@/server/jail');
const { premiumSections } = await import('@/server/premium');

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

/** Alle Module eingeschaltet - hier geht es um Berechtigungen, nicht um Module. */
const ALLE_MODULE = new Set([
  'jail',
  'level',
  'premium',
  'communication',
  'music',
  'tickets',
  'spielersuche',
  'tournaments',
  'voiceHub',
  'analytics',
]);

const nav = (permissions: string[]) => buildNavigation(permissions, ALLE_MODULE);
const eintrag = (permissions: string[], label: string) =>
  nav(permissions).find((item) => item.label === label);

const P = jail.JAIL_PERMISSIONS;

describe('Jail-Navigation', () => {
  it('zeigt «Jail», wenn die Übersicht erlaubt ist', () => {
    const eintraege = nav([P.view]);

    expect(eintraege.find((item) => item.label === 'Jail')?.href).toBe('/jail');
    expect(eintraege.filter((item) => item.moduleId === 'jail')).toHaveLength(1);
  });

  it('zeigt «Vote Jail» statt «Jail», wenn nur Abstimmungen erlaubt sind', () => {
    // Der eigentliche Fehler: hier stand vorher «Jail» und dahinter eine
    // 403-Seite.
    const eintraege = nav([P.voteStart]);
    const jailEintraege = eintraege.filter((item) => item.moduleId === 'jail');

    expect(jailEintraege).toHaveLength(1);
    expect(jailEintraege[0]?.label).toBe('Vote Jail');
    expect(jailEintraege[0]?.href).toBe('/jail/votes');
  });

  it('zeigt bei beiden Rechten nur «Jail» - keinen zweiten Eintrag daneben', () => {
    const jailEintraege = nav([P.view, P.voteStart]).filter((item) => item.moduleId === 'jail');

    expect(jailEintraege).toHaveLength(1);
    expect(jailEintraege[0]?.label).toBe('Jail');
    expect(jailEintraege[0]?.href).toBe('/jail');
  });

  it('führt einen reinen Import-Berechtigten direkt zum Import', () => {
    const eintraege = nav([P.import]).filter((item) => item.moduleId === 'jail');

    expect(eintraege[0]?.href).toBe('/jail/import');
  });

  it('zeigt gar nichts ohne jede Jail-Berechtigung', () => {
    expect(nav(['dashboard.view']).filter((item) => item.moduleId === 'jail')).toEqual([]);
  });

  it('behält den Titel-Präfix des Moduls, damit Unterseiten benannt bleiben', () => {
    // Ohne das trüge `/jail/votes` in der Kopfzeile keinen Modultitel mehr.
    expect(eintrag([P.voteStart], 'Vote Jail')?.titlePrefix).toBe('/jail');
  });
});

describe('Jail-Bereichsnavigation', () => {
  it('gibt einem Vote-Berechtigten nur den Abstimmungsbereich', () => {
    const abschnitte = jailSections(betrachter([P.voteStart]));

    expect(abschnitte.map((eintrag) => eintrag.label)).toEqual(['Vote Jail']);
  });

  it('gibt einem Übersichts-Berechtigten Übersicht und Abstimmungen', () => {
    const abschnitte = jailSections(betrachter([P.view]));

    expect(abschnitte.map((eintrag) => eintrag.label)).toEqual(['Übersicht', 'Vote Jail']);
  });

  it('zeigt den Import nur mit Import-Berechtigung', () => {
    expect(jailSections(betrachter([P.view])).some((e) => e.label === 'Import')).toBe(false);
    expect(jailSections(betrachter([P.view, P.import])).some((e) => e.label === 'Import')).toBe(true);
  });
});

describe('Premium-Bereichsnavigation', () => {
  const NUR_SELF = betrachter([premium.PREMIUM_PERMISSIONS.self]);

  it('zeigt einem gewöhnlichen Mitglied genau «Mein Abo» und «Angebote»', () => {
    expect(premiumSections(NUR_SELF).map((eintrag) => eintrag.label)).toEqual(['Mein Abo', 'Angebote']);
  });

  it('zeigt einem gewöhnlichen Mitglied keine Verwaltungsbereiche', () => {
    const labels = premiumSections(NUR_SELF).map((eintrag) => eintrag.label);

    for (const verboten of ['Übersicht', 'Abonnements', 'Produkte', 'Zahlungen', 'Stübli', 'Einstellungen']) {
      expect(labels, `«${verboten}» darf ein Mitglied nicht sehen`).not.toContain(verboten);
    }
  });

  it('führt «Angebote» in den Shop', () => {
    expect(premiumSections(NUR_SELF).find((e) => e.label === 'Angebote')?.href).toBe('/premium');
  });

  it('gibt der Verwaltung ihre Bereiche - und behält die Mitgliedersicht', () => {
    const labels = premiumSections(betrachter(['admin.full'])).map((eintrag) => eintrag.label);

    expect(labels).toContain('Mein Abo');
    expect(labels).toContain('Übersicht');
    expect(labels).toContain('Abonnements');
    expect(labels).toContain('Zahlungen');
  });

  it('vergibt keine zwei gleich beschrifteten Einträge', () => {
    // «Angebote» führte in den Shop, «Angebote» in die Produktverwaltung -
    // nebeneinander eine Falle: man klickt den falschen.
    const labels = premiumSections(betrachter(['admin.full'])).map((eintrag) => eintrag.label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('zeigt jeden Verwaltungsbereich nur mit seiner eigenen Berechtigung', () => {
    const nurZahlungen = premiumSections(
      betrachter([premium.PREMIUM_PERMISSIONS.self, premium.PREMIUM_PERMISSIONS.paymentsView]),
    ).map((eintrag) => eintrag.label);

    expect(nurZahlungen).toContain('Zahlungen');
    expect(nurZahlungen).not.toContain('Übersicht');
    expect(nurZahlungen).not.toContain('Produkte');
  });
});

describe('XP-Glücksrad in der Seitenleiste', () => {
  const SICHTBAR = level.LEVEL_PERMISSIONS.raffleView;

  it('hängt am dynamischen Zustand, nicht nur an der Berechtigung', () => {
    const eintraege = nav([SICHTBAR]).filter((item) => item.href === '/xp-gluecksrad');

    expect(eintraege).toHaveLength(1);
    // Die Registry fragt keine Datenbank; das Layout wertet diese Bedingung
    // aus. Ohne sie stünde der Eintrag dauerhaft dort.
    expect(eintraege[0]?.visibleWhen).toBe('activeRaffle');
  });

  it('erscheint ohne die Berechtigung überhaupt nicht', () => {
    expect(nav(['dashboard.view']).some((item) => item.href === '/xp-gluecksrad')).toBe(false);
  });
});

describe('Navigation gewährt keine Rechte', () => {
  it('liefert für jeden Eintrag eine Berechtigung, die der Betrachter besitzt', () => {
    // Der Auflöser entscheidet, wohin ein Eintrag zeigt - nicht, was jemand
    // darf. Jeder gezeigte Eintrag muss durch eine tatsächlich vorhandene
    // Berechtigung gedeckt sein.
    const rechte: string[] = [P.voteStart, level.LEVEL_PERMISSIONS.raffleView];
    const besitzt = new Set(rechte);

    for (const item of nav(rechte)) {
      const gedeckt =
        besitzt.has(item.permission) ||
        (item.altPermissions ?? []).some((p) => besitzt.has(p)) ||
        (item.alternatives ?? []).some((p) => besitzt.has(p.permission));
      expect(gedeckt, `«${item.label}» ist durch keine vorhandene Berechtigung gedeckt`).toBe(true);
    }
  });
});
