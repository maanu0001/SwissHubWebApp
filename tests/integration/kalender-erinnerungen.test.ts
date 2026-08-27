import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_erinnerungen');

/**
 * Erinnerungen gegen eine echte Datenbank.
 *
 * Die Zusagen: sie überleben einen Neustart, sie gehen genau einmal raus -
 * auch wenn zwei Bot-Instanzen gleichzeitig nachsehen -, und ein
 * Discord-Ausfall verliert sie nicht, sondern verschiebt sie.
 */
const { prisma } = await import('@swisshub/database');
const { calendar, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const KANAL = '900000000000000100';

/** Ein Discord-Zugang, der mitschreibt statt zu senden. */
function attrappe(verhalten: { scheitern?: boolean } = {}) {
  const gesendet: Array<{ channelId: string; content: string }> = [];
  const gateway = {
    channels: {
      send: vi.fn(async (channelId: string, payload: { content?: string }) => {
        if (verhalten.scheitern) {
          throw new Error('Discord nicht erreichbar');
        }
        gesendet.push({ channelId, content: payload.content ?? '' });
        return { id: `msg-${gesendet.length}`, channelId };
      }),
      edit: vi.fn(async () => undefined),
    },
  } as unknown as Parameters<typeof calendar.runReminderTick>[1];
  return { gateway, gesendet };
}

async function eventMitErinnerung(minutenVorher: number, startInMinuten: number) {
  const event = await calendar.createEvent(
    ADMIN,
    calendar.eventInputSchema.parse({
      title: 'Community Gaming Night',
      description: 'Wir zocken zusammen.',
      startAt: new Date(Date.now() + startInMinuten * 60_000).toISOString(),
      announceOnDiscord: true,
      announcementChannelId: KANAL,
      reminderMinutes: [minutenVorher],
    }),
  );
  return calendar.publishEvent(ADMIN, event.id);
}

describeWithDatabase('Kalender-Erinnerungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(calendar.CALENDAR_MODULE_ID, true, 'test');
    await setModuleSettings(
      calendar.CALENDAR_MODULE_ID,
      { defaultAnnouncementChannelId: KANAL, remindersEnabled: true },
      'test',
    );
  });

  it('legt die Erinnerung als Zeile an, nicht als Zeitgeber', async () => {
    // Der Kern der Neustartsicherheit: nach dem Anlegen steht die Fälligkeit
    // in der Datenbank. Ein Prozess, der stirbt, nimmt nichts mit.
    const event = await eventMitErinnerung(60, 120);
    const zeilen = await prisma.calendarReminder.findMany({ where: { eventId: event.id } });

    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.sentAt).toBeNull();
    expect(zeilen[0]!.dueAt.getTime()).toBe(event.startAt.getTime() - 60 * 60_000);
  });

  it('sendet nichts, solange die Erinnerung nicht fällig ist', async () => {
    await eventMitErinnerung(60, 120);
    const { gateway, gesendet } = attrappe();

    const ergebnis = await calendar.runReminderTick(new Date(), gateway);

    expect(ergebnis.gesendet).toBe(0);
    expect(gesendet).toHaveLength(0);
  });

  it('sendet die fällige Erinnerung', async () => {
    const event = await eventMitErinnerung(60, 90);
    const { gateway, gesendet } = attrappe();
    // Dreissig Minuten später ist der Vorlauf erreicht.
    const jetzt = new Date(event.startAt.getTime() - 59 * 60_000);

    const ergebnis = await calendar.runReminderTick(jetzt, gateway);

    expect(ergebnis.gesendet).toBe(1);
    expect(gesendet[0]?.channelId).toBe(KANAL);
    expect(gesendet[0]?.content).toContain('Community Gaming Night');
  });

  it('sendet dieselbe Erinnerung kein zweites Mal', async () => {
    const event = await eventMitErinnerung(60, 90);
    const jetzt = new Date(event.startAt.getTime() - 59 * 60_000);

    const erster = attrappe();
    await calendar.runReminderTick(jetzt, erster.gateway);
    const zweiter = attrappe();
    await calendar.runReminderTick(jetzt, zweiter.gateway);

    expect(erster.gesendet).toHaveLength(1);
    expect(zweiter.gesendet).toHaveLength(0);
  });

  it('belegt eine Erinnerung genau einmal, auch wenn zwei Läufe sie gleichzeitig sehen', async () => {
    // Der eigentliche Mehrinstanzen-Fall: beide Läufe haben dieselbe Zeile
    // gelesen, bevor einer sie belegt hat. Über die öffentliche Schnittstelle
    // lässt sich diese Verschränkung nicht zuverlässig herstellen - der
    // Filter in `findMany` fängt sie vorher ab. Geprüft wird deshalb das
    // Verfahren, auf dem der Schutz beruht: die bedingte Zuteilung.
    const event = await eventMitErinnerung(60, 90);
    const zeile = await prisma.calendarReminder.findFirstOrThrow({
      where: { eventId: event.id },
    });
    const jetzt = new Date();

    const beide = await Promise.all([
      prisma.calendarReminder.updateMany({
        where: { id: zeile.id, sentAt: null },
        data: { sentAt: jetzt },
      }),
      prisma.calendarReminder.updateMany({
        where: { id: zeile.id, sentAt: null },
        data: { sentAt: jetzt },
      }),
    ]);

    // Genau einer bekommt den Zuschlag - und nur der sendet.
    expect(beide.map((e) => e.count).sort()).toEqual([0, 1]);
  });

  it('sendet auch bei zwei überlappenden Läufen nur einmal', async () => {
    // Der Fall «zwei Bot-Instanzen». Die Überlappung wird erzwungen statt
    // erhofft: Lauf A hängt mitten im Versand fest, während Lauf B komplett
    // durchläuft. Ohne die bedingte Zuteilung würde B dieselbe Erinnerung
    // ein zweites Mal schicken - mit ihr findet er nichts mehr zu tun.
    const event = await eventMitErinnerung(60, 90);
    const jetzt = new Date(event.startAt.getTime() - 59 * 60_000);

    let freigeben: () => void = () => undefined;
    const haengt = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    let aImVersand: () => void = () => undefined;
    const aIstDrin = new Promise<void>((resolve) => {
      aImVersand = resolve;
    });

    const aGesendet: string[] = [];
    const langsam = {
      channels: {
        send: async (channelId: string) => {
          aImVersand();
          await haengt;
          aGesendet.push(channelId);
          return { id: 'msg-a', channelId };
        },
        edit: async () => undefined,
      },
    } as unknown as Parameters<typeof calendar.runReminderTick>[1];

    const laufA = calendar.runReminderTick(jetzt, langsam);
    await aIstDrin;

    // A hat die Erinnerung belegt, sendet aber noch. Jetzt kommt B.
    const b = attrappe();
    const ergebnisB = await calendar.runReminderTick(jetzt, b.gateway);

    freigeben();
    await laufA;

    expect(aGesendet).toHaveLength(1);
    expect(b.gesendet).toHaveLength(0);
    expect(ergebnisB.gesendet).toBe(0);
  });

  it('gibt die Erinnerung nach einem Discord-Ausfall wieder frei', async () => {
    const event = await eventMitErinnerung(60, 90);
    const jetzt = new Date(event.startAt.getTime() - 59 * 60_000);

    const kaputt = attrappe({ scheitern: true });
    const ersterLauf = await calendar.runReminderTick(jetzt, kaputt.gateway);
    expect(ersterLauf.gescheitert).toBe(1);

    // Nicht verloren: die Zeile ist wieder offen, der Fehlversuch gezählt.
    const zwischenstand = await prisma.calendarReminder.findFirstOrThrow({
      where: { eventId: event.id },
    });
    expect(zwischenstand.sentAt).toBeNull();
    expect(zwischenstand.attempts).toBe(1);
    expect(zwischenstand.lastError).toContain('Discord');

    const heil = attrappe();
    const zweiterLauf = await calendar.runReminderTick(jetzt, heil.gateway);
    expect(zweiterLauf.gesendet).toBe(1);
  });

  it('gibt nach zu vielen Fehlversuchen auf, statt Discord zu bedrängen', async () => {
    const event = await eventMitErinnerung(60, 90);
    const jetzt = new Date(event.startAt.getTime() - 59 * 60_000);
    const kaputt = attrappe({ scheitern: true });

    for (let i = 0; i < calendar.MAX_VERSUCHE + 2; i += 1) {
      await calendar.runReminderTick(jetzt, kaputt.gateway);
    }

    const zeile = await prisma.calendarReminder.findFirstOrThrow({ where: { eventId: event.id } });
    expect(zeile.attempts).toBe(calendar.MAX_VERSUCHE);
  });

  it('holt eine verpasste Erinnerung nicht nach, wenn das Event schon läuft', async () => {
    // Nach einem Ausfall über Nacht wäre eine Erinnerung an einen Abend, der
    // gerade läuft, nur verwirrend. Sie gilt als erledigt.
    const event = await eventMitErinnerung(60, 90);
    const { gateway, gesendet } = attrappe();
    const spaet = new Date(event.startAt.getTime() + 30 * 60_000);

    const ergebnis = await calendar.runReminderTick(spaet, gateway);

    expect(ergebnis.gesendet).toBe(0);
    expect(ergebnis.uebersprungen).toBe(1);
    expect(gesendet).toHaveLength(0);
  });

  it('erinnert nicht an ein abgesagtes Event', async () => {
    const event = await eventMitErinnerung(60, 90);
    await calendar.cancelEvent(ADMIN, event.id, 'Referent krank');
    const { gateway, gesendet } = attrappe();

    const ergebnis = await calendar.runReminderTick(
      new Date(event.startAt.getTime() - 59 * 60_000),
      gateway,
    );

    expect(ergebnis.gesendet).toBe(0);
    expect(gesendet).toHaveLength(0);
    // Die Zeile bleibt stehen - wird die Absage zurückgenommen, ist der Plan
    // noch da.
    expect(await prisma.calendarReminder.count({ where: { eventId: event.id } })).toBe(1);
  });

  it('verschiebt die Fälligkeit mit dem Event', async () => {
    const event = await eventMitErinnerung(60, 240);
    const neuerStart = new Date(event.startAt.getTime() + 24 * 3600_000);

    await calendar.updateEvent(
      ADMIN,
      event.id,
      calendar.eventInputSchema.parse({
        title: event.title,
        description: event.description,
        startAt: neuerStart.toISOString(),
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        reminderMinutes: [60],
      }),
    );

    const zeile = await prisma.calendarReminder.findFirstOrThrow({ where: { eventId: event.id } });
    expect(zeile.dueAt.getTime()).toBe(neuerStart.getTime() - 60 * 60_000);
    expect(zeile.sentAt).toBeNull();
  });

  it('sendet nichts, wenn Erinnerungen im Modul abgeschaltet sind', async () => {
    const event = await eventMitErinnerung(60, 90);
    await setModuleSettings(
      calendar.CALENDAR_MODULE_ID,
      { defaultAnnouncementChannelId: KANAL, remindersEnabled: false },
      'test',
    );
    const { gateway, gesendet } = attrappe();

    await calendar.runReminderTick(new Date(event.startAt.getTime() - 59 * 60_000), gateway);

    expect(gesendet).toHaveLength(0);
  });

  it('erwähnt nur Rollen, die im Modul freigegeben sind', async () => {
    // Ein freies Feld am Event wäre ein Ping-Knopf für den ganzen Server.
    const event = await calendar.createEvent(
      ADMIN,
      calendar.eventInputSchema.parse({
        title: 'Mit Ping',
        description: 'Test',
        startAt: new Date(Date.now() + 90 * 60_000).toISOString(),
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        reminderMinutes: [60],
        reminderMentionRoleId: '900000000000000777',
      }),
    );
    await calendar.publishEvent(ADMIN, event.id);
    const { gateway, gesendet } = attrappe();

    await calendar.runReminderTick(new Date(event.startAt.getTime() - 59 * 60_000), gateway);

    expect(gesendet[0]?.content).not.toContain('900000000000000777');
  });
});
