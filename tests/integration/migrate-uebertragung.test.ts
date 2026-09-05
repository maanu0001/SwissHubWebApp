import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_migrate');

/**
 * Eine Übertragung von Anfang bis Ende.
 *
 * Gegen eine echte Datenbank, weil die Zusagen daran hängen: dass ein
 * Probelauf nichts schreibt, dass ein zweiter Anlauf keine Doppel erzeugt,
 * dass die Rücknahme wirklich zurückdreht. Eine Nachbildung von Prisma
 * bestätigte davon nichts.
 */
const { prisma } = await import('@swisshub/database');
const { migration, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const QUELLE = '900000000000000700';
const ZIEL = '900000000000000701';
const ACTOR = { discordId: '100000000000000001', username: 'verwaltung' };

/** Rollen und Kanäle der Ziel-Guild. */
const ZIEL_ROLLEN = [
  { id: '800000000000000010', name: 'Moderator', color: 0, position: 50, managed: false, permissions: '0' },
  { id: '800000000000000011', name: 'Premium', color: 0, position: 20, managed: false, permissions: '0' },
];
const ZIEL_KANAELE = [
  { id: '800000000000000020', name: 'tickets', type: 0, parentId: null, position: 1 },
  { id: '800000000000000021', name: 'moderation-logs', type: 0, parentId: null, position: 2 },
];

/** Dieselben Namen, andere IDs - so sieht ein echter Umzug aus. */
const QUELL_ROLLE_MOD = '700000000000000010';
const QUELL_KANAL_TICKETS = '700000000000000020';

function paket() {
  return {
    schemaVersion: 1 as const,
    createdAt: new Date().toISOString(),
    applicationVersion: '1.0.0',
    sourceGuild: { id: QUELLE, name: 'SwissHub Test' },
    modules: [
      {
        id: 'tickets',
        enabled: true,
        configVersion: 1,
        settings: {
          defaultDiscordCategoryId: QUELL_KANAL_TICKETS,
          defaultSupportRoleIds: [QUELL_ROLLE_MOD],
          maxOpenPerUser: 5,
        },
      },
    ],
    roles: [
      {
        discordRoleId: QUELL_ROLLE_MOD,
        sourceName: 'Moderator',
        label: 'Moderator',
        isProtected: false,
        keepOnJail: false,
        moderationLevel: 50,
        permissions: ['moderation.view', 'tickets.view'],
      },
    ],
    automations: [
      {
        name: 'Willkommen',
        description: null,
        triggerType: 'event',
        triggerConfig: { eventType: 'member.joined' },
        conditions: null,
        steps: [
          {
            art: 'aktion',
            typ: 'nachricht.kanal',
            config: { channelId: QUELL_KANAL_TICKETS, inhalt: 'Hoi' },
            beiFehler: 'ABBRECHEN',
          },
        ],
        concurrency: null,
        concurrencyKey: null,
      },
    ],
    integrations: [{ id: 'discord', label: 'discord', guildScoped: true, konfiguriert: true }],
  };
}

const zuordnung = () => ({
  roles: [
    {
      quelle: QUELL_ROLLE_MOD,
      quellName: 'Moderator',
      art: 'MAP' as const,
      ziel: ZIEL_ROLLEN[0]!.id,
      zielName: 'Moderator',
      vorschlag: true,
    },
  ],
  channels: [
    {
      quelle: QUELL_KANAL_TICKETS,
      quellName: 'tickets',
      art: 'MAP' as const,
      ziel: ZIEL_KANAELE[0]!.id,
      zielName: 'tickets',
      vorschlag: true,
    },
  ],
});

async function legeLaufAn() {
  return migration.legeLaufAn({
    sourceGuildId: QUELLE,
    sourceGuildName: 'SwissHub Test',
    targetGuildId: ZIEL,
    paket: paket(),
    actor: ACTOR,
  });
}

describeWithDatabase('Übertragung auf eine andere Guild', () => {
  beforeAll(async () => {
    pushSchema();
    await setModuleEnabled('migration', true, ACTOR.discordId);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "MigrationRun","RolePermission","ManagedRole","AutomationRun","Automation","ModuleState" ' +
        'RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled('migration', true, ACTOR.discordId);
  });

  // --- Zuordnung ----------------------------------------------------------

  it('schlägt Rollen nach ihrem Namen vor', () => {
    const vorschlaege = migration.schlageRollenVor(paket().roles, ZIEL_ROLLEN as never);

    expect(vorschlaege).toHaveLength(1);
    expect(vorschlaege[0]?.art).toBe('MAP');
    expect(vorschlaege[0]?.ziel).toBe(ZIEL_ROLLEN[0]!.id);
  });

  it('lässt offen, was nicht eindeutig passt', () => {
    // Vermutungen gehören nicht in eine Übertragung, die Rechte verteilt.
    const fremd = [{ ...paket().roles[0]!, sourceName: 'Gibt-es-nicht' }];
    const vorschlaege = migration.schlageRollenVor(fremd, ZIEL_ROLLEN as never);

    expect(vorschlaege[0]?.art).toBe('SKIP');
    expect(vorschlaege[0]?.ziel).toBeNull();
  });

  it('erkennt Kanäle trotz unterschiedlicher Schreibweise', () => {
    const vorschlaege = migration.schlageKanaeleVor(
      [{ id: QUELL_KANAL_TICKETS, name: '#Tickets' }],
      ZIEL_KANAELE as never,
    );

    expect(vorschlaege[0]?.ziel).toBe(ZIEL_KANAELE[0]!.id);
  });

  it('findet die Referenzen eines Moduls über die Registry', () => {
    // Und nicht über eine eigene Liste je Modul: `settingsFields` sagt
    // bereits, welches Feld eine Rolle und welches ein Kanal ist.
    const referenzen = migration.referenzenIn('tickets', paket().modules[0]!.settings);

    expect(referenzen.channels).toContain(QUELL_KANAL_TICKETS);
    expect(referenzen.roles).toContain(QUELL_ROLLE_MOD);
  });

  it('ersetzt Quell-IDs durch Ziel-IDs', () => {
    const { settings, fehlend } = migration.uebersetzeReferenzen(
      'tickets',
      paket().modules[0]!.settings,
      migration.alsTabelle(zuordnung()),
    );

    expect(settings.defaultDiscordCategoryId).toBe(ZIEL_KANAELE[0]!.id);
    expect(settings.defaultSupportRoleIds).toEqual([ZIEL_ROLLEN[0]!.id]);
    expect(fehlend).toHaveLength(0);
  });

  it('leert eine Referenz ohne Zuordnung, statt sie durchzureichen', () => {
    // Eine Rollen-ID aus der Quelle ist im Ziel keine Rolle, sondern eine
    // Zahl, auf die niemand mehr zeigt.
    const { settings, fehlend } = migration.uebersetzeReferenzen('tickets', paket().modules[0]!.settings, {
      roles: {},
      channels: {},
    });

    expect(settings.defaultDiscordCategoryId).toBeNull();
    expect(settings.defaultSupportRoleIds).toEqual([]);
    expect(fehlend.length).toBeGreaterThan(0);
  });

  // --- Probelauf ----------------------------------------------------------

  it('verändert im Probelauf nichts', async () => {
    const lauf = await legeLaufAn();
    await migration.speichereZuordnung(lauf.id, QUELLE, zuordnung(), ACTOR);

    const plan = await migration.berechnePlan(paket(), zuordnung());

    expect(plan.module[0]?.moduleId).toBe('tickets');
    // Nichts geschrieben: keine Rolle, kein Modulzustand, keine Automation.
    expect(await prisma.managedRole.count()).toBe(0);
    expect(await prisma.moduleState.count({ where: { moduleId: 'tickets' } })).toBe(0);
    expect(await prisma.automation.count()).toBe(0);
  });

  it('zeigt an, was sich ändern würde', async () => {
    const plan = await migration.berechnePlan(paket(), zuordnung());

    expect(plan.module[0]?.art).toBe('CREATE');
    expect(plan.rollenRechte[0]?.ziel).toBe(ZIEL_ROLLEN[0]!.id);
    expect(plan.automationen[0]?.name).toBe('Willkommen');
  });

  it('markiert eine Automation mit offenem Verweis als ungültig', async () => {
    // Sie wird trotzdem importiert - ausgeschaltet und mit dem Befund
    // daneben. Sie wegzulassen wäre schlimmer: dann fehlt sie, und niemand
    // weiss davon.
    const plan = await migration.berechnePlan(paket(), { roles: [], channels: [] });

    expect(plan.automationen[0]?.befund).toBe('INVALID');
    expect(plan.automationen[0]?.hinweise.join(' ')).toContain('ohne Zuordnung');
  });

  it('warnt vor offenen Zuordnungen', async () => {
    const offen = {
      roles: [{ ...zuordnung().roles[0]!, art: 'SKIP' as const, ziel: null }],
      channels: zuordnung().channels,
    };
    const plan = await migration.berechnePlan(paket(), offen);

    expect(plan.warnungen.join(' ')).toContain('ohne Zuordnung');
  });

  // --- Anwenden -----------------------------------------------------------

  it('überträgt Berechtigungen auf die Ziel-Rolle', async () => {
    const lauf = await legeLaufAn();
    const ergebnis = await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, {
      gateway: zielGateway(),
    });

    expect(ergebnis.status).toBe('COMPLETED');
    const rolle = await prisma.managedRole.findUnique({
      where: { discordRoleId: ZIEL_ROLLEN[0]!.id },
      include: { permissions: true },
    });
    expect(rolle?.moderationLevel).toBe(50);
    expect(rolle?.permissions.map((eintrag) => eintrag.permission).sort()).toEqual([
      'moderation.view',
      'tickets.view',
    ]);
    // Die Quell-Rollen-ID taucht im Ziel nicht auf.
    expect(await prisma.managedRole.findUnique({ where: { discordRoleId: QUELL_ROLLE_MOD } })).toBeNull();
  });

  it('überträgt Moduleinstellungen mit übersetzten Verweisen', async () => {
    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    const zustand = await prisma.moduleState.findUniqueOrThrow({ where: { moduleId: 'tickets' } });
    const settings = zustand.settings as Record<string, unknown>;
    expect(settings.defaultDiscordCategoryId).toBe(ZIEL_KANAELE[0]!.id);
    expect(settings.defaultSupportRoleIds).toEqual([ZIEL_ROLLEN[0]!.id]);
    expect(zustand.enabled).toBe(true);
  });

  it('importiert Automationen ausgeschaltet', async () => {
    // Eine Automation des Testservers darf nicht nach dem Import sofort auf
    // dem öffentlichen Server handeln.
    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    const automationen = await prisma.automation.findMany();
    expect(automationen).toHaveLength(1);
    expect(automationen[0]?.enabled).toBe(false);
  });

  it('erzeugt beim zweiten Anlauf keine Doppel', async () => {
    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    expect(await prisma.automation.count()).toBe(1);
    expect(await prisma.managedRole.count()).toBe(1);
    // Und die Rechte sammeln sich nicht an.
    expect(await prisma.rolePermission.count()).toBe(2);
  });

  it('sichert den Zustand vor dem Anwenden', async () => {
    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    const danach = await prisma.migrationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(danach.snapshot).not.toBeNull();
  });

  it('lässt bestehende Ziel-Historie unangetastet', async () => {
    // Eine Übertragung schreibt Konfiguration. Sie räumt nicht auf.
    await prisma.automationRun.create({
      data: {
        automationId: (
          await prisma.automation.create({
            data: {
              guildId: ZIEL,
              name: 'Alt',
              triggerType: 'event',
              triggerConfig: {},
              steps: [],
              createdBy: 'x',
            } as never,
          })
        ).id,
        version: 1,
        guildId: ZIEL,
        trigger: 'manual',
        correlationId: 'c1',
        idempotencyKey: 'k1',
        context: {},
      } as never,
    });
    const vorher = await prisma.automationRun.count();

    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    expect(await prisma.automationRun.count()).toBe(vorher);
  });

  // --- Rücknahme ----------------------------------------------------------

  it('dreht die Konfiguration auf den gesicherten Stand zurück', async () => {
    // Vorzustand: das Ticket-Modul steht anders da.
    await setModuleSettings('tickets', { maxOpenPerUser: 1 }, ACTOR.discordId);
    const snapshot = await migration.erstelleSnapshot();

    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    const nachher = await prisma.moduleState.findUniqueOrThrow({ where: { moduleId: 'tickets' } });
    expect((nachher.settings as Record<string, unknown>).maxOpenPerUser).toBe(5);

    await migration.stelleWiederHer(snapshot, ACTOR);

    const zurueck = await prisma.moduleState.findUniqueOrThrow({ where: { moduleId: 'tickets' } });
    expect((zurueck.settings as Record<string, unknown>).maxOpenPerUser).toBe(1);
  });

  it('löscht beim Zurückdrehen keine Rolle, die es vorher nicht gab', async () => {
    // Sie könnte von der Übertragung stammen - oder von einem Menschen, der
    // in der Zwischenzeit gearbeitet hat. Löschen wäre die Vermutung, dass
    // niemand sonst etwas getan hat.
    const snapshot = await migration.erstelleSnapshot();
    const lauf = await legeLaufAn();
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    await migration.stelleWiederHer(snapshot, ACTOR);

    expect(await prisma.managedRole.count()).toBe(1);
  });

  // --- Lauf und Zugriff ---------------------------------------------------

  it('überdauert einen Neustart', async () => {
    // Der Zustand steht in der Datenbank, nicht im Browser.
    const lauf = await legeLaufAn();
    await migration.speichereZuordnung(lauf.id, QUELLE, zuordnung(), ACTOR);

    const wiedergefunden = await migration.holeLauf(lauf.id, QUELLE);
    expect(migration.zuordnungVon(wiedergefunden).roles[0]?.ziel).toBe(ZIEL_ROLLEN[0]!.id);
    expect(migration.paketVon(wiedergefunden).modules).toHaveLength(1);
  });

  it('gibt einen Lauf einer fremden Guild nicht heraus', async () => {
    // Eine Kennung ist keine Berechtigung.
    const lauf = await legeLaufAn();
    await expect(migration.holeLauf(lauf.id, '900000000000009999')).rejects.toThrow();
  });

  it('verwirft den Probelauf, wenn sich die Zuordnung ändert', async () => {
    // Ein falscher Probelauf ist schlimmer als keiner.
    const lauf = await legeLaufAn();
    await migration.speicherePlan(lauf.id, await migration.berechnePlan(paket(), zuordnung()), ACTOR);
    expect(migration.planVon(await migration.holeLauf(lauf.id, QUELLE))).not.toBeNull();

    await migration.speichereZuordnung(lauf.id, QUELLE, zuordnung(), ACTOR);
    expect(migration.planVon(await migration.holeLauf(lauf.id, QUELLE))).toBeNull();
  });

  it('schreibt jeden Schritt ins Prüfprotokoll', async () => {
    const lauf = await legeLaufAn();
    await migration.speichereZuordnung(lauf.id, QUELLE, zuordnung(), ACTOR);
    await migration.wendeAn(lauf.id, paket(), zuordnung(), ACTOR, { gateway: zielGateway() });

    const eintraege = await prisma.auditLog.findMany({ where: { module: 'migration' } });
    const aktionen = eintraege.map((eintrag) => eintrag.action);
    expect(aktionen).toContain('MIGRATION_CREATED');
    expect(aktionen).toContain('MIGRATION_MAPPED');
    expect(aktionen).toContain('MIGRATION_APPLIED');
    // Und nichts Geheimes darin. `metadata` und Beschriftung reichen - die
    // Zeilen tragen sonst noch eine BigInt-Sequenz, die sich nicht
    // serialisieren laesst und hier auch nichts zu suchen hat.
    const inhalt = JSON.stringify(
      eintraege.map((eintrag) => ({ label: eintrag.targetLabel, metadata: eintrag.metadata })),
    );
    expect(inhalt).not.toMatch(/token|secret|apiKey/iu);
  });
});

/** Ein Discord-Zugang, der die Ziel-Guild vorgibt. */
function zielGateway() {
  return {
    guild: { get: vi.fn(async () => ({ id: ZIEL, name: 'SwissHub' })) },
    roles: { list: vi.fn(async () => ZIEL_ROLLEN) },
    channels: { list: vi.fn(async () => ZIEL_KANAELE) },
  } as never;
}
