import { describe, expect, it } from 'vitest';
import {
  explainPermission,
  hasPermission,
  resolvePermissions,
  type RolePermissionMapping,
} from '@swisshub/permissions';

/**
 * Vollzugriff mit ausdruecklichen Ausnahmen.
 *
 * Vorher war Vollzugriff eine Einbahnstrasse: `admin.full` gab alles, und
 * einzelne Haekchen daneben blieben wirkungslos - es gab keinen Weg, einer
 * Administratorenrolle eine einzelne gefaehrliche Aktion wieder wegzunehmen.
 *
 * Geprueft wird deshalb nicht nur, dass eine Ausnahme greift, sondern auch,
 * dass sie sich nicht aushebeln laesst: nicht ueber `admin.full`, nicht ueber
 * eine Wildcard, und nicht dadurch, dass man der Person noch eine zweite
 * Rolle gibt. Und dass der System-Owner davon unberuehrt bleibt - er ist der
 * Notzugang, und wer ihn aussperren kann, sperrt niemanden mehr aus.
 */

const ADMIN_ROLE = '900000000000002001';
const MOD_ROLE = '900000000000002002';
const HELFER_ROLE = '900000000000002003';

const subject = (roleIds: string[], isOwner = false) => ({
  discordId: '900000000000002099',
  roleIds,
  isOwner,
});

const loese = (mappings: RolePermissionMapping[], roleIds: string[], isOwner = false) =>
  resolvePermissions(subject(roleIds, isOwner), mappings);

const erlaube = (discordRoleId: string, permission: string): RolePermissionMapping => ({
  discordRoleId,
  permission,
  effect: 'ALLOW',
});

const verweigere = (discordRoleId: string, permission: string): RolePermissionMapping => ({
  discordRoleId,
  permission,
  effect: 'DENY',
});

describe('Ausdrueckliche Ausnahmen', () => {
  it('erlaubt mit Vollzugriff jede registrierte Berechtigung', () => {
    const resolution = loese([erlaube(ADMIN_ROLE, 'admin.full')], [ADMIN_ROLE]);

    for (const permission of ['migration.execute', 'jail.create', 'settings.edit', 'audit.view']) {
      expect(hasPermission(resolution, permission)).toBe(true);
    }
  });

  it('sperrt mit Vollzugriff genau die eine Ausnahme und sonst nichts', () => {
    const resolution = loese(
      [erlaube(ADMIN_ROLE, 'admin.full'), verweigere(ADMIN_ROLE, 'migration.execute')],
      [ADMIN_ROLE],
    );

    expect(hasPermission(resolution, 'migration.execute')).toBe(false);
    for (const permission of ['jail.create', 'settings.edit', 'audit.view', 'permissions.manage']) {
      expect(hasPermission(resolution, permission)).toBe(true);
    }
  });

  it('haelt zwei Ausnahmen unabhaengig voneinander', () => {
    const resolution = loese(
      [
        erlaube(ADMIN_ROLE, 'admin.full'),
        verweigere(ADMIN_ROLE, 'migration.execute'),
        verweigere(ADMIN_ROLE, 'integrations.secrets.manage'),
      ],
      [ADMIN_ROLE],
    );

    expect(hasPermission(resolution, 'migration.execute')).toBe(false);
    expect(hasPermission(resolution, 'integrations.secrets.manage')).toBe(false);
    expect(hasPermission(resolution, 'settings.edit')).toBe(true);
  });

  it('gibt die Berechtigung zurueck, sobald die Ausnahme entfernt wird', () => {
    const mitAusnahme = loese(
      [erlaube(ADMIN_ROLE, 'admin.full'), verweigere(ADMIN_ROLE, 'migration.execute')],
      [ADMIN_ROLE],
    );
    const ohneAusnahme = loese([erlaube(ADMIN_ROLE, 'admin.full')], [ADMIN_ROLE]);

    expect(hasPermission(mitAusnahme, 'migration.execute')).toBe(false);
    expect(hasPermission(ohneAusnahme, 'migration.execute')).toBe(true);
  });

  it('schlaegt auch eine Wildcard, nicht nur den Vollzugriff', () => {
    const resolution = loese([erlaube(MOD_ROLE, 'jail.*'), verweigere(MOD_ROLE, 'jail.release')], [MOD_ROLE]);

    expect(hasPermission(resolution, 'jail.create')).toBe(true);
    expect(hasPermission(resolution, 'jail.release')).toBe(false);
  });

  it('sperrt als Bereichsausnahme den ganzen Praefix', () => {
    const resolution = loese(
      [erlaube(ADMIN_ROLE, 'admin.full'), verweigere(ADMIN_ROLE, 'jail.*')],
      [ADMIN_ROLE],
    );

    expect(hasPermission(resolution, 'jail.create')).toBe(false);
    expect(hasPermission(resolution, 'jail.release')).toBe(false);
    expect(hasPermission(resolution, 'settings.edit')).toBe(true);
  });

  it('laesst sich nicht durch eine zweite Rolle aushebeln', () => {
    // Die Ausnahme haengt an der einen Rolle, die Erlaubnis an der anderen.
    // Gewaenne die Erlaubnis, waere jede Ausnahme wertlos: man muesste der
    // Person nur irgendeine weitere Rolle geben.
    const resolution = loese(
      [
        erlaube(ADMIN_ROLE, 'admin.full'),
        verweigere(ADMIN_ROLE, 'migration.execute'),
        erlaube(HELFER_ROLE, 'migration.execute'),
      ],
      [ADMIN_ROLE, HELFER_ROLE],
    );

    expect(hasPermission(resolution, 'migration.execute')).toBe(false);
  });

  it('ignoriert Ausnahmen von Rollen, die jemand gar nicht traegt', () => {
    const resolution = loese(
      [erlaube(ADMIN_ROLE, 'admin.full'), verweigere(MOD_ROLE, 'migration.execute')],
      [ADMIN_ROLE],
    );

    expect(hasPermission(resolution, 'migration.execute')).toBe(true);
  });

  it('sperrt den System-Owner nicht aus - auch nicht mit passender Ausnahme', () => {
    const resolution = loese(
      [
        erlaube(ADMIN_ROLE, 'admin.full'),
        verweigere(ADMIN_ROLE, 'migration.execute'),
        verweigere(ADMIN_ROLE, 'permissions.manage'),
      ],
      [ADMIN_ROLE],
      true,
    );

    expect(hasPermission(resolution, 'migration.execute')).toBe(true);
    expect(hasPermission(resolution, 'permissions.manage')).toBe(true);
  });

  it('trennt Erlaubnisse und Ausnahmen in der Aufloesung', () => {
    const resolution = loese(
      [erlaube(ADMIN_ROLE, 'admin.full'), verweigere(ADMIN_ROLE, 'migration.execute')],
      [ADMIN_ROLE],
    );

    expect([...resolution.granted]).toEqual(['admin.full']);
    expect([...resolution.denied]).toEqual(['migration.execute']);
  });

  it('behandelt eine Zuordnung ohne Wirkung wie bisher als Erlaubnis', () => {
    // Bestandsdaten und aeltere Aufrufer geben kein `effect` mit. Wuerde das
    // als Ausnahme gelesen, verloere nach dem Deployment jede Rolle alles.
    const resolution = loese([{ discordRoleId: MOD_ROLE, permission: 'jail.create' }], [MOD_ROLE]);

    expect(hasPermission(resolution, 'jail.create')).toBe(true);
    expect(resolution.denied.size).toBe(0);
  });
});

