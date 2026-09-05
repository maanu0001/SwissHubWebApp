import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_ticket_abschluss');

process.env.SWISSHUB_UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'swisshub-abschluss-'));

/**
 * Was beim Schliessen und beim Antworten tatsächlich geschieht.
 *
 * Drei Zusagen, die sich nur gegen eine echte Datenbank und einen
 * mitschreibenden Discord-Zugang prüfen lassen: dass der Abschluss steht,
 * bevor irgendetwas auf Discord passiert; dass der Kanal danach verschwindet;
 * und dass eine Antwort des Teams den Ersteller tatsächlich erreicht - also
 * ausserhalb des Embeds erwähnt wird, wo Discord eine Benachrichtigung
 * auslöst.
 */
const { prisma } = await import('@swisshub/database');
const { tickets, setModuleEnabled, syncDiscord, writeModuleSettings } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway, resolveGuildId, clearGuildIdCache } =
  await import('@swisshub/discord');

let GUILD = '';
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const SUPPORT_ROLE = '900000000000000004';
const KATEGORIE_KANAL = '700000000000000010';

const ERSTELLER = '900000000000002001';
const SUPPORTER = '900000000000002002';

const actor = (discordId: string, username: string) => ({ discordId, username, source: 'WEBAPP' as const });

/**
 * Ein Discord-Zugang, der mitschreibt.
 *
 * Nur die beiden Aufrufe, um die es hier geht, werden abgefangen - alles
 * andere bleibt der Mock, damit der Ablauf echt bleibt.
 */
function mitschrift() {
  const echt = createMockGateway();
  const gesendet: Array<{ channelId: string; payload: Record<string, unknown> }> = [];
  const geloescht: string[] = [];

  const gateway = {
    ...echt,
    channels: {
      ...echt.channels,
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        gesendet.push({ channelId, payload });
        return echt.channels.send(channelId, payload as never);
      }),
    },
    managedChannels: {
      ...echt.managedChannels,
      remove: vi.fn(async (channelId: string, grund?: string) => {
        geloescht.push(channelId);
        return echt.managedChannels.remove(channelId, grund);
      }),
    },
  };
  return { gateway, gesendet, geloescht };
}

let discord: ReturnType<typeof mitschrift>;

async function kategorie() {
  return prisma.ticketCategory.create({
    data: {
      guildId: GUILD,
      name: 'Allgemein',
      active: true,
      discordCategoryId: KATEGORIE_KANAL,
      supportRoleIds: [SUPPORT_ROLE],
      maxOpenPerUser: 0,
    },
  });
}

async function ticket() {
  const k = await kategorie();
  return tickets.createTicket({
    categoryId: k.id,
    subject: 'Mein Anliegen',
    creatorDiscordId: ERSTELLER,
    creatorUsername: 'manuel',
    source: 'WEBAPP',
    actor: actor(ERSTELLER, 'manuel'),
  });
}

/** Der Betrachter, wie ihn die Zugriffsprüfung erwartet. */
const viewer = (discordId: string, roleIds: string[], rechte: string[]) => ({
  discordId,
  roleIds,
  can: (permission: string) => rechte.includes(permission),
});

