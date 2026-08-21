import { describe, expect, it } from 'vitest';

/**
 * Rauchtests für Navigation und Routen des Kommunikationsmoduls.
 *
 * Hintergrund: Der Eintrag in der Seitenleiste liess sich zeitweise nicht
 * anklicken. Eine der möglichen Ursachen war ein Pfad in der Modul-Registry,
 * den es als Route gar nicht gibt - dann passiert beim Klick schlicht nichts
 * Sichtbares. Diese Tests prüfen, dass Registrierung und Dateisystem
 * zusammenpassen, ohne dafür einen Server starten zu müssen.
 */
const { getModuleDefinition, communication } = await import('@swisshub/modules');
const { existsSync } = await import('node:fs');
const { join } = await import('node:path');

const APP_DIR = join(process.cwd(), 'apps/web/src/app/(app)');

/** Gibt es zu einem Pfad eine Seite im Dateisystem? */
const hasRoute = (href: string): boolean => {
  const segments = href.split('/').filter(Boolean);
  return existsSync(join(APP_DIR, ...segments, 'page.tsx'));
};

describe('Modul-Registrierung', () => {
  const definition = getModuleDefinition(communication.COMMUNICATION_MODULE_ID)!;

  it('ist als echtes Modul registriert', () => {
    expect(definition).toBeDefined();
    expect(definition.defaultEnabled).toBe(true);
  });

  it('trägt keine Platzhalter-Kennzeichnung', () => {
    // "Bald verfügbar" würde den Eintrag in der Seitenleiste unbrauchbar
    // machen - das Modul ist produktiv.
    const raw = JSON.stringify({
      name: definition.name,
      description: definition.description,
      tagline: definition.tagline,
    }).toLowerCase();
    for (const wort of ['coming soon', 'bald verfügbar', 'in arbeit', 'platzhalter']) {
      expect(raw).not.toContain(wort);
    }
  });

  it('verweist in der Navigation auf eine vorhandene Route', () => {
    expect(definition.navigation.length).toBeGreaterThan(0);
    for (const item of definition.navigation) {
      expect(hasRoute(item.href), `Route fehlt: ${item.href}`).toBe(true);
    }
  });

  it('verlangt für den Navigationseintrag nur die Ansichtsberechtigung', () => {
    // Wer den Bereich ansehen darf, soll ihn auch öffnen können - sonst
    // erscheint ein Eintrag, der ins Leere führt.
    expect(definition.navigation[0]?.permission).toBe(communication.COMMUNICATION_PERMISSIONS.view);
  });
});

describe('Routen des Moduls', () => {
  const routen = ['/communication', '/communication/history'];

  it('sind alle vorhanden', () => {
    for (const route of routen) {
      expect(hasRoute(route), `Route fehlt: ${route}`).toBe(true);
    }
  });

  it('haben eine Fehlergrenze, damit ein Fehler nicht das Layout mitreisst', () => {
    // Ohne `error.tsx` schlägt ein Fehler auf das umgebende Layout durch -
    // dann hängt auch die Seitenleiste.
    expect(existsSync(join(APP_DIR, 'communication', 'error.tsx'))).toBe(true);
  });
});

describe('Berechtigungen', () => {
  const definition = getModuleDefinition(communication.COMMUNICATION_MODULE_ID)!;
  const registered = new Set(definition.permissions.map((entry) => entry.key));

  it('führt alle verwendeten Berechtigungen', () => {
    for (const key of Object.values(communication.COMMUNICATION_PERMISSIONS)) {
      expect(registered.has(key), `nicht registriert: ${key}`).toBe(true);
    }
  });

  it('kennzeichnet folgenreiche Berechtigungen als kritisch', () => {
    const byKey = new Map(definition.permissions.map((entry) => [entry.key, entry]));
    expect(byKey.get(communication.COMMUNICATION_PERMISSIONS.mentionEveryone)?.critical).toBe(true);
    expect(byKey.get(communication.COMMUNICATION_PERMISSIONS.send)?.critical).toBe(true);
    // Ansehen ist harmlos.
    expect(byKey.get(communication.COMMUNICATION_PERMISSIONS.view)?.critical).toBeUndefined();
  });
});

describe('Filter aus der Adresszeile', () => {
  it('nimmt gültige Werte an', () => {
    const query = communication.parseHistoryQuery({
      type: 'EVENT',
      status: 'SENT',
      search: 'LAN',
      page: '3',
    });
    expect(query.type).toBe('EVENT');
    expect(query.status).toBe('SENT');
    expect(query.search).toBe('LAN');
    expect(query.page).toBe(3);
  });

  it('fällt bei unsinnigen Werten auf den Standard zurück, statt zu scheitern', () => {
    // Adressparameter kommen aus Lesezeichen, Links oder von Hand. Ein
    // unsinniger Wert darf die Seite nicht mit einem Fehler abbrechen lassen.
    const query = communication.parseHistoryQuery({ page: 'abc', type: 'QUATSCH', status: '???' });
    expect(query.page).toBe(1);
    expect(query.type).toBe('ALL');
    expect(query.status).toBe('ALL');
  });

  it('behält die gültigen Filter, wenn nur einer unsinnig ist', () => {
    const query = communication.parseHistoryQuery({ type: 'POLL', page: 'abc' });
    expect(query.type).toBe('POLL');
    expect(query.page).toBe(1);
  });

  it('verkraftet eine leere Adresse', () => {
    const query = communication.parseHistoryQuery({});
    expect(query.type).toBe('ALL');
    expect(query.page).toBe(1);
  });
});
