import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_tickets');

/**
 * Das Ticketsystem gegen eine echte Datenbank.
 *
 * Geprueft wird, was sich nur hier pruefen laesst: dass zwei gleichzeitige
 * Uebernahmen nur einmal gelingen, dass ein Ticket nach einer
 * fehlgeschlagenen Kanalerstellung sichtbar bleibt statt halb angelegt zu
 * verschwinden - und dass ein normales Mitglied weder fremde Tickets noch
 * interne Notizen sieht.
 */
const { prisma } = await import('@swisshub/database');
const { tickets, setModuleEnabled, syncDiscord, writeModuleSettings } = await import(
  '@swisshub/modules'
);

const GUILD = '100000000000000800';
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const SUPPORT_ROLE = '900000000000000004'; // @Supporter im Mock
const ANDERE_ROLE = '900000000000000006'; // @Jail im Mock
const KATEGORIE_KANAL = '700000000000000010'; // Kategorie "Moderation" im Mock

const actor = (discordId: string, username: string) =>
  ({ discordId, username, source: 'WEBAPP' as const });

/** Ein Betrachter, wie ihn die Zugriffspruefung erwartet. */
const viewer = (discordId: string, roleIds: string[], rechte: string[]) => ({
  discordId,
  roleIds,
  can: (permission: string) => rechte.includes(permission),
});

const P = () => tickets.TICKET_PERMISSIONS;

async function kategorie(name: string, options: { rollen?: string[]; max?: number } = {}) {
  return prisma.ticketCategory.create({
    data: {
      guildId: GUILD,
      name,
      active: true,
      discordCategoryId: KATEGORIE_KANAL,
      supportRoleIds: options.rollen ?? [SUPPORT_ROLE],
      maxOpenPerUser: options.max ?? 0,
    },
  });
}

