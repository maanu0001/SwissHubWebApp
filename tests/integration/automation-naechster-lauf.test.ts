import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_automation_termin');

/**
 * «Nächste Ausführung» in der Übersicht.
 *
 * Die Angabe kommt aus den eingeplanten Aufträgen des Zeitplaners und wird
 * nicht neu ausgerechnet. Das ist der ganze Punkt: eine zweite Rechnung wäre
 * eine Vorhersage, der Auftrag ist das, was tatsächlich passieren wird. Ob
 * beides auseinanderläuft, sieht man nur gegen eine echte Datenbank - deshalb
 * hier und nicht als Unit-Test.
 */
const { prisma } = await import('@swisshub/database');
const { legeAn, listeAutomationen } = await import('@swisshub/automation');
// Ohne die Module kennt die Engine kein Ereignis, und `legeAn` prüft die Form
// der Schrittfolge gegen die angemeldeten Bausteine.
await import('@swisshub/modules');

const GILDE = '900000000000004100';
const AKTEUR = { discordId: '100000000000004101', username: 'manu' };

async function automation(name: string, enabled: boolean): Promise<string> {
  const angelegt = await legeAn(
    {
      guildId: GILDE,
      name,
      triggerType: 'event',
      triggerConfig: { event: 'member.joined' },
      conditions: null,
      steps: [],
    },
    AKTEUR,
  );
  if (enabled) {
    await prisma.automation.update({ where: { id: angelegt.id }, data: { enabled: true } });
  }
  return angelegt.id;
}

async function planeAuftrag(
  automationId: string,
  runAt: Date,
  status: 'PENDING' | 'CLAIMED' = 'PENDING',
): Promise<void> {
  await prisma.automationJob.create({
    data: {
      kind: 'SCHEDULE',
      status,
      guildId: GILDE,
      automationId,
      runAt,
      dedupeKey: `test:${automationId}:${runAt.toISOString()}:${status}`,
    },
  });
}

describeWithDatabase('Automationen: nächste Ausführung', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AutomationJob","AutomationRun","AutomationVersion","Automation","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('nennt den eingeplanten Termin', async () => {
    const termin = new Date(Date.now() + 3600_000);
    const id = await automation('Täglicher Bericht', true);
    await planeAuftrag(id, termin);

    const [zeile] = await listeAutomationen(GILDE);
    expect(zeile?.naechsterLauf?.toISOString()).toBe(termin.toISOString());
  });

  it('nennt bei mehreren Aufträgen den frühesten', async () => {
    const id = await automation('Täglicher Bericht', true);
    const frueh = new Date(Date.now() + 3600_000);
    await planeAuftrag(id, new Date(Date.now() + 7200_000));
    await planeAuftrag(id, frueh);

    const [zeile] = await listeAutomationen(GILDE);
    expect(zeile?.naechsterLauf?.toISOString()).toBe(frueh.toISOString());
  });

  it('sagt nichts, wenn nichts eingeplant ist', async () => {
    // Eine ereignisgesteuerte Automation hat keinen Termin - sie wartet auf
    // etwas, nicht auf eine Uhr. Ein erfundener Zeitpunkt wäre schlimmer als
    // gar keiner.
    await automation('Bei Beitritt begrüssen', true);

    const [zeile] = await listeAutomationen(GILDE);
    expect(zeile?.naechsterLauf).toBeNull();
  });

  it('nennt für eine ausgeschaltete Automation keinen Termin', async () => {
    // Ausgeschaltet heisst: sie läuft nicht von selbst. Ein Termin daneben
    // wäre ein Versprechen, das der Schalter gerade bricht - auch wenn der
    // Auftrag von vorher noch in der Datenbank liegt.
    const id = await automation('Täglicher Bericht', false);
    await planeAuftrag(id, new Date(Date.now() + 3600_000));

    const [zeile] = await listeAutomationen(GILDE);
    expect(zeile?.naechsterLauf).toBeNull();
  });

  it('lässt einen bereits übernommenen Auftrag ausser Betracht', async () => {
    // Ein Auftrag, den sich jemand geholt hat (`CLAIMED`), läuft bereits.
    // Ihn als «nächste Ausführung» zu zeigen hiesse, Gegenwart als Zukunft
    // auszugeben.
    const id = await automation('Täglicher Bericht', true);
    await planeAuftrag(id, new Date(Date.now() - 1000), 'CLAIMED');

    const [zeile] = await listeAutomationen(GILDE);
    expect(zeile?.naechsterLauf).toBeNull();
  });

  it('verwechselt die Automationen nicht', async () => {
    const eine = await automation('A', true);
    const andere = await automation('B', true);
    const terminA = new Date(Date.now() + 3600_000);
    const terminB = new Date(Date.now() + 7200_000);
    await planeAuftrag(eine, terminA);
    await planeAuftrag(andere, terminB);

    const zeilen = await listeAutomationen(GILDE);
    const nach = new Map(zeilen.map((zeile) => [zeile.id, zeile.naechsterLauf?.toISOString() ?? null]));
    expect(nach.get(eine)).toBe(terminA.toISOString());
    expect(nach.get(andere)).toBe(terminB.toISOString());
  });

  it('nimmt keinen Termin aus einer fremden Gilde', async () => {
    const id = await automation('Täglicher Bericht', true);
    await prisma.automationJob.create({
      data: {
        kind: 'SCHEDULE',
        status: 'PENDING',
        guildId: '900000000000004199',
        automationId: id,
        runAt: new Date(Date.now() + 3600_000),
        dedupeKey: 'test:fremd',
      },
    });

    const [zeile] = await listeAutomationen(GILDE);
    expect(zeile?.naechsterLauf).toBeNull();
  });

  it('kommt ohne Automationen ohne Abfrage aus', async () => {
    expect(await listeAutomationen(GILDE)).toEqual([]);
  });
});