describe('Begruendung einer Berechtigung', () => {
  const erklaere = (granted: string[], denied: string[], permission: string, isOwner = false) =>
    explainPermission({ isOwner, granted: new Set(granted), denied: new Set(denied) }, permission);

  it('nennt den Vollzugriff als Quelle', () => {
    const erklaerung = erklaere(['admin.full'], [], 'jail.create');

    expect(erklaerung.allowed).toBe(true);
    expect(erklaerung.source).toBe('FULL_ACCESS');
    expect(erklaerung.reason).toBe('Erlaubt durch Vollzugriff.');
  });

  it('nennt bei einer Ausnahme trotz Vollzugriff beides', () => {
    const erklaerung = erklaere(['admin.full'], ['migration.execute'], 'migration.execute');

    expect(erklaerung.allowed).toBe(false);
    expect(erklaerung.source).toBe('EXPLICIT_DENY');
    expect(erklaerung.reason).toBe(
      'Erlaubt durch Vollzugriff, aber verweigert durch eine ausdrückliche Ausnahme.',
    );
  });

  it('unterscheidet «nie erteilt» von «ausdruecklich verweigert»', () => {
    const nie = erklaere([], [], 'jail.create');
    const gesperrt = erklaere([], ['jail.create'], 'jail.create');

    expect(nie.source).toBe('NOT_GRANTED');
    expect(gesperrt.source).toBe('EXPLICIT_DENY');
    expect(nie.reason).not.toBe(gesperrt.reason);
  });

  it('nennt die Wildcard, durch die eine Berechtigung greift', () => {
    const erklaerung = erklaere(['jail.*'], [], 'jail.create');

    expect(erklaerung.source).toBe('WILDCARD');
    expect(erklaerung.reason).toContain('jail.*');
  });

  it('nennt den System-Owner und sagt, dass er nicht entziehbar ist', () => {
    const erklaerung = erklaere([], ['migration.execute'], 'migration.execute', true);

    expect(erklaerung.allowed).toBe(true);
    expect(erklaerung.source).toBe('SYSTEM_OWNER');
    expect(erklaerung.reason).toContain('nicht entziehen');
  });

  it('erklaert jeden Zustand, den die Oberflaeche zeigen kann', () => {
    // Kein Zustand ohne Begruendung: die Matrix zeigt an jeder Zeile einen
    // Satz, und der darf nirgends leer bleiben.
    const faelle = [
      erklaere(['jail.create'], [], 'jail.create'),
      erklaere(['admin.full'], [], 'jail.create'),
      erklaere(['jail.*'], [], 'jail.create'),
      erklaere(['admin.full'], ['jail.create'], 'jail.create'),
      erklaere([], [], 'jail.create'),
      erklaere([], [], 'jail.create', true),
    ];

    expect(new Set(faelle.map((fall) => fall.source)).size).toBe(6);
    for (const fall of faelle) {
      expect(fall.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