describeWithDatabase('Ticket schliessen und antworten', () => {
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
    discord = mitschrift();
    setDiscordGateway(discord.gateway as never);
    await syncDiscord({ trigger: 'manual' });
    clearGuildIdCache();
    GUILD = await resolveGuildId();
    await setModuleEnabled(tickets.TICKETS_MODULE_ID, true, ADMIN.discordId);
    await writeModuleSettings(
      tickets.TICKETS_MODULE_ID,
      {
        defaultDiscordCategoryId: KATEGORIE_KANAL,
        defaultSupportRoleIds: [SUPPORT_ROLE],
        maxOpenPerUser: 3,
        // Der Fall, um den es geht: der Kanal verschwindet kurz nach dem
        // Schliessen.
        closeBehaviour: 'DELETE_IMMEDIATELY',
        systemMessagesOnDiscord: true,
        feedbackEnabled: false,
        maintenanceMode: false,
        transcriptRetentionDays: 0,
      },
      ADMIN,
    );
  });

  // --- Schliessen --------------------------------------------------------

  it('schliesst das Ticket wirklich - Status, Zeitpunkt und Person', async () => {
    const offen = await ticket();
    await tickets.closeTicket(offen.id, 'Erledigt', actor(SUPPORTER, 'nina'));

    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.status).toBe('CLOSED');
    expect(danach.closedAt).not.toBeNull();
    expect(danach.closedByDiscordId).toBe(SUPPORTER);
    expect(danach.closeReason).toBe('Erledigt');
  });

  it('hält den Abschluss fest, bevor der Kanal fällig wird', async () => {
    // Die Reihenfolge ist der Punkt: erst der Zustand in der Datenbank, dann
    // Discord. Wer den Kanal zuerst löscht, hat bei einem Absturz ein offenes
    // Ticket ohne Kanal.
    const offen = await ticket();
    const geschlossen = await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    expect(geschlossen.closedAt).not.toBeNull();
    expect(geschlossen.channelPurgeAt).not.toBeNull();
    // Fällig, aber noch nicht gelöscht - der Kanal steht die fünf Sekunden.
    expect(geschlossen.channelPurgeAt!.getTime()).toBeGreaterThan(Date.now());
    expect(discord.geloescht).toEqual([]);
  });

  it('setzt die Fälligkeit auf fünf Sekunden', async () => {
    const offen = await ticket();
    const vorher = Date.now();
    const geschlossen = await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    const frist = geschlossen.channelPurgeAt!.getTime() - vorher;
    expect(frist).toBeGreaterThan(3_000);
    expect(frist).toBeLessThanOrEqual(6_000);
  });

  it('löscht den Kanal, sobald die Frist abgelaufen ist', async () => {
    const offen = await ticket();
    const kanalId = offen.discordChannelId!;
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    // Statt fünf Sekunden zu warten: die Fälligkeit vorziehen und den
    // Aufräumauftrag laufen lassen - genau das tut der Wecker auch.
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1000) },
    });
    const entfernt = await tickets.purgeDueChannels();

    expect(entfernt).toBe(1);
    expect(discord.geloescht).toContain(kanalId);

    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.discordChannelId).toBeNull();
    expect(danach.status).toBe('ARCHIVED');
  });

  it('zählt ein geschlossenes Ticket nicht mehr als offen', async () => {
    const betrachter = viewer(SUPPORTER, [SUPPORT_ROLE], [tickets.TICKET_PERMISSIONS.admin]);

    const eins = await ticket();
    expect(await tickets.countOpenTickets(betrachter)).toBe(1);

    await tickets.closeTicket(eins.id, null, actor(SUPPORTER, 'nina'));
    expect(await tickets.countOpenTickets(betrachter)).toBe(0);
  });

  it('zählt ein wieder geöffnetes Ticket erneut', async () => {
    const betrachter = viewer(SUPPORTER, [SUPPORT_ROLE], [tickets.TICKET_PERMISSIONS.admin]);

    const eins = await ticket();
    await tickets.closeTicket(eins.id, null, actor(SUPPORTER, 'nina'));
    expect(await tickets.countOpenTickets(betrachter)).toBe(0);

    await tickets.reopenTicket(eins.id, actor(SUPPORTER, 'nina'));
    expect(await tickets.countOpenTickets(betrachter)).toBe(1);
  });

  it('zählt nur, was der Betrachter sehen darf', async () => {
    await ticket();
    // Ein Mitglied, das nur die eigenen Tickets sieht - und dieses gehört
    // jemand anderem.
    const fremder = viewer('900000000000002099', [], [tickets.TICKET_PERMISSIONS.viewOwn]);
    expect(await tickets.countOpenTickets(fremder)).toBe(0);

    const eigener = viewer(ERSTELLER, [], [tickets.TICKET_PERMISSIONS.viewOwn]);
    expect(await tickets.countOpenTickets(eigener)).toBe(1);
  });

  // --- Antworten ---------------------------------------------------------

  it('erwähnt den Ersteller ausserhalb des Embeds', async () => {
    const offen = await ticket();
    discord.gesendet.length = 0;

    await tickets.sendMessage(offen.id, 'Wir schauen uns das an.', {
      discordId: SUPPORTER,
      username: 'nina',
      isStaff: true,
    });

    const antwort = discord.gesendet.at(-1)!;
    // Im `content` - nur dort löst Discord eine Benachrichtigung aus.
    expect(antwort.payload.content).toBe(`<@${ERSTELLER}>`);
    const erlaubt = antwort.payload.allowedMentions as { parse?: string[]; users?: string[] };
    expect(erlaubt.users).toEqual([ERSTELLER]);
    expect(erlaubt.parse).toEqual([]);
  });

  it('erwähnt niemanden, wenn das Mitglied selbst schreibt', async () => {
    const offen = await ticket();
    discord.gesendet.length = 0;

    await tickets.sendMessage(offen.id, 'Hier noch ein Nachtrag.', {
      discordId: ERSTELLER,
      username: 'manuel',
      isStaff: false,
    });

    const antwort = discord.gesendet.at(-1)!;
    expect(antwort.payload.content).toBeUndefined();
    expect((antwort.payload.allowedMentions as { parse?: string[] }).parse).toEqual([]);
  });

  it('lässt aus dem Antworttext niemanden pingen', async () => {
    const offen = await ticket();
    discord.gesendet.length = 0;

    await tickets.sendMessage(offen.id, '@everyone @here <@&123> schaut mal', {
      discordId: SUPPORTER,
      username: 'nina',
      isStaff: true,
    });

    const antwort = discord.gesendet.at(-1)!;
    // Der Text steht im Embed, nicht im content - und freigegeben ist
    // ausschliesslich der Ersteller.
    expect(antwort.payload.content).toBe(`<@${ERSTELLER}>`);
    const erlaubt = antwort.payload.allowedMentions as { parse?: string[]; users?: string[] };
    expect(erlaubt.parse).toEqual([]);
    expect(erlaubt.users).toEqual([ERSTELLER]);
  });

  // --- Chat und Verlauf --------------------------------------------------

  it('schreibt interne Vorgänge nicht in den Kanal', async () => {
    const offen = await ticket();
    discord.gesendet.length = 0;

    await tickets.claimTicket(offen.id, actor(SUPPORTER, 'nina'));
    await tickets.assignTicket(
      offen.id,
      { discordId: SUPPORTER, username: 'nina' },
      actor(SUPPORTER, 'nina'),
    );
    await tickets.changeStatus(offen.id, 'IN_PROGRESS', actor(SUPPORTER, 'nina'));
    await tickets.changePriority(offen.id, 'HIGH', actor(SUPPORTER, 'nina'));

    // Kein einziges dieser vier Ereignisse gehört in ein Gespräch.
    expect(discord.gesendet).toEqual([]);
  });

  it('hält dieselben Vorgänge trotzdem im Verlauf fest', async () => {
    const offen = await ticket();
    await tickets.claimTicket(offen.id, actor(SUPPORTER, 'nina'));
    // Nicht IN_PROGRESS: das setzt die Übernahme bereits, und ein Wechsel auf
    // denselben Wert ist zu Recht ein No-op.
    await tickets.changeStatus(offen.id, 'WAITING_FOR_USER', actor(SUPPORTER, 'nina'));
    await tickets.changePriority(offen.id, 'HIGH', actor(SUPPORTER, 'nina'));

    const arten = (
      await prisma.ticketEvent.findMany({ where: { ticketId: offen.id }, select: { kind: true } })
    ).map((eintrag) => eintrag.kind);

    expect(arten).toContain('CLAIMED');
    expect(arten).toContain('STATUS_CHANGED');
    expect(arten).toContain('PRIORITY_CHANGED');
  });

  it('meldet den Abschluss weiterhin im Kanal', async () => {
    // Was an die Beteiligten gerichtet ist, bleibt: sonst stünde das Ticket
    // kommentarlos still.
    const offen = await ticket();
    discord.gesendet.length = 0;

    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    const texte = discord.gesendet
      .flatMap((eintrag) => (eintrag.payload.embeds as Array<{ description?: string }>) ?? [])
      .map((embed) => embed.description ?? '')
      .join(' ');
    expect(texte).toContain('geschlossen');
  });
  // --- Ein Abschluss, zwei Wege ------------------------------------------
  //
  // Dashboard und Discord rufen dieselbe Funktion auf. Was hier geprüft wird,
  // ist nicht, dass beide funktionieren - sondern dass es beim einen Mal
  // dasselbe tut wie beim anderen, und dass zwei gleichzeitige Versuche
  // zusammen nicht mehr auslösen als einer.

  it('schliesst über beide Wege gleich und plant beide Male dasselbe Aufräumen', async () => {
    const ausDemBrowser = await ticket();
    const ausDiscord = await ticket();

    const a = await tickets.closeTicket(ausDemBrowser.id, null, {
      discordId: SUPPORTER,
      username: 'nina',
      source: 'WEBAPP',
    });
    const b = await tickets.closeTicket(ausDiscord.id, null, {
      discordId: SUPPORTER,
      username: 'nina',
      source: 'DISCORD',
    });

    for (const geschlossen of [a, b]) {
      expect(geschlossen.status).toBe('CLOSED');
      expect(geschlossen.closedAt).not.toBeNull();
      expect(geschlossen.closedByDiscordId).toBe(SUPPORTER);
      // Fünf Sekunden, aus derselben Konstante - nicht zweimal eine Zahl.
      expect(geschlossen.channelPurgeAt).not.toBeNull();
      const frist = geschlossen.channelPurgeAt!.getTime() - geschlossen.closedAt!.getTime();
      expect(frist).toBe(tickets.KANAL_LOESCHVERZOEGERUNG_MS);
    }
  });

  it('hält den Weg im Verlauf fest, ohne ihn fachlich anders zu behandeln', async () => {
    const offen = await ticket();

    await tickets.closeTicket(offen.id, null, {
      discordId: SUPPORTER,
      username: 'nina',
      source: 'DISCORD',
    });

    const ereignis = await prisma.ticketEvent.findFirstOrThrow({
      where: { ticketId: offen.id, kind: 'CLOSED' },
    });
    expect(ereignis.actorSource).toBe('DISCORD');
  });

  it('erzeugt bei zwei gleichzeitigen Abschlüssen nur einen', async () => {
    // Der Knopf im Dashboard und der auf Discord können sich in derselben
    // Sekunde treffen. Zweimal alles wäre: zwei Abschlussmeldungen im Kanal,
    // zwei Einträge im Verlauf, zwei Aufräumaufträge.
    const offen = await ticket();
    discord.gesendet.length = 0;

    const [erste, zweite] = await Promise.all([
      tickets.closeTicket(offen.id, 'erledigt', actor(SUPPORTER, 'nina')),
      tickets.closeTicket(offen.id, 'auch erledigt', {
        discordId: ADMIN.discordId,
        username: ADMIN.username,
        source: 'DISCORD',
      }),
    ]);

    // Beide bekommen ein geschlossenes Ticket zurück - keiner sieht einen
    // Fehler, obwohl nur einer den Zuschlag hatte.
    expect(erste.status).toBe('CLOSED');
    expect(zweite.status).toBe('CLOSED');
    expect(erste.closedAt!.getTime()).toBe(zweite.closedAt!.getTime());

    const ereignisse = await prisma.ticketEvent.count({
      where: { ticketId: offen.id, kind: 'CLOSED' },
    });
    expect(ereignisse).toBe(1);
  });

  it('löscht den Kanal beim Aufräumen und nur einmal', async () => {
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));
    discord.geloescht.length = 0;

    // Fällig stellen, statt fünf Sekunden zu warten.
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1000) },
    });

    // Zwei Durchgänge gleichzeitig: der Wecker im Web-Prozess und der
    // Aufräumauftrag im Bot greifen denselben Kanal auf.
    await Promise.all([tickets.purgeDueChannels(), tickets.purgeDueChannels()]);

    expect(discord.geloescht).toHaveLength(1);
    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.status).toBe('ARCHIVED');
    expect(danach.discordChannelId).toBeNull();
    expect(danach.channelPurgeAt).toBeNull();
  });

  it('nimmt einen bereits gelöschten Kanal als erledigt hin', async () => {
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1000) },
    });

    // Jemand hat den Kanal von Hand gelöscht - Discord antwortet mit 404.
    const { DiscordApiError } = await import('@swisshub/discord');
    discord.gateway.managedChannels.remove = vi.fn(async () => {
      throw new DiscordApiError(404, 10003, 'DELETE /channels/x', 'Unknown Channel');
    }) as never;

    await expect(tickets.purgeDueChannels()).resolves.not.toThrow();

    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.status).toBe('ARCHIVED');
    expect(danach.channelPurgeAt).toBeNull();
  });

  it('lässt das Ticket geschlossen, wenn Discord den Kanal nicht hergibt', async () => {
    // Der Abschluss ist fachlich vollzogen. Dass Discord gerade nicht mag,
    // macht ihn nicht rückgängig.
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1000) },
    });

    discord.gateway.managedChannels.remove = vi.fn(async () => {
      throw new Error('Discord ist nicht erreichbar');
    }) as never;

    await expect(tickets.purgeDueChannels()).resolves.not.toThrow();

    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.closedAt).not.toBeNull();
    expect(danach.closedByDiscordId).toBe(SUPPORTER);
  });

  /*
    Beide Wege bis zum Ende - nicht nur bis zum Abschluss.

    Die Faelle darueber pruefen, dass Dashboard und Discord dasselbe planen.
    Diese hier gehen einen Schritt weiter und lassen die Frist tatsaechlich
    ablaufen: was zaehlt, ist nicht der Eintrag in der Datenbank, sondern der
    Kanal, der danach weg ist.
  */

  for (const weg of ['WEBAPP', 'DISCORD'] as const) {
    it(`löscht den Kanal auch am Ende des Wegs über ${weg}`, async () => {
      const offen = await ticket();
      const kanal = offen.discordChannelId;
      expect(kanal).not.toBeNull();

      const geschlossen = await tickets.closeTicket(offen.id, null, {
        discordId: SUPPORTER,
        username: 'nina',
        source: weg,
      });

      // Fachlich geschlossen, bevor irgendetwas mit dem Kanal geschieht.
      expect(geschlossen.status).toBe('CLOSED');
      expect(geschlossen.closedAt).not.toBeNull();
      expect(geschlossen.closedByDiscordId).toBe(SUPPORTER);
      expect(discord.geloescht).not.toContain(kanal);

      // Fünf Sekunden später - hier vorgezogen, statt sie abzuwarten.
      await prisma.ticket.update({
        where: { id: offen.id },
        data: { channelPurgeAt: new Date(Date.now() - 1) },
      });
      await tickets.purgeDueChannels();

      expect(discord.geloescht).toContain(kanal);
      const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
      expect(danach.discordChannelId).toBeNull();
      expect(danach.status).toBe('ARCHIVED');
    });
  }

  it('versucht es erneut, wenn Discord die Löschung einmal verweigert', async () => {
    /*
      Der Fehler, der Kanäle auf dem Server zurückliess.

      Ein einziger Aussetzer - ein fehlendes Recht, ein 500er, ein Rate Limit
      mitten im Deployment - genügte: der Fehlschlag wurde vermerkt, und
      danach lief der Ablauf weiter, als wäre gelöscht worden. Die Kennung war
      weg, das Ticket stand auf ARCHIVED, und der Kanal blieb für immer auf
      dem Server, ohne dass ihn noch irgendwer gesucht hätte.
    */
    const offen = await ticket();
    const kanal = offen.discordChannelId;
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    let versuche = 0;
    discord.gateway.managedChannels.remove = vi.fn(async () => {
      versuche += 1;
      throw new Error('Missing Permissions');
    }) as never;

    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1) },
    });
    await tickets.purgeDueChannels();

    // Der Auftrag steht weiterhin: Kennung erhalten, neue Frist gesetzt.
    const nachFehlschlag = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(versuche).toBe(1);
    expect(nachFehlschlag.discordChannelId).toBe(kanal);
    expect(nachFehlschlag.channelPurgeAt).not.toBeNull();
    expect(nachFehlschlag.channelPurgeAttempts).toBe(1);
    // Und nicht als erledigt abgehakt.
    expect(nachFehlschlag.status).toBe('CLOSED');
    expect(nachFehlschlag.channelMissing).toBe(false);

    // Sobald Discord wieder mitmacht, räumt der nächste Durchgang auf.
    discord.gateway.managedChannels.remove = vi.fn(async () => {
      versuche += 1;
    }) as never;
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1) },
    });
    await tickets.purgeDueChannels();

    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(versuche).toBe(2);
    expect(danach.discordChannelId).toBeNull();
    expect(danach.status).toBe('ARCHIVED');
    expect(danach.channelPurgeAttempts).toBe(0);
  });

  it('wartet zwischen zwei Versuchen länger als zwischen den ersten beiden', async () => {
    // Ein Auftrag, der an einem fehlenden Recht hängt, soll nicht im
    // Sekundentakt anklopfen - aber auch nie ganz aufgeben.
    expect(tickets.wartezeitMs(1)).toBeLessThan(tickets.wartezeitMs(2));
    expect(tickets.wartezeitMs(2)).toBeLessThan(tickets.wartezeitMs(3));
    // Gedeckelt: sonst läge der nächste Versuch irgendwann in Jahren.
    expect(tickets.wartezeitMs(50)).toBe(tickets.wartezeitMs(40));
  });

  it('meldet eine Löschung, die wiederholt scheitert', async () => {
    // Der Aufräumer gibt nicht auf - aber er kann die Ursache nicht beheben.
    // Also muss sie jemandem auffallen.
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    expect(await tickets.zaehleHaengendeLoeschungen()).toBe(0);

    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAttempts: tickets.LOESCHUNG_AUFFAELLIG_AB },
    });

    expect(await tickets.zaehleHaengendeLoeschungen()).toBe(1);
  });

  it('behält die Ticketdaten, wenn der Kanal verschwindet', async () => {
    // Der Kanal ist die Bühne, nicht die Akte.
    const offen = await ticket();
    await tickets.closeTicket(offen.id, 'Erledigt', actor(SUPPORTER, 'nina'));
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1) },
    });
    await tickets.purgeDueChannels();

    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.subject).toBe(offen.subject);
    expect(danach.ticketNumber).toBe(offen.ticketNumber);
    expect(danach.creatorDiscordId).toBe(ERSTELLER);
    expect(danach.closeReason).toBe('Erledigt');
    expect(danach.closedByDiscordId).toBe(SUPPORTER);
    // Und der Verlauf steht auch noch.
    expect(await prisma.ticketEvent.count({ where: { ticketId: offen.id } })).toBeGreaterThan(0);
  });

  it('trägt einen liegengebliebenen Kanal nach, statt ihn stehen zu lassen', async () => {
    // Geschlossen, als «nie löschen» galt. Ohne Fälligkeit sucht niemand
    // danach - der Kanal bliebe für immer stehen.
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: null, closedAt: new Date(Date.now() - 3600_000) },
    });

    const nachgetragen = await tickets.scheduleOrphanedChannels(tickets.KANAL_LOESCHVERZOEGERUNG_MS);

    expect(nachgetragen).toBe(1);
    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    // Ab dem Abschluss gerechnet: eine Stunde alt, fünf Sekunden Frist - fällig.
    expect(danach.channelPurgeAt!.getTime()).toBeLessThan(Date.now());
  });

  it('trägt bei «nie löschen» nichts nach', async () => {
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));
    await prisma.ticket.update({ where: { id: offen.id }, data: { channelPurgeAt: null } });

    expect(await tickets.scheduleOrphanedChannels(null)).toBe(0);
    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.channelPurgeAt).toBeNull();
  });
  it('holt eine Löschung nach, die der Wecker nicht mehr geschafft hat', async () => {
    // Der Fall, den der Wecker im Prozess nicht abdeckt: zwischen Abschluss
    // und Löschung wird neu gestartet. Die Zusage steht deshalb in der
    // Datenbank und nicht im Arbeitsspeicher - der Aufräumlauf findet sie.
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));

    const geschlossen = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(geschlossen.channelPurgeAt).not.toBeNull();
    discord.geloescht.length = 0;

    // Die fünf Sekunden sind vorbei, der Wecker ist mit dem Prozess gestorben.
    await prisma.ticket.update({
      where: { id: offen.id },
      data: { channelPurgeAt: new Date(Date.now() - 1000) },
    });
    await tickets.purgeDueChannels();

    expect(discord.geloescht).toEqual([geschlossen.discordChannelId]);
  });

  it('lässt einen noch nicht fälligen Kanal in Ruhe', async () => {
    // Die fünf Sekunden sind eine Zusage in beide Richtungen: der Kanal
    // verschwindet nicht früher, damit die Abschlussmeldung lesbar bleibt.
    const offen = await ticket();
    await tickets.closeTicket(offen.id, null, actor(SUPPORTER, 'nina'));
    discord.geloescht.length = 0;

    await tickets.purgeDueChannels();

    expect(discord.geloescht).toEqual([]);
    const danach = await prisma.ticket.findUniqueOrThrow({ where: { id: offen.id } });
    expect(danach.channelPurgeAt).not.toBeNull();
  });
});
