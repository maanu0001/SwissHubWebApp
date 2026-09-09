import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNavigation, groupNavigation, listModuleDefinitions, members } from '@swisshub/modules';
import { expandPermissions, listPermissions, resolvePermissions } from '@swisshub/permissions';

/**
 * «Mein Profil» - Selbstauskunft, nicht Mitgliederzugriff.
 *
 * Zwei Dinge, die zusammengehören und lange verwechselt waren:
 *
 * 1. Sein **eigenes** Profil zu sehen ist Selbstbedienung. Es hing am
 *    Mitglieder-Modul, und eine Rolle ohne den Mitgliederbereich verlor
 *    dadurch beides auf einmal - die Mitgliedersuche, die sie nicht haben
 *    sollte, und den Weg zum eigenen Profil, den sie braucht.
 * 2. Ein **fremdes** Profil zu sehen ist Mitgliederzugriff und bleibt es.
 *    Diese Änderung darf daran nichts lockern, und der wichtigere Teil dieser
 *    Datei prüft genau das.
 */

const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));
const ROLLE = '900000000000011001';
const ICH = '900000000000011099';
const JEMAND_ANDERES = '900000000000011098';

/** Eine Person mit genau diesen erteilten Berechtigungen. */
function person(erteilt: string[]) {
  const resolution = resolvePermissions(
    { discordId: ICH, roleIds: [ROLLE], isOwner: false },
    erteilt.map((permission) => ({ discordRoleId: ROLLE, permission })),
  );
  const keys = expandPermissions(
    resolution,
    listPermissions().map((definition) => definition.key),
  );
  return {
    keys,
    navigation: buildNavigation(keys, ALLE_MODULE),
    viewer: {
      discordId: ICH,
      roleIds: [ROLLE],
      can: (permission: string) => keys.includes(permission),
    },
  };
}

const hrefs = (eintraege: ReturnType<typeof buildNavigation>): string[] =>
  eintraege.map((eintrag) => eintrag.href);

// --- Die vier Personas aus der Aufgabenstellung -----------------------------

/** A: ein gewöhnliches Mitglied ohne jede Mitglieder-Berechtigung. */
const MITGLIED = ['dashboard.view'];

/** B: Premium, ebenfalls ohne Mitglieder-Berechtigung. */
const PREMIUM = ['dashboard.view', 'premium.view', 'level.raffle.view'];

/** C: Moderator mit Mitgliederzugriff. */
const MODERATOR = [
  'dashboard.view',
  'members.module.view',
  'members.view',
  'members.view.basic.all',
  'moderation.view',
];

/** D: Administrator. */
const ADMIN = ['admin.full'];

describe('Sidebar: Mein Profil ohne Mitglieder-Permission', () => {
  it.each([
    ['Mitglied', MITGLIED],
    ['Premium', PREMIUM],
    ['Moderator', MODERATOR],
    ['Administrator', ADMIN],
  ])('zeigt %s den Eintrag «Mein Profil»', (_name, rechte) => {
    expect(hrefs(person(rechte).navigation)).toContain('/profile');
  });

  it('zeigt einem Mitglied ohne Berechtigung keinen Mitgliederbereich', () => {
    const { navigation, keys } = person(MITGLIED);

    expect(hrefs(navigation)).not.toContain('/members');
    // Der eigentliche Punkt: die Berechtigung wird nicht heimlich vergeben.
    expect(keys).not.toContain('members.view');
  });

  it('zeigt Premium ohne Berechtigung keinen Mitgliederbereich', () => {
    const { navigation, keys } = person(PREMIUM);

    expect(hrefs(navigation)).not.toContain('/members');
    expect(keys).not.toContain('members.view');
  });

  it('zeigt dem Moderator weiterhin beides', () => {
    const gefunden = hrefs(person(MODERATOR).navigation);

    expect(gefunden).toContain('/profile');
    expect(gefunden).toContain('/members');
  });

  it('lässt den Administrator unverändert', () => {
    const gefunden = hrefs(person(ADMIN).navigation);

    expect(gefunden).toContain('/profile');
    expect(gefunden).toContain('/members');
  });

  it('stellt «Mein Profil» in dieselbe Gruppe wie das Dashboard', () => {
    // Desktop und Mobile lesen dieselbe gruppierte Navigation - es gibt keine
    // zweite Liste, die auseinanderlaufen könnte.
    const gruppen = groupNavigation(person(PREMIUM).navigation);
    const gruppeMitProfil = gruppen.find((gruppe) =>
      gruppe.items.some((eintrag) => eintrag.href === '/profile'),
    );

    expect(gruppeMitProfil?.id).toBe('overview');
  });

  it('vergibt keine Mitglieder-Berechtigung, um das Problem zu lösen', () => {
    // Der naheliegende falsche Weg wäre gewesen, `members.view` in die
    // Mitglieder-Vorlage zu schieben. Dann sähe jeder jeden.
    const { keys } = person(MITGLIED);

    for (const verboten of ['members.view', 'members.view.basic.all', 'members.view.notes.all']) {
      expect(keys, verboten).not.toContain(verboten);
    }
  });
});

