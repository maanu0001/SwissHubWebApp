import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTEGRATIONS, getIntegration, envKeysFor } from '@swisshub/secrets';
import { CORE_PERMISSIONS, PERMISSION_PRESETS } from '@swisshub/permissions';

/**
 * Wächter über die Integrationsverwaltung.
 *
 * Die Zusagen dieses Bereichs sind vor allem Zusagen darüber, was *nicht*
 * geschieht: kein Wert verlässt den Server, keiner landet im Protokoll,
 * niemand ohne die passende Berechtigung kommt an die Zugangsdaten.
 *
 * Ein Teil davon lässt sich nur am Quelltext prüfen - etwa, dass keine Seite
 * einen Klartext lädt. Ein Laufzeittest fände das erst, wenn jemand die
 * betreffende Seite besucht, und ein solcher Fehler soll auffallen, bevor er
 * ausgeliefert wird.
 */

const wurzel = fileURLToPath(new URL('../..', import.meta.url));

function lies(pfad: string): string {
  return readFileSync(`${wurzel}${pfad}`, 'utf8');
}

/**
 * Der Quelltext ohne Kommentare.
 *
 * Ein Kommentar, der erklaert, weshalb hier kein `getSecret()` stehen darf,
 * ist selbst kein Aufruf. Ohne diesen Schritt schluege der Waechter auf
 * genau die Erklaerung an, die ihn rechtfertigt.
 */
