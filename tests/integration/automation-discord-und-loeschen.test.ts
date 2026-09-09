import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import { DiscordApiError } from '@swisshub/discord';
import type { DiscordGateway } from '@swisshub/discord';

useTestSchema('test_automation_fgh');

/**
 * Discord-Start und das spätere Löschen - gegen eine echte Datenbank.
 *
 * Beides hängt an Datenbankeigenschaften, die eine Nachbildung nicht hat: die
 * Auswahl der freigegebenen Automationen ist eine Abfrage plus Filter, und
 * der Löschauftrag ist genau deshalb eine Zeile, weil er einen Neustart
 * überleben soll. Ein Test gegen einen Speicherstand würde beides bestätigen,
 * ohne es zu prüfen.
 */
const { prisma } = await import('@swisshub/database');
const { listeDiscordStartbare, planeJob, verarbeiteJobs, beanspruchFaellige } =
  await import('@swisshub/automation');

const GUILD = '900000000000009001';
const TEAM = '900000000000009010';
const FREMD = '900000000000009011';
const KANAL = '900000000000009020';
const NACHRICHT = '900000000000009030';

async function automation(
  name: string,
  optionen: { rollen?: string[]; triggerType?: string; enabled?: boolean; archiviert?: boolean } = {},
) {
  return prisma.automation.create({
    data: {
      guildId: GUILD,
      name,
      triggerType: optionen.triggerType ?? 'discord',
      triggerConfig: { rollen: optionen.rollen ?? [TEAM] },
      steps: [],
      enabled: optionen.enabled ?? true,
      ...(optionen.archiviert ? { archivedAt: new Date() } : {}),
    },
  });
}

/** Ein Gateway, das jede Löschung mitschreibt. */
function gatewayMitProtokoll(fehler?: DiscordApiError) {
  const geloescht: Array<{ channelId: string; messageId: string }> = [];
  const gateway = {
    channels: {
      async delete(channelId: string, messageId: string) {
        if (fehler) {
          throw fehler;
        }
        geloescht.push({ channelId, messageId });
      },
    },
  } as unknown as DiscordGateway;
  return { gateway, geloescht };
}

describeWithDatabase('Automation aus Discord starten', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AutomationJob","AutomationRun","Automation" RESTART IDENTITY CASCADE',
    );
  });

  it('zeigt eine freigegebene Automation', async () => {
    await automation('Ankündigung');

    const startbare = await listeDiscordStartbare(GUILD, [TEAM]);
    expect(startbare.map((eintrag) => eintrag.name)).toEqual(['Ankündigung']);
  });

  it('zeigt sie jemandem ohne die Rolle nicht', async () => {
    await automation('Ankündigung');

    expect(await listeDiscordStartbare(GUILD, [FREMD])).toEqual([]);
  });

  it('zeigt ohne jede Rolle nichts', async () => {
    await automation('Ankündigung');

    expect(await listeDiscordStartbare(GUILD, [])).toEqual([]);
  });

  it('zeigt eine ausgeschaltete Automation nicht', async () => {
    // Sie in der Liste zu führen wäre eine Einladung zu einem Befehl, der
    // nichts tut - und der Grund dafür stünde nirgends.
    await automation('Aus', { enabled: false });

    expect(await listeDiscordStartbare(GUILD, [TEAM])).toEqual([]);
  });

  it('zeigt eine archivierte Automation nicht', async () => {
    await automation('Archiviert', { archiviert: true });

    expect(await listeDiscordStartbare(GUILD, [TEAM])).toEqual([]);
  });

  it('zeigt eine Automation mit anderem Trigger nicht', async () => {
    await automation('Zeitgesteuert', { triggerType: 'schedule' });
    await automation('Von Hand', { triggerType: 'manual' });

    expect(await listeDiscordStartbare(GUILD, [TEAM])).toEqual([]);
  });

  it('zeigt eine Automation ohne freigegebene Rolle niemandem', async () => {
    await automation('Unfertig', { rollen: [] });

    expect(await listeDiscordStartbare(GUILD, [TEAM])).toEqual([]);
  });

  it('zeigt keine Automation eines anderen Servers', async () => {
    await prisma.automation.create({
      data: {
        guildId: '900000000000009999',
        name: 'Fremd',
        triggerType: 'discord',
        triggerConfig: { rollen: [TEAM] },
        steps: [],
        enabled: true,
      },
    });

    expect(await listeDiscordStartbare(GUILD, [TEAM])).toEqual([]);
  });
});