describe('Zugriff: eigenes Profil ja, fremdes nein', () => {
  it('lässt ein Mitglied ohne Berechtigung sein eigenes Profil öffnen', () => {
    expect(members.darfProfilOeffnen(person(MITGLIED).viewer, ICH)).toBe(true);
  });

  it('lässt Premium ohne Berechtigung das eigene Profil öffnen', () => {
    expect(members.darfProfilOeffnen(person(PREMIUM).viewer, ICH)).toBe(true);
  });

  it('verweigert ihm ein fremdes Profil', () => {
    // Die wichtigste Zusage dieser Änderung: die Adresszeile hilft nicht.
    expect(members.darfProfilOeffnen(person(MITGLIED).viewer, JEMAND_ANDERES)).toBe(false);
    expect(members.darfProfilOeffnen(person(PREMIUM).viewer, JEMAND_ANDERES)).toBe(false);
  });

  it('gibt ihm auch keinen einzelnen Abschnitt eines fremden Profils', () => {
    const { viewer } = person(PREMIUM);

    for (const abschnitt of members.MEMBER_SECTIONS) {
      expect(members.darfSehen(viewer, abschnitt, JEMAND_ANDERES), abschnitt).toBe(false);
    }
  });

  it('lässt den Moderator fremde Profile öffnen', () => {
    expect(members.darfProfilOeffnen(person(MODERATOR).viewer, JEMAND_ANDERES)).toBe(true);
  });

  it('gibt dem Mitglied im eigenen Profil nur die Basisangaben', () => {
    // Selbstauskunft heisst nicht «alles über sich». Level, Aktivität und
    // Tickets bleiben an ihren Berechtigungen.
    const { viewer } = person(MITGLIED);

    expect(members.darfSehen(viewer, 'basic', ICH)).toBe(true);
    for (const abschnitt of ['level', 'activity', 'tickets', 'premium', 'moderation', 'notes'] as const) {
      expect(members.darfSehen(viewer, abschnitt, ICH), abschnitt).toBe(false);
    }
  });

  it('macht aus der Selbstauskunft keinen Zugang zu fremden Basisdaten', () => {
    const { viewer } = person(MITGLIED);

    expect(members.darfSehen(viewer, 'basic', JEMAND_ANDERES)).toBe(false);
  });

  it('lässt die Moderationsakte auch im eigenen Profil zu', () => {
    // Sie war nie `own` und bleibt es nicht - was intern über jemanden
    // vermerkt ist, ist kein Selbstbedienungsdatum.
    const { viewer } = person([...PREMIUM, 'members.view.basic.own', 'members.view.level.own']);

    expect(members.darfSehen(viewer, 'moderation', ICH)).toBe(false);
    expect(members.darfSehen(viewer, 'notes', ICH)).toBe(false);
  });
});

// --- Die drei entfernten Reiter --------------------------------------------

const AKTE = readFileSync(
  join(process.cwd(), 'apps/web/src/modules/members/components/mitglieds-akte.tsx'),
  'utf8',
);

describe('Die drei Reiter im eigenen Profil', () => {
  it('kennt die Ausnahmeliste im eigenen Profil', () => {
    expect(AKTE).toContain('NICHT_IM_EIGENEN_PROFIL');
    for (const abschnitt of ["'spielersuche'", "'tournaments'", "'roles'"]) {
      expect(AKTE, abschnitt).toContain(abschnitt);
    }
  });

  it('filtert sie am eigenen Profil heraus, nicht per CSS', () => {
    // Der Unterschied zählt: ein versteckter Reiter wäre weiterhin da, und
    // sein Inhalt wäre bereits geladen.
    expect(AKTE).toContain('selbst && NICHT_IM_EIGENEN_PROFIL.has(eintrag.section)');
    expect(AKTE).not.toContain('hidden md:hidden');
  });

  it('lässt sie in der Akte eines anderen Mitglieds stehen', () => {
    // Nur im eigenen Profil entfernt - das Mitglieder-Modul behält sie.
    const reiterListe = AKTE.slice(AKTE.indexOf('const REITER'), AKTE.indexOf('] as const;'));

    expect(reiterListe).toContain("label: 'Spielersuche'");
    expect(reiterListe).toContain("label: 'Turniere'");
    expect(reiterListe).toContain("label: 'Rollen'");
  });

  it('fällt bei einem von Hand eingetragenen Reiter auf die Übersicht zurück', () => {
    // `?tab=rollen` im eigenen Profil darf keine leere Seite ergeben.
    expect(AKTE).toContain("reiter.some((eintrag) => eintrag.id === gewaehlt) ? gewaehlt : 'uebersicht'");
  });

  it('lässt die zugrundeliegenden Module unangetastet', () => {
    const vorhanden = new Set(listModuleDefinitions().map((modul) => modul.id));

    expect(vorhanden.has('spielersuche')).toBe(true);
    expect(vorhanden.has('tournaments')).toBe(true);
    // Die Abschnitte selbst bleiben im Member Center bestehen.
    expect(members.MEMBER_SECTIONS).toContain('spielersuche');
    expect(members.MEMBER_SECTIONS).toContain('tournaments');
    expect(members.MEMBER_SECTIONS).toContain('roles');
  });
});

