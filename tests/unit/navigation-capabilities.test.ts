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

const { buildNavigation, moduleViewPermission } = await import('@swisshub/modules');
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

/**
 * «Modul sehen» - der Schluessel, der einen Bereich ueberhaupt erscheinen
 * laesst.
 *
 * Er steht in jedem Fall unten ausdruecklich dabei. Die Frage dieser Datei
 * ist, *welcher* Eintrag jemandem gezeigt wird; dass ohne diesen Schluessel
 * gar keiner erscheint, ist die Frage davor - und sie hat ihren eigenen Fall.
 */
const JAIL_SEHEN = moduleViewPermission('jail');
const LEVEL_SEHEN = moduleViewPermission('level');

describe('Jail-Navigation', () => {
  /*
    Die Strafakte ist eine Moderationsmassnahme und steht jetzt unter
    «Moderation» - sie hat keinen eigenen Hauptbereich mehr. Was das Modul
    hier noch beisteuert, ist der Vote Jail, und der bewusst: eine Abstimmung
    der Gemeinschaft ist etwas anderes als eine Massnahme des Teams, und wer
    daran teilnimmt, sieht in aller Regel gar keine Moderation.
  */

  it('gibt dem Jail-Modul keinen eigenen Staff-Eintrag mehr', () => {
    const eintraege = nav([JAIL_SEHEN, P.view]).filter((item) => item.moduleId === 'jail');

    expect(eintraege.map((item) => item.href)).not.toContain('/jail');
    expect(eintraege.map((item) => item.href)).not.toContain('/moderation/jail');
  });

  it('zeigt einem Abstimmungsberechtigten den Vote Jail', () => {
    const eintraege = nav([JAIL_SEHEN, P.voteStart]).filter((item) => item.moduleId === 'jail');

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.label).toBe('Vote Jail');
    expect(eintraege[0]?.href).toBe('/vote-jail');
  });

  it('zeigt ihn auch dem, der die Abstimmungen nur einsehen darf', () => {
    const eintraege = nav([JAIL_SEHEN, P.view]).filter((item) => item.moduleId === 'jail');

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.href).toBe('/vote-jail');
  });

  it('bleibt bei beiden Rechten bei einem einzigen Eintrag', () => {
    const eintraege = nav([JAIL_SEHEN, P.view, P.voteStart]).filter(
      (item) => item.moduleId === 'jail',
    );

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.href).toBe('/vote-jail');
  });

  it('gibt dem reinen Import-Berechtigten keinen Sidebar-Eintrag', () => {
    // Der Import ist eine einmalige Übernahme aus dem alten Bot und steht
    // innerhalb des Moderationsbereichs - ein eigener Hauptpunkt dafür wäre
    // ein Dauerplatz für etwas, das man einmal braucht.
    const eintraege = nav([JAIL_SEHEN, P.import]).filter((item) => item.moduleId === 'jail');

    expect(eintraege).toEqual([]);
  });

  it('zeigt gar nichts ohne jede Jail-Berechtigung', () => {
    expect(nav(['dashboard.view']).filter((item) => item.moduleId === 'jail')).toEqual([]);
  });

  it('zeigt gar nichts ohne «Modul sehen» - auch mit Jail-Rechten', () => {
    // Die Umkehrung der Faelle oben: Sichtbarkeit ist eine eigene
    // Entscheidung und keine Nebenwirkung einer Handlungsbefugnis.
    expect(nav([P.view, P.voteStart, P.import]).filter((item) => item.moduleId === 'jail')).toEqual(
      [],
    );
  });

  it('trägt den Vote Jail unter seiner eigenen Adresse, nicht unter der des Jails', () => {
    // Der Eintrag ist jetzt der Haupteintrag des Moduls und keine
    // Ausweichroute mehr - er braucht keinen fremden Präfix.
    const gefunden = eintrag([JAIL_SEHEN, P.voteStart], 'Vote Jail');

    expect(gefunden?.href).toBe('/vote-jail');
    expect(gefunden?.titlePrefix ?? gefunden?.href).toBe('/vote-jail');
  });
});

describe('Jail-Bereichsnavigation', () => {
  /*
    Innerhalb des Moderationsbereichs. Der Vote Jail steht nicht mehr darin -
    er ist ein eigener Bereich für die Gemeinschaft und nicht ein Unterpunkt
    der Strafakte.
  */

  it('gibt einem Übersichts-Berechtigten den Jail-Bereich', () => {
    const abschnitte = jailSections(betrachter([P.view]));

    expect(abschnitte.map((eintrag) => eintrag.label)).toEqual(['Jails']);
    expect(abschnitte[0]?.href).toBe('/moderation/jail');
  });

  it('gibt einem reinen Vote-Berechtigten hier gar nichts', () => {
    // Er hat mit der Strafakte nichts zu tun - sein Weg ist der eigene
    // Sidebar-Eintrag.
    expect(jailSections(betrachter([P.voteStart]))).toEqual([]);
  });

  it('zeigt den Import nur mit Import-Berechtigung', () => {
    expect(jailSections(betrachter([P.view])).some((e) => e.label === 'Import')).toBe(false);
    expect(jailSections(betrachter([P.view, P.import])).some((e) => e.label === 'Import')).toBe(true);
  });

  it('führt den Import unter die neue Adresse', () => {
    const importEintrag = jailSections(betrachter([P.view, P.import])).find(
      (e) => e.label === 'Import',
    );

    expect(importEintrag?.href).toBe('/moderation/jail/import');
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
    const eintraege = nav([LEVEL_SEHEN, SICHTBAR]).filter((item) => item.href === '/xp-gluecksrad');

    expect(eintraege).toHaveLength(1);
    // Die Registry fragt keine Datenbank; das Layout wertet diese Bedingung
    // aus. Ohne sie stünde der Eintrag dauerhaft dort.
    expect(eintraege[0]?.visibleWhen).toBe('activeRaffle');
  });

  it('erscheint ohne die Berechtigung überhaupt nicht', () => {
    expect(nav(['dashboard.view']).some((item) => item.href === '/xp-gluecksrad')).toBe(false);
  });

  it('erscheint ohne «Modul sehen» nicht, auch mit der Berechtigung', () => {
    expect(nav([SICHTBAR]).some((item) => item.href === '/xp-gluecksrad')).toBe(false);
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