describeWithDatabase('Nachricht später löschen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "AutomationJob" RESTART IDENTITY CASCADE');
  });

  it('löscht die Nachricht, wenn die Frist abgelaufen ist', async () => {
    await planeJob({
      kind: 'DELETE_MESSAGE',
      guildId: GUILD,
      runAt: new Date(Date.now() - 1000),
      payload: { channelId: KANAL, messageId: NACHRICHT },
      dedupeKey: `loeschen:${KANAL}:${NACHRICHT}`,
    });

    const { gateway, geloescht } = gatewayMitProtokoll();
    const ergebnis = await verarbeiteJobs({ gateway });

    expect(ergebnis.bearbeitet).toBe(1);
    expect(ergebnis.gescheitert).toBe(0);
    expect(geloescht).toEqual([{ channelId: KANAL, messageId: NACHRICHT }]);
  });

  it('lässt eine Nachricht vor Ablauf der Frist in Ruhe', async () => {
    await planeJob({
      kind: 'DELETE_MESSAGE',
      guildId: GUILD,
      runAt: new Date(Date.now() + 60_000),
      payload: { channelId: KANAL, messageId: NACHRICHT },
    });

    const { gateway, geloescht } = gatewayMitProtokoll();
    await verarbeiteJobs({ gateway });

    expect(geloescht).toEqual([]);
    expect(await prisma.automationJob.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('überlebt einen Neustart - der Auftrag steht in der Datenbank', async () => {
    /*
     * Der ganze Grund für den Umweg über die Job-Tabelle.
     *
     * Ein `setTimeout` über zwölf Stunden wäre nach dem nächsten Deployment
     * weg, und die Nachricht bliebe stehen - ohne dass irgendwo etwas
     * fehlte, das jemandem auffiele.
     */
    await planeJob({
      kind: 'DELETE_MESSAGE',
      guildId: GUILD,
      runAt: new Date(Date.now() + 50),
      payload: { channelId: KANAL, messageId: NACHRICHT },
    });

    // «Neustart»: kein Zustand im Prozess, nur die Zeile.
    await new Promise((fertig) => setTimeout(fertig, 120));
    const faellig = await beanspruchFaellige(10);

    expect(faellig).toHaveLength(1);
    expect(faellig[0]?.kind).toBe('DELETE_MESSAGE');
  });

  it('wertet eine bereits verschwundene Nachricht als erledigt', async () => {
    // Jemand hat sie von Hand gelöscht. Das Ziel des Auftrags ist erreicht -
    // es als Fehler zu werten hiesse, dreimal zu wiederholen, was schon
    // erledigt ist.
    await planeJob({
      kind: 'DELETE_MESSAGE',
      guildId: GUILD,
      runAt: new Date(Date.now() - 1000),
      payload: { channelId: KANAL, messageId: NACHRICHT },
    });

    const { gateway } = gatewayMitProtokoll(
      new DiscordApiError(404, 10008, '/channels/1/messages/2', 'Unknown Message'),
    );
    const ergebnis = await verarbeiteJobs({ gateway });

    expect(ergebnis.gescheitert).toBe(0);
    expect(ergebnis.bearbeitet).toBe(1);
  });

  it('meldet ein fehlendes Recht als Fehler, statt es zu verschlucken', async () => {
    // Das ist eine Einstellung, die jemand beheben kann - sie gehört an den
    // Auftrag und nicht ins Nichts.
    await planeJob({
      kind: 'DELETE_MESSAGE',
      guildId: GUILD,
      runAt: new Date(Date.now() - 1000),
      payload: { channelId: KANAL, messageId: NACHRICHT },
      maxAttempts: 3,
    });

    const { gateway } = gatewayMitProtokoll(
      new DiscordApiError(403, 50013, '/channels/1/messages/2', 'Missing Permissions'),
    );
    const ergebnis = await verarbeiteJobs({ gateway });

    expect(ergebnis.gescheitert).toBe(1);
    const job = await prisma.automationJob.findFirstOrThrow();
    expect(job.lastError).toContain('Missing Permissions');
  });

  it('legt für dieselbe Nachricht keinen zweiten Auftrag an', async () => {
    const eingabe = {
      kind: 'DELETE_MESSAGE' as const,
      guildId: GUILD,
      runAt: new Date(Date.now() + 60_000),
      payload: { channelId: KANAL, messageId: NACHRICHT },
      dedupeKey: `loeschen:${KANAL}:${NACHRICHT}`,
    };

    const erster = await planeJob(eingabe);
    const zweiter = await planeJob(eingabe);

    expect(erster).not.toBeNull();
    expect(zweiter).toBeNull();
    expect(await prisma.automationJob.count()).toBe(1);
  });

  it('übergeht einen Auftrag ohne Nachricht, ohne zu scheitern', async () => {
    await planeJob({
      kind: 'DELETE_MESSAGE',
      guildId: GUILD,
      runAt: new Date(Date.now() - 1000),
      payload: {},
    });

    const { gateway, geloescht } = gatewayMitProtokoll();
    const ergebnis = await verarbeiteJobs({ gateway });

    expect(ergebnis.gescheitert).toBe(0);
    expect(geloescht).toEqual([]);
  });
});