// --- Route und Active State -------------------------------------------------

const PROFIL_ROUTE = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/profile/page.tsx'), 'utf8');

describe('Die eigene Profilroute', () => {
  it('rendert das Profil, statt auf den Mitgliederbereich weiterzuleiten', () => {
    // Eine Weiterleitung auf `/members/<id>` liesse die Seitenleiste
    // «Mitglieder» markieren - einen Eintrag, den ein gewöhnliches Mitglied
    // gar nicht hat.
    expect(PROFIL_ROUTE).toContain('<MitgliedsAkte');
    expect(PROFIL_ROUTE).not.toContain('redirect(');
  });

  it('nimmt die Kennung aus der Sitzung, nicht aus der Adresszeile', () => {
    expect(PROFIL_ROUTE).toContain('context.user.discordId');
    expect(PROFIL_ROUTE).toContain('requireMember()');
  });

  it('teilt sich die Darstellung mit der Mitgliederakte', () => {
    // Keine zweite Profil-Logik: dieselbe Komponente, zwei Routen.
    const mitgliederRoute = readFileSync(
      join(process.cwd(), 'apps/web/src/app/(app)/members/[discordId]/page.tsx'),
      'utf8',
    );

    expect(mitgliederRoute).toContain('<MitgliedsAkte');
  });

  it('verlinkt die Reiter innerhalb des eigenen Profils', () => {
    // Sonst führte der erste Klick aus «Mein Profil» heraus.
    expect(PROFIL_ROUTE).toContain('basisPfad="/profile"');
    expect(AKTE).toContain('${basisPfad}?tab=');
  });
});

describe('Active State der Seitenleiste', () => {
  const SIDEBAR = readFileSync(join(process.cwd(), 'apps/web/src/components/layout/sidebar-nav.tsx'), 'utf8');

  /** Dieselbe Regel wie in der Seitenleiste - längster passender Pfad. */
  function aktiverEintrag(pfad: string, eintraege: string[]): string | null {
    return (
      eintraege
        .filter((href) => pfad === href || pfad.startsWith(`${href}/`))
        .sort((a, b) => b.length - a.length)[0] ?? null
    );
  }

  it('markiert «Mein Profil» auf der eigenen Profilseite', () => {
    const eintraege = hrefs(person(PREMIUM).navigation);

    expect(aktiverEintrag('/profile', eintraege)).toBe('/profile');
  });

  it('markiert es auch auf einer Unterseite des Profils', () => {
    const eintraege = hrefs(person(PREMIUM).navigation);

    expect(aktiverEintrag('/profile/irgendwas', eintraege)).toBe('/profile');
  });

  it('markiert beim Moderator auf der eigenen Profilseite nicht «Mitglieder»', () => {
    // Genau das passierte mit der Weiterleitung: der Pfad lautete
    // `/members/<id>` und traf den Mitgliedereintrag.
    const eintraege = hrefs(person(MODERATOR).navigation);

    expect(aktiverEintrag('/profile', eintraege)).toBe('/profile');
  });

  it('benutzt dieselbe zentrale Regel für Desktop und Mobile', () => {
    // Eine einzige Stelle bestimmt den aktiven Eintrag - und beide
    // Navigationen rendern dieselbe Komponente. Zwei Listen wären zwei
    // Gelegenheiten, sie auseinanderlaufen zu lassen.
    expect(SIDEBAR).toContain('pathname === href || pathname.startsWith(`${href}/`)');

    for (const datei of [
      'apps/web/src/components/layout/sidebar.tsx',
      'apps/web/src/components/layout/mobile-nav.tsx',
    ]) {
      const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
      expect(quelle, datei).toContain('<SidebarNav');
    }
  });
});
