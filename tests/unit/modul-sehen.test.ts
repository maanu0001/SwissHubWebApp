import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  alteSichtbarkeitsKeys,
  buildNavigation,
  groupNavigation,
  listModuleDefinitions,
  moduleViewPermission,
  moduleViewPermissionFor,
  moduleViewPermissionOf,
} from '@swisshub/modules';
import {
  ADMIN_FULL,
  PERMISSION_PRESETS,
  hasPermission,
  listPermissions,
  resolvePreset,
} from '@swisshub/permissions';

/**
 * «Modul sehen».
 *
 * Die Berechtigung, die entscheidet, ob ein Bereich in der Seitenleiste
 * erscheint. Sie ist neu, und sie ist die einzige Aenderung in diesem Projekt,
 * die im Fehlerfall *jedem* die halbe Anwendung nimmt - deshalb steht hier
 * mehr als eine Zusicherung.
 *
 * Zwei Fragen laufen durch alle Faelle unten:
 *
 *  - Sperrt sie zuverlaessig? (Ohne Schluessel kein Eintrag - auch dann nicht,
 *    wenn jemand im Modul handeln duerfte.)
 *  - Sperrt sie *nur*? (Sie ist keine Superberechtigung: sie oeffnet einen
 *    Bereich und keine einzige Aktion darin.)
 */

const MODULE = listModuleDefinitions();
const MIT_NAVIGATION = MODULE.filter((modul) => modul.navigation.length > 0);
const ALLE_MODULE = new Set(MODULE.map((modul) => modul.id));
const BEKANNT = new Set(listPermissions().map((eintrag) => eintrag.key));

describe('«Modul sehen» - Registrierung', () => {
  it('vergibt jedem Modul mit Seitenleisteneintrag einen Schlüssel', () => {
    expect(MIT_NAVIGATION.length).toBeGreaterThan(10);
    for (const modul of MIT_NAVIGATION) {
      const schluessel = moduleViewPermissionOf(modul);
      expect(schluessel, `${modul.id} hat keinen «Modul sehen»-Schlüssel`).not.toBeNull();
      expect(BEKANNT.has(schluessel!), `${schluessel} ist nicht registriert`).toBe(true);
    }
  });

  it('zeigt den Schlüssel im Berechtigungseditor unter «Modul sehen»', () => {
    for (const modul of MIT_NAVIGATION) {
      const eintrag = listPermissions().find((p) => p.key === moduleViewPermissionOf(modul));
      expect(eintrag?.label).toBe('Modul sehen');
    }
  });

  it('folgt der bestehenden Namenskonvention', () => {
    expect(moduleViewPermission('music')).toBe('music.module.view');
    expect(moduleViewPermission('voiceHub')).toBe('voiceHub.module.view');
    // Erste Segment = Präfix: damit greift die bestehende Wildcard-Semantik.
    expect(moduleViewPermission('jail').split('.')[0]).toBe('jail');
  });

  it('gibt Modulen ohne Seitenleisteneintrag keinen Schlüssel', () => {
    for (const modul of MODULE.filter((m) => m.navigation.length === 0)) {
      expect(moduleViewPermissionOf(modul)).toBeNull();
    }
  });
});

