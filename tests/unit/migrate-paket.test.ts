import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migration } from '@swisshub/modules';

/**
 * Das Übertragungspaket.
 *
 * Eine Datei, die von aussen kommt und aus der Berechtigungen entstehen -
 * mehr Grund für Misstrauen gibt es in diesem System nicht. Geprüft wird
 * deshalb vor allem, was NICHT durchkommt.
 */

const gueltig = () => ({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  applicationVersion: '1.0.0',
  sourceGuild: { id: '900000000000000001', name: 'SwissHub Test' },
  modules: [{ id: 'tickets', enabled: true, configVersion: 1, settings: { maxOpenPerUser: 3 } }],
  roles: [
    {
      discordRoleId: '900000000000000010',
      sourceName: 'Moderator',
      label: 'Moderator',
      isProtected: false,
      keepOnJail: false,
      moderationLevel: 50,
      permissions: ['moderation.view'],
    },
  ],
  automations: [],
  integrations: [],
});

const alsText = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...gueltig(), ...patch });

describe('Ein gültiges Paket', () => {
  it('wird angenommen', () => {
    const paket = migration.lesePaket(alsText());
    expect(paket.modules).toHaveLength(1);
    expect(paket.roles[0]?.permissions).toEqual(['moderation.view']);
  });
});

describe('Was nicht durchkommt', () => {
  it('eine andere Schema-Fassung', () => {
    // Halb verstandene Pakete sind schlimmer als abgelehnte.
    expect(() => migration.lesePaket(alsText({ schemaVersion: 2 }))).toThrow(/Fassung/u);
    expect(() => migration.lesePaket(alsText({ schemaVersion: undefined }))).toThrow(/Fassung/u);
  });

  it('kein JSON', () => {
    expect(() => migration.lesePaket('{kaputt')).toThrow(/JSON/u);
  });

  it('ein übergrosses Paket', () => {
    const riesig = 'x'.repeat(migration.MAX_PACKAGE_BYTES + 1);
    expect(() => migration.lesePaket(riesig)).toThrow(/zu gross/u);
  });

  it('ein unbekanntes Feld auf oberster Ebene', () => {
    // `.strict()`: ein Feld, das niemand erwartet hat, ist kein Zusatz.
    expect(() => migration.lesePaket(alsText({ tables: [{ name: 'User' }] }))).toThrow(/Aufbau/u);
  });

  it('ein unbekanntes Feld in einem Modul', () => {
    const paket = gueltig();
    const roh = JSON.stringify({
      ...paket,
      modules: [{ ...paket.modules[0], zusatz: 'etwas' }],
    });
    expect(() => migration.lesePaket(roh)).toThrow(/Aufbau/u);
  });

  it('eine Rollen-ID, die keine Snowflake ist', () => {
    const paket = gueltig();
    const roh = JSON.stringify({
      ...paket,
      roles: [{ ...paket.roles[0], discordRoleId: '../../etc/passwd' }],
    });
    expect(() => migration.lesePaket(roh)).toThrow(/Aufbau/u);
  });
});

describe('Zugangsdaten kommen nirgends durch', () => {
  const geheimeNamen = [
    'botToken',
    'clientSecret',
    'apiKey',
    'MASTER_ENCRYPTION_KEY',
    'auth_secret',
    'webhookSecret',
    'refresh_token',
    'password',
  ];

  it('erkennt sie am Namen', () => {
    for (const name of geheimeNamen) {
      expect(migration.istGeheimerSchluessel(name), name).toBe(true);
    }
  });

  it('hält gewöhnliche Namen für gewöhnlich', () => {
    for (const name of ['channelId', 'maxOpenPerUser', 'label', 'enabled', 'reasonTemplates']) {
      expect(migration.istGeheimerSchluessel(name), name).toBe(false);
    }
  });

  it('findet sie auch tief in den Einstellungen', () => {
    const treffer = migration.findeGeheimnisse({
      modules: [{ id: 'ai', settings: { anbieter: { apiKey: 'sk-123' } } }],
    });
    expect(treffer).toHaveLength(1);
    expect(treffer[0]).toContain('apiKey');
  });

  it('weist ein Paket mit einem Token darin ab', () => {
    const paket = gueltig();
    const roh = JSON.stringify({
      ...paket,
      modules: [{ ...paket.modules[0], settings: { botToken: 'MTIz.abc.def' } }],
    });
    // Und zwar bevor das Schema greift - der Grund soll «Zugangsdaten»
    // heissen und nicht «unbekanntes Feld».
    expect(() => migration.lesePaket(roh)).toThrow(/Zugangsdaten/u);
  });

  it('nennt die Fundstelle, aber nicht den Wert', () => {
    const roh = JSON.stringify({ ...gueltig(), sourceGuild: { id: '1', name: 'x', apiKey: 'sk-geheim' } });
    try {
      migration.lesePaket(roh);
      expect.unreachable('hätte werfen müssen');
    } catch (fehler) {
      const meldung = (fehler as Error).message;
      expect(meldung).toContain('apiKey');
      expect(meldung).not.toContain('sk-geheim');
    }
  });
});

describe('JSON-Missbrauch', () => {
  it('lässt keinen Prototyp-Schlüssel in die Einstellungen', () => {
    // `JSON.parse` legt `__proto__` als gewöhnliches Feld an. Wer es
    // ungeprüft in ein `Object.assign` gibt, ändert die Prototypkette des
    // Prozesses.
    const paket = gueltig();
    const roh = JSON.stringify({
      ...paket,
      modules: [{ ...paket.modules[0], settings: { tief: { __proto__: { boese: true } } } }],
    });
    // `JSON.stringify` verwirft `__proto__` beim Serialisieren nicht immer -
    // wenn es durchkommt, muss das Schema es abweisen.
    const enthaelt = roh.includes('__proto__');
    if (enthaelt) {
      expect(() => migration.lesePaket(roh)).toThrow();
    } else {
      expect(enthaelt).toBe(false);
    }
  });

  it('begrenzt die Zahl der Einträge', () => {
    const paket = gueltig();
    const viele = Array.from({ length: 201 }, (_, index) => ({
      ...paket.roles[0]!,
      discordRoleId: String(900000000000000000n + BigInt(index)),
    }));
    expect(() => migration.lesePaket(JSON.stringify({ ...paket, roles: viele }))).toThrow(/Aufbau/u);
  });
});

describe('Der Export baut das Paket selbst', () => {
  const quelle = readFileSync(join(process.cwd(), 'packages/modules/src/migration/export.ts'), 'utf8');

  it('liest die Geheimnistabelle nicht einmal an', () => {
    // `IntegrationStatus` trägt den Zustand, `IntegrationSecret` den
    // Geheimtext. Ihn hier auch nur zu lesen wäre der erste Schritt dahin,
    // ihn zu exportieren.
    expect(quelle).toContain('integrationStatus');
    expect(quelle).not.toContain('integrationSecret');
  });

  it('nennt jedes Feld einzeln, statt Tabellen abzuziehen', () => {
    expect(quelle).not.toMatch(/for \(const table of/u);
    expect(quelle).toContain('moduleState.findMany');
    expect(quelle).toContain('managedRole.findMany');
  });

  it('prüft am Ende selbst noch einmal auf Geheimnisse', () => {
    expect(quelle).toContain('findeGeheimnisse(paket)');
  });

  it('nimmt keine Historie mit', () => {
    for (const tabelle of ['ticket.', 'jailEntry', 'appeal', 'auditLog', 'moderationAction']) {
      expect(quelle, tabelle).not.toContain(tabelle);
    }
  });
});