function ohneKommentare(pfad: string): string {
  return lies(pfad)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

const ACTIONS = lies('apps/web/src/modules/integrations/actions.ts');
const SEITEN = [
  'apps/web/src/app/(app)/system/integrationen/page.tsx',
  'apps/web/src/app/(app)/system/integrationen/discord/page.tsx',
  'apps/web/src/app/(app)/system/integrationen/ai/page.tsx',
  'apps/web/src/app/(app)/system/integrationen/bots/page.tsx',
];
const KOMPONENTEN = [
  'apps/web/src/modules/integrations/components/secret-feld.tsx',
  'apps/web/src/modules/integrations/components/bot-liste.tsx',
  'apps/web/src/modules/integrations/components/ai-einstellungen.tsx',
  'apps/web/src/modules/integrations/components/env-uebernahme.tsx',
  'apps/web/src/modules/integrations/components/test-knopf.tsx',
];

describe('Integrationen: keine Geheimnisse im Browser', () => {
  it('lädt auf keiner Seite einen entschlüsselten Wert', () => {
    // Eine Server Component rendert ihre Daten in das ausgelieferte HTML.
    // `getSecret` oder `botToken` auf einer Seite hiesse: das Token steht im
    // Quelltext der Seite (§20/§62).
    for (const pfad of SEITEN) {
      const inhalt = ohneKommentare(pfad);
      expect(inhalt, `${pfad} ruft getSecret auf`).not.toMatch(/\bgetSecret\s*\(/u);
      expect(inhalt, `${pfad} ruft botToken auf`).not.toMatch(/\bbotToken\s*\(/u);
      expect(inhalt, `${pfad} ruft decryptSecret auf`).not.toMatch(/\bdecryptSecret\s*\(/u);
    }
  });

  it('holt in keiner Client-Komponente einen Wert', () => {
    for (const pfad of KOMPONENTEN) {
      const inhalt = ohneKommentare(pfad);
      expect(inhalt, `${pfad}`).not.toMatch(/\bgetSecret\b/u);
      expect(inhalt, `${pfad}`).not.toMatch(/\bdecryptSecret\b/u);
      expect(inhalt, `${pfad}`).not.toMatch(/MASTER_ENCRYPTION_KEY/u);
    }
  });

  it('setzt Geheimnisfelder als Passwortfeld ohne Autovervollständigung', () => {
    // Sonst bietet der Browser an, ein Bot-Token im Passwortspeicher
    // abzulegen oder es in ein fremdes Formular einzusetzen (§68).
    const feld = lies('apps/web/src/modules/integrations/components/secret-feld.tsx');
    expect(feld).toContain("autoComplete=\"off\"");
    expect(feld).toMatch(/type=\{feld\.secret \? 'password' : 'text'\}/u);

    const bots = lies('apps/web/src/modules/integrations/components/bot-liste.tsx');
    expect(bots).toContain('type="password"');
    expect(bots).toContain('autoComplete="off"');
  });

  it('lädt kein bestehendes Geheimnis in das Eingabefeld zurück', () => {
    // §11: das Feld startet leer. Ein `useState(feld.display)` waere schon
    // zu viel - dann stuende die Maske im Feld und ein Speichern schriebe
    // Punkte als neues Token.
    const feld = lies('apps/web/src/modules/integrations/components/secret-feld.tsx');
    expect(feld).toMatch(/const \[wert, setWert\] = useState\(''\)/u);
  });
});

describe('Integrationen: Berechtigungen', () => {
  it('verlangt für jede Aktion eine Integrations-Berechtigung', () => {
    const bloecke = ACTIONS.split(/export const \w+Action = defineAction\(/u).slice(1);
    expect(bloecke.length).toBeGreaterThanOrEqual(8);

    for (const block of bloecke) {
      const kopf = block.slice(0, block.indexOf('},'));
      const treffer = /permission:\s*P\.(\w+)/u.exec(kopf);
      expect(treffer, `Aktion ohne Permission: ${kopf.slice(0, 120)}`).not.toBeNull();
      expect(['view', 'manage', 'secrets', 'discord', 'ai']).toContain(treffer![1]);
    }
  });

  it('prüft schreibende Aktionen mit frischen Rollen', () => {
    // `critical` laedt die Discord-Rollen neu, ehe autorisiert wird. Ohne das
    // koennte jemand nach dem Entzug seiner Rolle noch minutenlang Tokens
    // austauschen.
    const bloecke = ACTIONS.split(/export const \w+Action = defineAction\(/u).slice(1);
    for (const block of bloecke) {
      const kopf = block.slice(0, block.indexOf('},'));
      expect(kopf, `Aktion ohne freshness: ${kopf.slice(0, 120)}`).toContain(
        "freshness: 'critical'",
      );
    }
  });

  it('begrenzt jede Aktion in der Rate', () => {
    const bloecke = ACTIONS.split(/export const \w+Action = defineAction\(/u).slice(1);
    for (const block of bloecke) {
      const kopf = block.slice(0, block.indexOf('},'));
      expect(kopf, `Aktion ohne rateLimit: ${kopf.slice(0, 120)}`).toMatch(
        /rateLimit: 'integration(Write|Test)'/u,
      );
    }
  });

  it('kennt alle fünf Berechtigungen im Katalog', () => {
    const schluessel = CORE_PERMISSIONS.map((eintrag) => eintrag.key);
    for (const noetig of [
      'integrations.view',
      'integrations.manage',
      'integrations.secrets.manage',
      'integrations.discord.manage',
      'integrations.ai.manage',
    ]) {
      expect(schluessel).toContain(noetig);
    }
  });

  it('markiert die schreibenden Berechtigungen als kritisch', () => {
    for (const schluessel of [
      'integrations.manage',
      'integrations.secrets.manage',
      'integrations.discord.manage',
      'integrations.ai.manage',
    ]) {
      const eintrag = CORE_PERMISSIONS.find((zeile) => zeile.key === schluessel);
      expect(eintrag?.critical, schluessel).toBe(true);
    }
  });

  it('gibt keine Integrations-Berechtigung an eine Mitglieder-Vorlage', () => {
    // Zugangsdaten sind Administratorensache. Eine Vorlage, die sie
    // versehentlich mitbringt, waere der stillste denkbare Fehler.
    for (const vorlage of PERMISSION_PRESETS) {
      if (vorlage.permissions.includes('*')) {
        continue;
      }
      const treffer = vorlage.permissions.filter(
        (eintrag) => eintrag.startsWith('integrations.') || eintrag === 'integrations',
      );
      expect(treffer, `Vorlage «${vorlage.id}»`).toEqual([]);
    }
  });
});

describe('Integrationen: Audit ohne Werte', () => {
  it('übergibt dem Audit keinen Wert', () => {
    // §13: Integration, Feld, Handelnder, Zeitpunkt, Aktion - mehr nicht.
    // Diese Namen kommen in den Eingaben der Aktionen vor; taucht einer in
    // einem `protokolliere`-Aufruf auf, steht ein Wert im Protokoll.
    // Nur Aufrufe, nicht die Definition: sie beginnen mit dem Kontext.
    const aufrufe = [...ACTIONS.matchAll(/protokolliere\(\s*ctx,([\s\S]*?)\n\s*\}?\);/gu)].map(
      (treffer) => treffer[1] ?? '',
    );
    expect(aufrufe.length).toBeGreaterThanOrEqual(8);

    for (const aufruf of aufrufe) {
      expect(aufruf, aufruf.slice(0, 120)).not.toMatch(/\binput\.value\b/u);
      expect(aufruf, aufruf.slice(0, 120)).not.toMatch(/\binput\.token\b/u);
      expect(aufruf, aufruf.slice(0, 120)).not.toMatch(/\bdisplay\b/u);
      expect(aufruf, aufruf.slice(0, 120)).not.toMatch(/oldValue|newValue|klartext/u);
    }
  });
});

describe('Integrationskatalog', () => {
  it('kennzeichnet jedes Geheimnis als geheim', () => {
    // Feste Liste statt Namensheuristik: «maxTokens» enthaelt «Token» und ist
    // trotzdem eine Zahl. Wer ein Feld ergaenzt, traegt es hier ein - und
    // merkt dabei, dass er sich entscheiden muss.
    const geheim: Array<[string, string]> = [
      ['discord', 'botToken'],
      ['discord', 'clientSecret'],
      ['ai', 'apiKey'],
      ['music', 'runtimeKey'],
      ['payment', 'apiKey'],
      ['payment', 'webhookSecret'],
    ];
    for (const [integrationId, key] of geheim) {
      const feld = getIntegration(integrationId)?.fields.find((eintrag) => eintrag.key === key);
      expect(feld, `${integrationId}.${key} fehlt im Katalog`).toBeDefined();
      expect(feld?.secret, `${integrationId}.${key}`).toBe(true);
    }

    // Und die Gegenprobe: alles, was `secret` traegt, steht in der Liste.
    for (const integration of INTEGRATIONS) {
      for (const feld of integration.fields.filter((eintrag) => eintrag.secret)) {
        expect(
          geheim.some(([id, key]) => id === integration.id && key === feld.key),
          `${integration.id}.${feld.key} ist geheim, steht aber nicht in der Liste`,
        ).toBe(true);
      }
    }
  });

  it('behandelt die Client ID ausdrücklich nicht als Geheimnis', () => {
    // Sie steht in jeder Einladungs-URL. Sie zu verstecken hülfe niemandem
    // und machte die Fehlersuche schwerer.
    expect(getIntegration('discord')?.fields.find((feld) => feld.key === 'clientId')?.secret).toBe(
      false,
    );
  });

  it('sucht den AI-Schlüssel je Anbieter in der passenden Variablen', () => {
    expect(envKeysFor('ai', 'apiKey', 'openai')).toEqual(['OPENAI_API_KEY']);
    expect(envKeysFor('ai', 'apiKey', 'anthropic')).toEqual(['ANTHROPIC_API_KEY']);
    // Ohne Angabe beide - beim Einsammeln der Kandidaten ist der Anbieter
    // noch nicht entschieden.
    expect(envKeysFor('ai', 'apiKey')).toHaveLength(2);
  });

  it('nennt für jede Pflichtangabe einen Rückfall in der Umgebung', () => {
    // Sonst liesse sich eine bestehende Installation nicht umstellen, ohne
    // sie vorher lahmzulegen (§39).
    for (const integration of INTEGRATIONS) {
      for (const feld of integration.fields.filter((eintrag) => eintrag.required)) {
        expect(
          envKeysFor(integration.id, feld.key).length,
          `${integration.id}.${feld.key}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