describe('«Modul sehen» - Sidebar', () => {
  const alleRechte = [...BEKANNT];

  it('zeigt mit Schlüssel den Tab', () => {
    const eintraege = buildNavigation(
      ['music.module.view', 'music.view'],
      new Set(['music']),
    );
    expect(eintraege.some((eintrag) => eintrag.href === '/musik')).toBe(true);
  });

  it('zeigt ohne Schlüssel keinen Tab - auch nicht mit Aktionsrechten', () => {
    // Genau der Fall aus der Aufgabe: `music.queue.manage`, aber kein
    // «Modul sehen». Frueher genuegte irgendein Recht des Moduls.
    const eintraege = buildNavigation(
      ['music.view', 'music.queue.manage', 'music.play', 'music.skip'],
      new Set(['music']),
    );
    expect(eintraege.some((eintrag) => eintrag.moduleId === 'music')).toBe(false);
  });

  it('macht «Modul sehen» nicht zur Superberechtigung', () => {
    // Der Schluessel allein oeffnet den Bereich nicht, wenn die Berechtigung
    // des Eintrags fehlt - und er vergibt schon gar keine Aktion.
    const nurSehen = buildNavigation(['jail.module.view'], new Set(['jail']));
    expect(nurSehen).toHaveLength(0);

    const mitEintrag = buildNavigation(
      ['jail.module.view', 'jail.vote.start'],
      new Set(['jail']),
    );
    expect(mitEintrag.map((eintrag) => eintrag.href)).toEqual(['/vote-jail']);
  });

  it('entfernt den ganzen Bereich, nicht nur einen Eintrag', () => {
    const ohne = buildNavigation(
      alleRechte.filter((recht) => recht !== 'level.module.view'),
      ALLE_MODULE,
    );
    expect(ohne.some((eintrag) => eintrag.moduleId === 'level')).toBe(false);

    const mit = buildNavigation(alleRechte, ALLE_MODULE);
    expect(mit.filter((eintrag) => eintrag.moduleId === 'level').length).toBeGreaterThan(0);
  });

  it('lässt admin.full und Wildcards weiterhin alles sehen', () => {
    // `admin.full` und `<praefix>.*` werden vor der Seitenleiste zu einer
    // konkreten Liste aufgeloest (`expandPermissions`). Hier wird gepruefen,
    // dass der neue Schluessel Teil dieser Liste ist - sonst verloere gerade
    // der Administrator seine Navigation.
    const vollzugriff = {
      discordId: '1',
      isOwner: false,
      granted: new Set([ADMIN_FULL]),
      matchedRoleIds: [],
    };
    const wildcard = {
      discordId: '2',
      isOwner: false,
      granted: new Set(['music.*']),
      matchedRoleIds: [],
    };

    for (const modul of MIT_NAVIGATION) {
      expect(hasPermission(vollzugriff, moduleViewPermissionOf(modul)!)).toBe(true);
    }
    expect(hasPermission(wildcard, 'music.module.view')).toBe(true);
    expect(hasPermission(wildcard, 'jail.module.view')).toBe(false);
  });

  it('bringt mit allen Rechten jeden Eintrag in die gruppierte Navigation', () => {
    const sichtbar = new Set(
      groupNavigation(buildNavigation(alleRechte, ALLE_MODULE))
        .flatMap((gruppe) => gruppe.items)
        .map((eintrag) => eintrag.href),
    );
    for (const modul of MIT_NAVIGATION) {
      for (const eintrag of modul.navigation) {
        expect(sichtbar.has(eintrag.href), `${modul.id} → ${eintrag.href} fehlt`).toBe(true);
      }
    }
  });
});

describe('«Modul sehen» - Seitenschutz', () => {
  it('leitet jede Modulberechtigung auf ihren Schlüssel ab', () => {
    expect(moduleViewPermissionFor('jail.vote.start')).toBe('jail.module.view');
    expect(moduleViewPermissionFor('music.queue.manage')).toBe('music.module.view');
    expect(moduleViewPermissionFor('voiceHub.manageOwn')).toBe('voiceHub.module.view');
  });

  it('verlangt sich nicht selbst', () => {
    expect(moduleViewPermissionFor('jail.module.view')).toBeNull();
  });

  it('lässt Berechtigungen ohne Modul unberührt', () => {
    expect(moduleViewPermissionFor('permissions.manage')).toBeNull();
    expect(moduleViewPermissionFor('integrations.view')).toBeNull();
  });

  it('wird vom Seitenschutz tatsächlich angewandt', () => {
    // Die Seitenleiste ist Darstellung. Wer die Adresse kennt, umgeht sie -
    // deshalb muss `requirePagePermission` denselben Schluessel pruefen.
    const quelle = readFileSync(join(process.cwd(), 'apps/web/src/server/auth.ts'), 'utf8');
    expect(quelle).toContain('moduleViewPermissionFor');
  });
});

