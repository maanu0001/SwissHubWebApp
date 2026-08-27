import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_tickets');

// Ohne eigenes Verzeichnis landen die Transcripts unter dem Vorgabepfad
// `/var/lib/swisshub/uploads`. Als root ging das durch, auf einem Rechner
// ohne Schreibrecht dort nicht - eine Pruefung, deren Ausgang vom Benutzer
// abhaengt, prueft nichts Verlaessliches.
process.env.SWISSHUB_UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'swisshub-tickets-'));

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

/**
 * Der verbundene Server.
 *
 * Wird beim Start aufgeloest statt festgeschrieben: `createTicket` loest ihn
 * seit jeher selbst auf, und eine zweite, abweichende Kennung im Test hat
 * genau die Verwechslung nachgestellt, die es in der Anwendung nicht mehr
 * gibt.
 */
let GUILD = '';
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
    const { resolveGuildId, clearGuildIdCache } = await import('@swisshub/discord');
    clearGuildIdCache();
    GUILD = await resolveGuildId();
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
      categoryId: k.id, subject: 'Erstes',
      creatorDiscordId: '900000000000001002', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001002', 'nina'),
    });

    await expect(
      tickets.createTicket({
      categoryId: k.id, subject: 'Zweites',
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
      categoryId: k.id, subject: 'Test',
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
      categoryId: k.id, subject: 'Test',
        creatorDiscordId: '900000000000001004', creatorUsername: 'jemand',
        source: 'WEBAPP', actor: actor('900000000000001004', 'jemand'),
      }),
    ).rejects.toThrow(/keine neuen Tickets/u);
  });

  // --- Uebernahme ------------------------------------------------------

  it('lässt nur eine von zehn gleichzeitigen Übernahmen gelingen', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Wer zuerst kommt',
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
      categoryId: k.id, subject: 'Privat',
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
      categoryId: k.id, subject: 'Meins',
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
      categoryId: moderation.id, subject: 'Meldung',
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
      categoryId: k.id, subject: 'Hilfe',
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
      categoryId: k.id, subject: 'Frage',
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
      categoryId: k.id, subject: 'Frage',
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
      categoryId: k.id, subject: 'Frage',
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
      categoryId: k.id, subject: 'Frage',
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
      categoryId: k.id, subject: 'Erledigt',
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
      categoryId: k.id, subject: 'Doch nicht',
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
      categoryId: k.id, subject: 'Verwaist',
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


  // --- Transcripts -----------------------------------------------------

  it('hält interne Notizen aus der Nutzerfassung des Transcripts heraus', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Verlauf',
      creatorDiscordId: '900000000000001601', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001601', 'nina'),
    });

    await tickets.sendMessage(ticket.id, 'Mein Problem', {
      discordId: '900000000000001601', username: 'nina', isStaff: false,
    });
    await tickets.addInternalNote(ticket.id, 'Wiederholungstäter, bitte vorsichtig', {
      discordId: ADMIN.discordId, username: ADMIN.username, isStaff: true,
    });

    const fuerMitglied = await tickets.renderTranscript(ticket.id, 'USER');
    const fuerTeam = await tickets.renderTranscript(ticket.id, 'STAFF');

    expect(fuerMitglied.html).toContain('Mein Problem');
    // Der Text der Notiz darf in der Nutzerfassung nirgends stehen - auch
    // nicht in einem ausgeblendeten Abschnitt.
    expect(fuerMitglied.html).not.toContain('Wiederholungstäter');
    expect(fuerMitglied.messageCount).toBe(1);

    expect(fuerTeam.html).toContain('Wiederholungstäter');
    expect(fuerTeam.messageCount).toBe(2);
  });

  it('macht aus Nachrichteninhalt kein HTML', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: '<img src=x onerror=alert(1)>',
      creatorDiscordId: '900000000000001602', creatorUsername: 'mallory',
      source: 'WEBAPP', actor: actor('900000000000001602', 'mallory'),
    });
    await tickets.sendMessage(ticket.id, '<script>alert("hi")</script>', {
      discordId: '900000000000001602', username: 'mallory', isStaff: false,
    });

    const verlauf = await tickets.renderTranscript(ticket.id, 'USER');
    // Geprüft wird die spitze Klammer, nicht der Wortlaut: `onerror=` steht
    // als harmloser Text im Dokument, sobald das `<` entschärft ist - und
    // genau darauf kommt es an.
    expect(verlauf.html).not.toContain('<script');
    expect(verlauf.html).not.toContain('<img');
    expect(verlauf.html).toContain('&lt;script&gt;');
    expect(verlauf.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('legt beim Schliessen beide Fassungen ab', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Wird geschlossen',
      creatorDiscordId: '900000000000001603', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001603', 'nina'),
    });
    await tickets.closeTicket(ticket.id, 'erledigt', ADMIN_ACTOR);

    const abgelegt = await prisma.ticketTranscript.findMany({ where: { ticketId: ticket.id } });
    expect(abgelegt.map((eintrag) => eintrag.audience).sort()).toEqual(['STAFF', 'USER']);

    // Und das Ausliefern kommt auch ohne die Datei aus: der Verlauf steht in
    // der Datenbank, die Datei ist nur ein Zwischenspeicher.
    await prisma.ticketTranscript.updateMany({
      where: { ticketId: ticket.id },
      data: { fileName: 'transcript-00000000000000000000000000000000.html' },
    });
    const geladen = await tickets.loadTranscript(ticket.id, 'USER');
    expect(geladen.html).toContain('Wird geschlossen');
  });

  it('behaelt den Verlauf, wenn sich die Datei nicht ablegen laesst', async () => {
    // Der Datensatz ist die Auskunft, die Datei nur die Abkuerzung. Lagen
    // beide in einem Versuch, liess ein volles oder nur lesbar eingehaengtes
    // Upload-Verzeichnis das Ticket ohne jeden Transcript zurueck.
    //
    // Nachgestellt mit ENOTDIR - ein Verzeichnispfad unterhalb einer Datei
    // scheitert fuer jeden Benutzer, auch fuer root.
    const blocker = join(await mkdtemp(join(tmpdir(), 'swisshub-blocker-')), 'datei');
    await writeFile(blocker, 'keine Datei-Ablage');

    const vorher = process.env.SWISSHUB_UPLOAD_DIR;
    process.env.SWISSHUB_UPLOAD_DIR = join(blocker, 'uploads');
    // Das Modul liest den Pfad beim Laden - deshalb frisch importieren.
    vi.resetModules();
    const abgeschottet = (await import('@swisshub/modules')).tickets;

    const k = await kategorie('Allgemein');
    const ticket = await abgeschottet.createTicket({
      categoryId: k.id, subject: 'Ohne Ablage',
      creatorDiscordId: '900000000000001605', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001605', 'nina'),
    });
    await abgeschottet.closeTicket(ticket.id, 'erledigt', ADMIN_ACTOR);

    const abgelegt = await prisma.ticketTranscript.findMany({ where: { ticketId: ticket.id } });
    expect(abgelegt.map((eintrag) => eintrag.audience).sort()).toEqual(['STAFF', 'USER']);

    // Und ausliefern laesst er sich auch: ohne Datei wird er aus der
    // Datenbank neu erzeugt.
    const geladen = await abgeschottet.loadTranscript(ticket.id, 'USER');
    expect(geladen.html).toContain('Ohne Ablage');

    process.env.SWISSHUB_UPLOAD_DIR = vorher;
    vi.resetModules();
  });

  it('entfernt Transcripts erst nach der eingestellten Frist', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Alt',
      creatorDiscordId: '900000000000001604', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001604', 'nina'),
    });
    await tickets.closeTicket(ticket.id, null, ADMIN_ACTOR);
    await prisma.ticketTranscript.updateMany({
      where: { ticketId: ticket.id },
      data: { createdAt: new Date(Date.now() - 40 * 24 * 3600_000) },
    });

    // Ohne ausdrückliche Frist geschieht nichts - eine stillschweigende
    // Voreinstellung, die Daten löscht, wäre die falsche.
    expect(await tickets.purgeExpiredTranscripts(0)).toBe(0);
    expect(await prisma.ticketTranscript.count({ where: { ticketId: ticket.id } })).toBe(2);

    expect(await tickets.purgeExpiredTranscripts(30)).toBe(2);
    expect(await prisma.ticketTranscript.count({ where: { ticketId: ticket.id } })).toBe(0);
    // Der Verlauf selbst bleibt.
    expect(await prisma.ticket.count({ where: { id: ticket.id } })).toBe(1);
  });

  // --- Zeitsteuerung ---------------------------------------------------

  it('erinnert nur einmal je Frist und nur bei Warten auf das Mitglied', async () => {
    const k = await prisma.ticketCategory.create({
      data: {
        guildId: GUILD, name: 'Mit Erinnerung', active: true,
        discordCategoryId: KATEGORIE_KANAL, supportRoleIds: [SUPPORT_ROLE],
        reminderAfterDays: 3,
      },
    });
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Wartet',
      creatorDiscordId: '900000000000001701', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001701', 'nina'),
    });

    const langeHer = new Date(Date.now() - 10 * 24 * 3600_000);
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'WAITING_FOR_STAFF', lastMessageAt: langeHer },
    });
    // Wartet das Ticket auf den Support, ist das nicht das Problem des
    // Mitglieds - dort zu mahnen wäre die falsche Richtung.
    expect((await tickets.runTicketReminders()).erinnert).toBe(0);

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'WAITING_FOR_USER', lastMessageAt: langeHer },
    });
    expect((await tickets.runTicketReminders()).erinnert).toBe(1);
    // Der zweite Durchgang schweigt: sonst würde aus der Erinnerung eine
    // stündliche Mahnung.
    expect((await tickets.runTicketReminders()).erinnert).toBe(0);
  });

  it('schliesst selbsttätig nur, was auf das Mitglied wartet', async () => {
    const ohne = await kategorie('Ohne Frist');
    const mit = await prisma.ticketCategory.create({
      data: {
        guildId: GUILD, name: 'Mit Frist', active: true,
        discordCategoryId: KATEGORIE_KANAL, supportRoleIds: [SUPPORT_ROLE],
        autoCloseAfterDays: 7,
      },
    });

    const langeHer = new Date(Date.now() - 30 * 24 * 3600_000);
    const anlegen = async (categoryId: string, status: 'WAITING_FOR_USER' | 'WAITING_FOR_STAFF', wer: string) => {
      const ticket = await tickets.createTicket({
        categoryId, subject: `Alt ${wer}`,
        creatorDiscordId: wer, creatorUsername: 'nina',
        source: 'WEBAPP', actor: actor(wer, 'nina'),
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status, lastMessageAt: langeHer },
      });
      return ticket.id;
    };

    const wartetAufMitglied = await anlegen(mit.id, 'WAITING_FOR_USER', '900000000000001801');
    const wartetAufSupport = await anlegen(mit.id, 'WAITING_FOR_STAFF', '900000000000001802');
    const ohneFrist = await anlegen(ohne.id, 'WAITING_FOR_USER', '900000000000001803');

    expect((await tickets.runTicketAutoClose()).geschlossen).toBe(1);

    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: wartetAufMitglied } })).status).toBe('CLOSED');
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: wartetAufSupport } })).status).toBe('WAITING_FOR_STAFF');
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ohneFrist } })).status).toBe('WAITING_FOR_USER');
  });

  // --- Kategorien ------------------------------------------------------

  it('lässt eine Kategorie mit Tickets nicht entfernen', async () => {
    const k = await kategorie('Allgemein');
    await tickets.createTicket({
      categoryId: k.id, subject: 'Hängt dran',
      creatorDiscordId: '900000000000001901', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000001901', 'nina'),
    });

    // Sonst verlöre das Archiv die Zuordnung - und mit ihr die Grundlage,
    // auf der die Sichtbarkeit entschieden wird.
    await expect(tickets.deleteCategory(k.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    await prisma.ticket.deleteMany({ where: { categoryId: k.id } });
    await expect(tickets.deleteCategory(k.id)).resolves.toBeUndefined();
  });

  it('lässt nicht mehr Fragen zu, als ein Discord-Modal fasst', async () => {
    const feld = (label: string) => ({
      kind: 'SHORT_TEXT' as const, label, placeholder: null,
      required: false, minLength: null, maxLength: null,
    });
    const basis = {
      name: 'Zu viele Fragen', description: null, emoji: null, active: true, sortOrder: 0,
      discordCategoryId: KATEGORIE_KANAL, overflowCategoryId: null,
      supportRoleIds: [SUPPORT_ROLE], pingSupport: false,
      defaultPriority: 'NORMAL' as const,
      channelNameTemplate: 'ticket-{number}', welcomeMessage: null, closeMessage: null,
      maxOpenPerUser: 0, userCanClose: true,
      reminderAfterDays: 0, autoCloseAfterDays: 0,
      responseTargetHours: 0, resolutionTargetHours: 0, sensitive: false,
    };

    await expect(
      tickets.createCategory({
        ...basis,
        formFields: ['a', 'b', 'c', 'd', 'e'].map(feld),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Vier gehen - das fünfte Feld im Modal ist der Betreff.
    const angelegt = await tickets.createCategory({
      ...basis,
      formFields: ['a', 'b', 'c', 'd'].map(feld),
    });
    expect(await prisma.ticketFormField.count({ where: { categoryId: angelegt.id } })).toBe(4);
  });


  // --- Schlagwörter, Vorlagen, Sperren, Rückmeldung --------------------

  it('vermerkt jedes gesetzte und entfernte Schlagwort im Verlauf', async () => {
    const k = await kategorie('Allgemein');
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Mit Schlagwort',
      creatorDiscordId: '900000000000002001', creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor('900000000000002001', 'nina'),
    });

    const eins = await tickets.createTag('Rückfrage offen', '#83060a');
    const zwei = await tickets.createTag('Wiederkehrend', null);

    await tickets.setTicketTags(ticket.id, [eins.id, zwei.id], ADMIN_ACTOR);
    expect(await prisma.ticketTagAssignment.count({ where: { ticketId: ticket.id } })).toBe(2);

    await tickets.setTicketTags(ticket.id, [zwei.id], ADMIN_ACTOR);
    expect(await prisma.ticketTagAssignment.count({ where: { ticketId: ticket.id } })).toBe(1);

    const ereignisse = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id, kind: { in: ['TAG_ADDED', 'TAG_REMOVED'] } },
    });
    // Zwei gesetzt, eines entfernt - jede Änderung steht im Verlauf.
    expect(ereignisse.filter((eintrag) => eintrag.kind === 'TAG_ADDED')).toHaveLength(2);
    expect(ereignisse.filter((eintrag) => eintrag.kind === 'TAG_REMOVED')).toHaveLength(1);
  });

  it('weist ein doppeltes Schlagwort ab', async () => {
    await tickets.createTag('Dringend', null);
    await expect(tickets.createTag('  Dringend  ', null)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('liefert allgemeine und passende Vorlagen, aber keine fremden', async () => {
    const eine = await kategorie('Allgemein');
    const andere = await kategorie('Bewerbung');

    await tickets.createTemplate({ title: 'Gruss', content: 'Hallo!', categoryId: null });
    await tickets.createTemplate({ title: 'Nur hier', content: 'Text', categoryId: eine.id });
    await tickets.createTemplate({ title: 'Nur dort', content: 'Text', categoryId: andere.id });

    const fuerEine = await tickets.listTemplates(eine.id);
    expect(fuerEine.map((vorlage) => vorlage.title).sort()).toEqual(['Gruss', 'Nur hier']);
  });

  it('sperrt für neue Tickets, lässt bestehende aber laufen', async () => {
    const k = await kategorie('Allgemein');
    const wer = '900000000000002101';

    const laufend = await tickets.createTicket({
      categoryId: k.id, subject: 'Vor der Sperre',
      creatorDiscordId: wer, creatorUsername: 'mallory',
      source: 'WEBAPP', actor: actor(wer, 'mallory'),
    });

    await tickets.blockMember(
      { discordId: wer, username: 'mallory', reason: 'Missbrauch', expiresAt: null },
      ADMIN_ACTOR,
    );

    await expect(
      tickets.createTicket({
      categoryId: k.id, subject: 'Nach der Sperre',
        creatorDiscordId: wer, creatorUsername: 'mallory',
        source: 'WEBAPP', actor: actor(wer, 'mallory'),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Das laufende Ticket bleibt bearbeitbar - eine Sperre schneidet
    // niemanden mitten im Gespräch ab.
    await expect(
      tickets.sendMessage(laufend.id, 'Noch eine Frage', {
        discordId: wer, username: 'mallory', isStaff: false,
      }),
    ).resolves.toBeDefined();

    // Und eine zweite Sperre daneben gibt es nicht.
    await expect(
      tickets.blockMember(
        { discordId: wer, username: 'mallory', reason: 'nochmal', expiresAt: null },
        ADMIN_ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('hebt eine Sperre auf und lässt danach wieder eröffnen', async () => {
    const k = await kategorie('Allgemein');
    const wer = '900000000000002102';
    const sperre = await tickets.blockMember(
      { discordId: wer, username: 'nina', reason: 'Versehen', expiresAt: null },
      ADMIN_ACTOR,
    );
    await tickets.liftBlock(sperre.id);

    await expect(
      tickets.createTicket({
      categoryId: k.id, subject: 'Wieder erlaubt',
        creatorDiscordId: wer, creatorUsername: 'nina',
        source: 'WEBAPP', actor: actor(wer, 'nina'),
      }),
    ).resolves.toBeDefined();
  });

  it('nimmt eine Bewertung nur vom Ersteller, nur einmal, nur nach dem Abschluss', async () => {
    const k = await kategorie('Allgemein');
    const wer = '900000000000002201';
    const ticket = await tickets.createTicket({
      categoryId: k.id, subject: 'Zu bewerten',
      creatorDiscordId: wer, creatorUsername: 'nina',
      source: 'WEBAPP', actor: actor(wer, 'nina'),
    });

    // Noch offen.
    await expect(
      tickets.recordFeedback({ ticketId: ticket.id, discordId: wer, rating: 5 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await tickets.closeTicket(ticket.id, null, ADMIN_ACTOR);

    // Jemand anderes.
    await expect(
      tickets.recordFeedback({ ticketId: ticket.id, discordId: ADMIN.discordId, rating: 5 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Unmöglicher Wert.
    await expect(
      tickets.recordFeedback({ ticketId: ticket.id, discordId: wer, rating: 6 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await tickets.recordFeedback({ ticketId: ticket.id, discordId: wer, rating: 4, comment: 'Danke' });
    expect((await tickets.getFeedback(ticket.id))?.rating).toBe(4);

    // Und kein zweites Mal - sonst liesse sich der Schnitt beliebig ziehen.
    await expect(
      tickets.recordFeedback({ ticketId: ticket.id, discordId: wer, rating: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
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
