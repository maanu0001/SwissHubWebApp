import { describe, expect, it } from 'vitest';

/**
 * Rauchtests des Ticket-Moduls.
 *
 * Zwei Dinge lassen sich nur so pruefen, ohne einen Server zu starten: dass
 * jeder Bereich, auf den die Oberflaeche verweist, als Seite existiert - und
 * dass jede Berechtigung, die im Code geprueft wird, auch vergeben werden
 * kann. Eine Berechtigung, die niemand zuteilen kann, sperrt lautlos aus.
 */
const { getModuleDefinition, tickets } = await import('@swisshub/modules');
const { existsSync, readFileSync, globSync } = await import('node:fs');
const { join } = await import('node:path');

const APP_DIR = join(process.cwd(), 'apps/web/src/app/(app)');
const API_DIR = join(process.cwd(), 'apps/web/src/app/api');

const hatSeite = (href: string): boolean =>
  existsSync(join(APP_DIR, ...href.split('/').filter(Boolean), 'page.tsx'));

describe('Ticket-Modul', () => {
  const definition = getModuleDefinition(tickets.TICKETS_MODULE_ID)!;

  it('ist registriert und standardmässig aus', () => {
    expect(definition).toBeDefined();
    // Das Modul legt Discord-Kanäle an - eingeschaltet wird, wenn Kategorie
    // und Support-Rollen stehen.
    expect(definition.defaultEnabled).toBe(false);
  });

  it('trägt keine Platzhalter-Kennzeichnung', () => {
    const raw = JSON.stringify({
      name: definition.name,
      description: definition.description,
      tagline: definition.tagline,
    }).toLowerCase();
    for (const wort of ['coming soon', 'bald verfügbar', 'in arbeit', 'platzhalter']) {
      expect(raw).not.toContain(wort);
    }
  });

  it('verweist in der Navigation auf eine vorhandene Seite', () => {
    expect(definition.navigation.length).toBeGreaterThan(0);
    for (const eintrag of definition.navigation) {
      expect(hatSeite(eintrag.href), `Seite fehlt: ${eintrag.href}`).toBe(true);
    }
  });

  it('hat für jeden Bereich der Unternavigation eine Seite', () => {
    // Dieselbe Liste wie in `apps/web/src/server/tickets.ts`. Sie steht hier
    // ausgeschrieben, weil jene Datei `server-only` importiert.
    const bereiche = [
      '/tickets',
      '/tickets/offen',
      '/tickets/meine',
      '/tickets/neu',
      '/tickets/archiv',
      '/tickets/kategorien',
      '/tickets/panels',
      '/tickets/statistiken',
    ];
    for (const href of bereiche) {
      expect(hatSeite(href), `Seite fehlt: ${href}`).toBe(true);
    }

    const quelle = readFileSync(
      join(process.cwd(), 'apps/web/src/server/tickets.ts'),
      'utf8',
    );
    for (const href of bereiche) {
      expect(quelle, `Bereich nicht verlinkt: ${href}`).toContain(`'${href}'`);
    }
  });

  it('liefert Transcripts über eine eigene Route aus', () => {
    // Nie über eine offene Adresse: ein Verlauf enthält alles, was jemand
    // dem Support anvertraut hat.
    expect(existsSync(join(API_DIR, 'tickets/[ticketId]/transcript/route.ts'))).toBe(true);
  });

  it('kann jede Berechtigung vergeben, die es prüft', () => {
    const vergebbar = new Set(definition.permissions.map((eintrag) => eintrag.key));
    for (const schluessel of Object.values(tickets.TICKET_PERMISSIONS)) {
      expect(vergebbar.has(schluessel), `Nicht vergebbar: ${schluessel}`).toBe(true);
    }
  });

  it('kennzeichnet die folgenreichen Berechtigungen als kritisch', () => {
    const kritisch = new Set(
      definition.permissions.filter((eintrag) => eintrag.critical).map((eintrag) => eintrag.key),
    );
    // Wer interne Notizen liest oder Verläufe herunterlädt, sieht mehr als
    // das Ticket selbst zeigt - das soll beim Zuteilen auffallen.
    for (const schluessel of [
      tickets.TICKET_PERMISSIONS.admin,
      tickets.TICKET_PERMISSIONS.notesView,
      tickets.TICKET_PERMISSIONS.transcriptView,
      tickets.TICKET_PERMISSIONS.blockManage,
    ]) {
      expect(kritisch.has(schluessel), `Nicht als kritisch markiert: ${schluessel}`).toBe(true);
    }
  });

  it('lässt keine Ticket-Aktion ohne Zugriffsprüfung durch', () => {
    // Jede Aktion an einem einzelnen Ticket muss durch
    // `ladeTicketMitZugriff` gehen - eine Ticket-ID aus dem Browser ist
    // keine Berechtigung. Der Waechter arbeitet auf dem Quelltext und fängt
    // damit auch eine Aktion ab, die niemand getestet hat.
    const quelle = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/tickets/actions.ts'),
      'utf8',
    );
    const aktionen = [...quelle.matchAll(/^export const (\w+) = defineAction\(\n([\s\S]*?)^\);$/gm)];
    expect(aktionen.length).toBeGreaterThan(5);

    for (const treffer of aktionen) {
      const name = treffer[1] ?? '';
      const rumpf = treffer[2] ?? '';
      if (name === 'createTicketAction') {
        // Beim Anlegen gibt es noch kein Ticket; geprüft wird die Kategorie.
        expect(rumpf).toContain('getCategory');
        continue;
      }
      expect(rumpf, `${name} lädt das Ticket ohne Zugriffsprüfung`).toContain(
        'ladeTicketMitZugriff',
      );
    }
  });

  it('hat für jede Ticket-Seite eine Berechtigungsprüfung', () => {
    const seiten = globSync('apps/web/src/app/(app)/tickets/**/page.tsx', { cwd: process.cwd() });
    expect(seiten.length).toBeGreaterThan(5);
    for (const datei of seiten) {
      const quelle = readFileSync(join(process.cwd(), datei), 'utf8');
      const geschuetzt =
        quelle.includes('requirePagePermission') || quelle.includes('ladeTicketMitZugriff');
      expect(geschuetzt, `Ungeschützte Seite: ${datei}`).toBe(true);
    }
  });
});