describeWithDatabase('Tickets', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "TicketAttachment","TicketMessage","TicketEvent","TicketParticipant",' +
        '"TicketTagAssignment","TicketTag","TicketTranscript","TicketFeedback","TicketBlockEntry",' +
        '"TicketTemplate","TicketPanelCategory","TicketPanel","TicketFormField","Ticket",' +
        '"TicketCategory","TicketCounter","ModuleState" RESTART IDENTITY CASCADE',
    );
    await syncDiscord({ trigger: 'manual' });
    await setModuleEnabled(tickets.TICKETS_MODULE_ID, true, ADMIN.discordId);
    await writeModuleSettings(
      tickets.TICKETS_MODULE_ID,
      {
        defaultDiscordCategoryId: KATEGORIE_KANAL,
        overflowDiscordCategoryId: null,
        defaultSupportRoleIds: [SUPPORT_ROLE],
        maxOpenPerUser: 3,
        ticketNumberPrefix: '#',
        channelNameTemplate: 'ticket-{number}-{username}',
        closeBehaviour: 'KEEP_24H',
        autoWaitingStatus: true,
        systemMessagesOnDiscord: true,
        feedbackEnabled: false,
        maintenanceMode: false,
        transcriptRetentionDays: 0,
      },
      ADMIN,
    );
  });

  // --- Erstellung ------------------------------------------------------

  it('legt Ticket und Discord-Kanal an', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD,
      categoryId: k.id,
      subject: 'Mein Anliegen',
      creatorDiscordId: '900000000000001001',
      creatorUsername: 'manuel',
      source: 'WEBAPP',
      actor: actor('900000000000001001', 'manuel'),
    });

    expect(ticket.status).toBe('OPEN');
    expect(ticket.ticketNumber).toBe(1);
    expect(ticket.discordChannelId).not.toBeNull();
  });

  it('achtet auf die Grenze offener Tickets', async () => {
    const k = await kategorie('Allgemein', { max: 1 });
    await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Erstes',
      creatorDiscordId: '900000000000001002', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001002', 'nina'),
    });

    await expect(
      tickets.createTicket({
        guildId: GUILD, categoryId: k.id, subject: 'Zweites',
        creatorDiscordId: '900000000000001002', creatorUsername: 'nina',
        source: 'WEBAPP', actor: actor('900000000000001002', 'nina'),
      }),
    ).rejects.toThrow(/offene Tickets/u);
  });

  it('weist gesperrte Mitglieder ab', async () => {
    const k = await kategorie('Allgemein');
    await prisma.ticketBlockEntry.create({
      data: { guildId: GUILD, discordId: '900000000000001003', reason: 'Missbrauch',
        blockedByDiscordId: ADMIN.discordId },
    });

    await expect(
      tickets.createTicket({
        guildId: GUILD, categoryId: k.id, subject: 'Test',
        creatorDiscordId: '900000000000001003', creatorUsername: 'gesperrt',
        source: 'WEBAPP', actor: actor('900000000000001003', 'gesperrt'),
      }),
    ).rejects.toThrow(/keine Tickets eröffnen/u);
  });

  it('nimmt im Wartungsmodus keine neuen Tickets an', async () => {
    const k = await kategorie('Allgemein');
    const bisher = await import('@swisshub/modules').then((m) =>
      m.getModuleSettings(tickets.TICKETS_MODULE_ID),
    );
    await writeModuleSettings(
      tickets.TICKETS_MODULE_ID,
      { ...(bisher as object), maintenanceMode: true },
      ADMIN,
    );

    await expect(
      tickets.createTicket({
        guildId: GUILD, categoryId: k.id, subject: 'Test',
        creatorDiscordId: '900000000000001004', creatorUsername: 'jemand',
        source: 'WEBAPP', actor: actor('900000000000001004', 'jemand'),
      }),
    ).rejects.toThrow(/keine neuen Tickets/u);
  });

  // --- Uebernahme ------------------------------------------------------

  it('lässt nur eine von zehn gleichzeitigen Übernahmen gelingen', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Wer zuerst kommt',
      creatorDiscordId: '900000000000001005', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001005', 'manuel'),
    });

    const ergebnisse = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        tickets.claimTicket(ticket.id, actor(`90000000000000200${i}`, `supporter${i}`)),
      ),
    );

    expect(ergebnisse.filter(Boolean)).toHaveLength(1);
    const nachher = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(nachher.assignedToDiscordId).not.toBeNull();
    expect(nachher.status).toBe('IN_PROGRESS');
  });

  // --- Zugriff ---------------------------------------------------------

  it('zeigt einem fremden Mitglied nichts', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Privat',
      creatorDiscordId: '900000000000001006', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001006', 'manuel'),
    });

    const zugriff = await tickets.getTicketAccess(
      viewer('900000000000009999', [], [P().viewOwn, P().create]),
      ticket,
    );
    expect(zugriff.view).toBe(false);
    expect(zugriff.reply).toBe(false);
    expect(zugriff.notes).toBe(false);
  });

  it('lässt den Ersteller sein Ticket sehen, aber keine internen Notizen', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Meins',
      creatorDiscordId: '900000000000001007', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001007', 'manuel'),
    });

    // Auch mit der Notiz-Berechtigung: der Ersteller ist kein Support.
    const zugriff = await tickets.getTicketAccess(
      viewer('900000000000001007', [], [P().viewOwn, P().notesView]),
      ticket,
    );
    expect(zugriff.view).toBe(true);
    expect(zugriff.reply).toBe(true);
    expect(zugriff.notes).toBe(false);
    expect(zugriff.asStaff).toBe(false);
  });

  it('verwehrt einem Supporter fremde Kategorien', async () => {
    const moderation = await kategorie('Moderation', { rollen: [ANDERE_ROLE] });
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: moderation.id, subject: 'Meldung',
      creatorDiscordId: '900000000000001008', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001008', 'manuel'),
    });

    // Trägt die allgemeine Support-Rolle, aber nicht die der Kategorie.
    const zugriff = await tickets.getTicketAccess(
      viewer('900000000000002100', [SUPPORT_ROLE], [P().supportView, P().notesView]),
      ticket,
    );
    expect(zugriff.view).toBe(false);
  });

  it('lässt den zuständigen Supporter arbeiten', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Hilfe',
      creatorDiscordId: '900000000000001009', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001009', 'manuel'),
    });

    const zugriff = await tickets.getTicketAccess(
      viewer('900000000000002101', [SUPPORT_ROLE], [
        P().supportView, P().supportReply, P().supportClose, P().notesView,
      ]),
      ticket,
    );
    expect(zugriff.view).toBe(true);
    expect(zugriff.reply).toBe(true);
    expect(zugriff.notes).toBe(true);
    expect(zugriff.asStaff).toBe(true);
  });

  it('beschränkt die Sichtbarkeitsbedingung auf zuständige Kategorien', async () => {
    const allgemein = await kategorie('Allgemein');
    await kategorie('Moderation', { rollen: [ANDERE_ROLE] });

    const filter = await tickets.ticketSichtbarkeitsFilter(
      viewer('900000000000002102', [SUPPORT_ROLE], [P().supportView, P().viewOwn]),
    );

    const oder = (filter as { OR?: Array<Record<string, unknown>> }).OR ?? [];
    const kategorienBedingung = oder.find((eintrag) => 'categoryId' in eintrag) as
      | { categoryId: { in: string[] } }
      | undefined;
    expect(kategorienBedingung?.categoryId.in).toEqual([allgemein.id]);
  });

  // --- Nachrichten -----------------------------------------------------

  it('hält interne Notizen aus der Mitgliederansicht heraus', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Frage',
      creatorDiscordId: '900000000000001010', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001010', 'manuel'),
    });

    await tickets.sendMessage(ticket.id, 'Wir schauen das an.', {
      discordId: '900000000000002103', username: 'supporter', isStaff: true,
    });
    await tickets.addInternalNote(ticket.id, 'Stammkunde, kulant sein.', {
      discordId: '900000000000002103', username: 'supporter', isStaff: true,
    });

    expect(await tickets.listMessages(ticket.id, false)).toHaveLength(1);
    expect(await tickets.listMessages(ticket.id, true)).toHaveLength(2);
  });

  it('merkt sich die erste Support-Antwort', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Frage',
      creatorDiscordId: '900000000000001011', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001011', 'manuel'),
    });

    // Eine interne Notiz ist keine Antwort - das Mitglied sieht sie nie.
    await tickets.addInternalNote(ticket.id, 'Notiz', {
      discordId: '900000000000002104', username: 'supporter', isStaff: true,
    });
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).firstStaffResponseAt,
    ).toBeNull();

    await tickets.sendMessage(ticket.id, 'Hallo!', {
      discordId: '900000000000002104', username: 'supporter', isStaff: true,
    });
    const nachher = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(nachher.firstStaffResponseAt).not.toBeNull();
    expect(nachher.status).toBe('WAITING_FOR_USER');
  });

  it('weist zu lange Nachrichten ab, statt sie zu kürzen', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Frage',
      creatorDiscordId: '900000000000001012', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001012', 'manuel'),
    });

    await expect(
      tickets.sendMessage(ticket.id, 'x'.repeat(2500), {
        discordId: '900000000000002105', username: 'supporter', isStaff: true,
      }),
    ).rejects.toThrow(/zu lang/u);
  });

  it('übernimmt dieselbe Discord-Nachricht nur einmal', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Frage',
      creatorDiscordId: '900000000000001013', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001013', 'manuel'),
    });

    const eingang = {
      ticketId: ticket.id,
      discordMessageId: '123456789012345678',
      content: 'Hallo aus Discord',
      author: { discordId: '900000000000001013', username: 'manuel', isStaff: false },
    };
    await tickets.syncDiscordMessage(eingang);
    await tickets.syncDiscordMessage(eingang);

    expect(await prisma.ticketMessage.count({ where: { ticketId: ticket.id } })).toBe(1);
  });

  // --- Schliessen ------------------------------------------------------

  it('schliesst und behält den Kanal für die Aufbewahrungsfrist', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Erledigt',
      creatorDiscordId: '900000000000001014', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001014', 'manuel'),
    });

    const geschlossen = await tickets.closeTicket(ticket.id, 'Problem gelöst', ADMIN_ACTOR);
    expect(geschlossen.status).toBe('CLOSED');
    expect(geschlossen.closeReason).toBe('Problem gelöst');
    // Nicht sofort weg - sonst könnte niemand mehr nachlesen.
    expect(geschlossen.discordChannelId).not.toBeNull();
    expect(geschlossen.channelPurgeAt).not.toBeNull();
  });

  it('öffnet ein geschlossenes Ticket wieder', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Doch nicht',
      creatorDiscordId: '900000000000001015', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001015', 'manuel'),
    });
    await tickets.closeTicket(ticket.id, null, ADMIN_ACTOR);

    const geoeffnet = await tickets.reopenTicket(ticket.id, ADMIN_ACTOR);
    expect(geoeffnet.status).toBe('OPEN');
    expect(geoeffnet.closedAt).toBeNull();
    expect(geoeffnet.channelPurgeAt).toBeNull();
  });

  it('behält das Ticket, wenn der Discord-Kanal verschwindet', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      guildId: GUILD, categoryId: k.id, subject: 'Verwaist',
      creatorDiscordId: '900000000000001016', creatorUsername: 'manuel',
      source: 'WEBAPP', actor: actor('900000000000001016', 'manuel'),
    });

    // Jemand löscht den Kanal von Hand.
    const { discord } = await import('@swisshub/discord');
    await discord.managedChannels.remove(ticket.discordChannelId!);

    const { fehlend } = await tickets.reconcileChannels();
    expect(fehlend).toBe(1);

    const nachher = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(nachher.channelMissing).toBe(true);
    expect(nachher.subject).toBe('Verwaist');
  });

  // --- Kanalnamen ------------------------------------------------------

  it('macht aus Benutzernamen einen zulässigen Kanalnamen', () => {
    // Umlaute ausgeschrieben statt weggeworfen - Discord kennt sie nicht,
    // aber "sss" wäre unbrauchbar.
    expect(tickets.buildChannelName('ticket-{number}-{username}', { number: 42, username: 'Manuel Süß' }))
      .toBe('ticket-0042-manuel-suess');
    expect(tickets.buildChannelName('ticket-{number}-{username}', { number: 8, username: 'Émile Ökonom' }))
      .toBe('ticket-0008-emile-oekonom');
    // Bleibt nichts Verwertbares übrig, trägt der Kanal wenigstens die Nummer.
    expect(tickets.buildChannelName('ticket-{number}', { number: 7, username: '???' }))
      .toBe('ticket-0007');
    expect(tickets.buildChannelName('{username}', { number: 9, username: '中文' }))
      .toBe('ticket-9');
  });
});

const ADMIN_ACTOR = { discordId: ADMIN.discordId, username: ADMIN.username, source: 'WEBAPP' as const };