describe('«Modul sehen» - bestehende Rollen', () => {
  it('kennt die Wege, über die ein Eintrag früher sichtbar wurde', () => {
    const jail = MODULE.find((modul) => modul.id === 'jail')!;
    const keys = alteSichtbarkeitsKeys(jail);
    // Der Eintrag ist der Vote Jail: Hauptberechtigung «starten», Ausweichweg
    // «einsehen». Die Strafakte selbst hat keinen Eintrag mehr - sie steht
    // unter «Moderation».
    expect(keys).toContain('jail.vote.start');
    expect(keys).toContain('jail.view');
  });

  it('nennt für jedes Modul mindestens einen alten Weg', () => {
    for (const modul of MIT_NAVIGATION) {
      expect(alteSichtbarkeitsKeys(modul).length, `${modul.id}`).toBeGreaterThan(0);
    }
  });

  it('lässt keine Vorlage ohne Navigation zurück', () => {
    // Eine Vorlage ersetzt die Rechte einer Rolle vollstaendig. Eine ohne
    // «Modul sehen» setzte die Rolle auf eine leere Seitenleiste.
    for (const vorlage of PERMISSION_PRESETS) {
      const rechte = resolvePreset(vorlage);
      if (rechte.includes(ADMIN_FULL)) {
        continue;
      }
      const eintraege = buildNavigation(rechte, ALLE_MODULE);
      expect(eintraege.length, `Vorlage «${vorlage.label}» sieht gar nichts`).toBeGreaterThan(0);
    }
  });

  it('gibt der Vorlage «Mitglied» dieselben Bereiche wie zuvor', () => {
    const rechte = resolvePreset(PERMISSION_PRESETS.find((v) => v.id === 'mitglied')!);
    const module = new Set(buildNavigation(rechte, ALLE_MODULE).map((e) => e.moduleId));
    for (const erwartet of ['dashboard', 'spielersuche', 'level', 'tournaments', 'voiceHub']) {
      expect(module.has(erwartet), `«Mitglied» sieht ${erwartet} nicht mehr`).toBe(true);
    }
    // Und weiterhin nichts aus der Moderation.
    expect(module.has('jail')).toBe(false);
    expect(module.has('moderation')).toBe(false);
  });

  it('gibt der Vorlage «Premium» Musik und den Vote Jail, aber keine Moderation', () => {
    const rechte = resolvePreset(PERMISSION_PRESETS.find((v) => v.id === 'premium')!);
    const module = new Set(buildNavigation(rechte, ALLE_MODULE).map((e) => e.moduleId));
    const seiten = new Set(
      buildNavigation(rechte, ALLE_MODULE).map((eintrag) => eintrag.href),
    );
    expect(module.has('music')).toBe(true);

    // Den Jail-Bereich sieht Premium, weil dort der Vote Jail beginnt - eine
    // Abstimmung, die die Gemeinschaft führt, nicht eine Massnahme, die
    // Premium verhängt. Moderationsrechte folgen daraus ausdrücklich nicht:
    // wer abstimmen lassen darf, darf deswegen nicht selbst einsperren.
    expect(module.has('jail')).toBe(true);
    expect(rechte).toContain('jail.vote.start');
    for (const moderationsrecht of [
      'jail.create',
      'jail.edit',
      'jail.release',
      'jail.settings',
      'jail.import',
      'jail.vote.multivote',
      'jail.vote.bypassCooldown',
    ]) {
      expect(rechte, `Premium hat ${moderationsrecht}`).not.toContain(moderationsrecht);
    }
    expect(module.has('moderation')).toBe(false);
    // Das eigene Profil ja - die Mitgliedersuche nicht. Beide gehoeren zum
    // Modul «Mitglieder»; «Modul sehen» oeffnet den Bereich, nicht die Suche.
    expect(seiten.has('/profile')).toBe(true);
    expect(seiten.has('/members')).toBe(false);
  });
});
