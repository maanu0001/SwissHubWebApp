import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_verbesserungen');

/**
 * Was am Kalender geändert wurde - und was dabei stehen bleiben musste.
 *
 * Vier Dinge liefen auseinander zwischen dem, was im Formular stand, und dem,
 * was danach geschah: das Häkchen «Auf Discord ankündigen» tat beim
 * Veröffentlichen nichts, die Ortsauswahl bot vier Möglichkeiten für zwei
 * Entscheidungen, wiederkehrende Reihen bekamen ihr Banner nur von Hand, und
 * anmelden konnte man sich ausschliesslich im Browser.
 *
 * Der letzte Punkt ist der heikelste: der Knopf unter der Ankündigung darf
 * keine zweite Anmeldelogik sein. Diese Datei hält fest, dass er dieselbe
 * benutzt - inklusive Platzgrenze und Warteliste.
 */
const { prisma } = await import('@swisshub/database');
const { calendar } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const KANAL = '200000000000000020';

function attrappe() {
  const gesendet: Array<{ channelId: string; payload: Record<string, unknown> }> = [];
  const gateway = {
    channels: {
      send: vi.fn(async (channelId: string, payload: Record<string, unknown>) => {
        gesendet.push({ channelId, payload });
        return { id: `msg-${gesendet.length}`, channelId };
      }),
      edit: vi.fn(async () => undefined),
    },
  } as unknown as Parameters<typeof calendar.refreshAnnouncement>[1];
  return { gateway, gesendet };
}

const eingabe = (overrides: Record<string, unknown> = {}) =>
  calendar.eventInputSchema.parse({
    title: 'Community Gaming Night',
    description: 'Wir zocken zusammen.',
    startAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    ...overrides,
  });

const person = (n: number) => ({
  discordId: `90000000000000${String(n).padStart(4, '0')}`,
  username: `user${n}`,
});

/** Die Knöpfe einer Ankündigung, flach. */
const knoepfe = (payload: Record<string, unknown>): Array<Record<string, unknown>> => {
  const reihen = (payload.components ?? []) as Array<{ components: Array<Record<string, unknown>> }>;
  return reihen.flatMap((reihe) => reihe.components);
};

describeWithDatabase('Kalender-Verbesserungen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CalendarAnswer","CalendarQuestion","CalendarReminder","CalendarNotice","CalendarRegistration","CalendarEvent","CalendarCategory","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  // --- Veröffentlichen kündigt an ----------------------------------------

  it('kündigt beim Veröffentlichen an, wenn das Häkchen gesetzt ist', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet } = attrappe();

    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]?.channelId).toBe(KANAL);
  });

  it('kündigt ohne Häkchen weiterhin nichts an', async () => {
    const event = await calendar.createEvent(ADMIN, eingabe({ announceOnDiscord: false }));
    const { gateway, gesendet } = attrappe();

    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    expect(gesendet).toHaveLength(0);
  });

  it('kündigt auch bei einem zweiten Anlauf nicht doppelt an', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const { gateway, gesendet } = attrappe();

    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });
    // Der Weg über die Verwaltung bleibt - er darf nur nichts verdoppeln.
    await calendar.announceEvent(event.id, { gateway, actor: ADMIN });

    expect(gesendet).toHaveLength(1);
  });

  it('lässt eine gescheiterte Ankündigung die Veröffentlichung nicht zurücknehmen', async () => {
    // Discord kann weg sein. Der Termin ist trotzdem veröffentlicht - der
    // Zustand steht in der Datenbank, nicht im Kanal.
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({ announceOnDiscord: true, announcementChannelId: KANAL }),
    );
    const gateway = {
      channels: {
        send: vi.fn(async () => {
          throw new Error('Discord ist nicht erreichbar');
        }),
        edit: vi.fn(async () => undefined),
      },
    } as unknown as Parameters<typeof calendar.refreshAnnouncement>[1];

    const veroeffentlicht = await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    expect(veroeffentlicht.status).toBe('SCHEDULED');
    expect(veroeffentlicht.publishedAt).not.toBeNull();
  });

  // --- Ort ----------------------------------------------------------------

  it('nimmt nur noch die zwei verbliebenen Ortsarten entgegen', () => {
    expect(calendar.eventInputSchema.safeParse({
      title: 'Treffen',
      description: 'Wir treffen uns.',
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      locationKind: 'HYBRID',
    }).success).toBe(false);

    expect(calendar.eventInputSchema.safeParse({
      title: 'Treffen',
      description: 'Wir treffen uns.',
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      locationKind: 'REAL_LIFE',
      locationName: 'Sihlcity',
    }).success).toBe(true);
  });

  it('verlangt bei einem Termin im echten Leben einen Ort', () => {
    const ergebnis = calendar.eventInputSchema.safeParse({
      title: 'Treffen',
      description: 'Wir treffen uns.',
      startAt: new Date(Date.now() + 86_400_000).toISOString(),
      locationKind: 'REAL_LIFE',
    });

    expect(ergebnis.success).toBe(false);
    if (!ergebnis.success) {
      expect(ergebnis.error.issues.map((problem) => problem.path.join('.'))).toContain(
        'locationName',
      );
    }
  });

  it('ordnet alte Einordnungen weiterhin zu, statt sie zu verlieren', () => {
    // Zeilen aus der ersten Fassung sollen lesbar bleiben - deshalb bleiben
    // die alten Werte im Datentyp, und deshalb gibt es diese Abbildung.
    expect(calendar.ortsArt({ locationKind: 'OFFLINE' })).toBe('REAL_LIFE');
    expect(calendar.ortsArt({ locationKind: 'HYBRID' })).toBe('REAL_LIFE');
    expect(calendar.ortsArt({ locationKind: 'ONLINE' })).toBe('DISCORD');
    expect(calendar.ortsArt({ locationKind: 'DISCORD' })).toBe('DISCORD');
    expect(calendar.ortsArt({ locationKind: 'REAL_LIFE' })).toBe('REAL_LIFE');
  });

  // --- Banner -------------------------------------------------------------

  it('nimmt das Banner der Kategorie, wenn der Termin keines hat', async () => {
    const kategorie = await calendar.saveCategory(ADMIN, {
      name: 'GameNight',
      color: '#7C3AED',
      icon: 'Gamepad2',
      description: null,
      defaultBannerUrl: 'https://cdn.example.com/gamenight.png',
      active: true,
      position: 0,
    });

    expect(
      calendar.bannerFuer({ bannerUrl: null }, {
        name: kategorie.name,
        icon: kategorie.icon,
        defaultBannerUrl: kategorie.defaultBannerUrl,
      }),
    ).toBe('https://cdn.example.com/gamenight.png');
  });

  it('lässt dem Banner am Termin den Vorrang', () => {
    expect(
      calendar.bannerFuer(
        { bannerUrl: 'https://cdn.example.com/eigenes.png' },
        { name: 'GameNight', icon: null, defaultBannerUrl: 'https://cdn.example.com/reihe.png' },
      ),
    ).toBe('https://cdn.example.com/eigenes.png');
  });

  it('bleibt ohne beides bei keinem Banner', () => {
    expect(calendar.bannerFuer({ bannerUrl: null }, null)).toBeNull();
  });

  // --- Anmeldung über Discord ---------------------------------------------

  it('hängt Anmeldeknöpfe unter eine Ankündigung mit Anmeldung', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        registrationEnabled: true,
        capacity: 2,
      }),
    );
    const { gateway, gesendet } = attrappe();
    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    const alle = knoepfe(gesendet[0]!.payload);
    expect(alle.map((knopf) => knopf.custom_id)).toContain(
      calendar.buildJoinButtonId(event.id),
    );
    expect(alle.map((knopf) => knopf.custom_id)).toContain(
      calendar.buildLeaveButtonId(event.id),
    );
  });

  it('hängt keine an, wo es gar keine Anmeldung gibt', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        registrationEnabled: false,
      }),
    );
    const { gateway, gesendet } = attrappe();
    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    const alle = knoepfe(gesendet[0]!.payload);
    expect(alle).toHaveLength(1);
    expect(alle[0]?.style).toBe(5);
  });

  it('hängt keine an, wenn Zusatzfragen zu beantworten sind', async () => {
    // Eine Pflichtfrage lässt sich mit einem Klick nicht beantworten. Eine
    // halbe Anmeldung wäre schlimmer als der Umweg über die Seite.
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        registrationEnabled: true,
        questions: [{ label: 'Welche Rolle spielst du?', required: true, choices: [], hint: '' }],
      }),
    );
    const { gateway, gesendet } = attrappe();
    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    const alle = knoepfe(gesendet[0]!.payload);
    expect(alle.map((knopf) => knopf.custom_id).filter(Boolean)).toHaveLength(0);
    expect(alle[0]?.label).toBe('Event ansehen & anmelden');
  });

  it('lässt den Abmeldeknopf weg, wo keine eigene Abmeldung vorgesehen ist', async () => {
    const event = await calendar.createEvent(
      ADMIN,
      eingabe({
        announceOnDiscord: true,
        announcementChannelId: KANAL,
        registrationEnabled: true,
        allowSelfCancel: false,
      }),
    );
    const { gateway, gesendet } = attrappe();
    await calendar.publishEvent(ADMIN, event.id, new Date(), { gateway });

    const kennungen = knoepfe(gesendet[0]!.payload).map((knopf) => knopf.custom_id);
    expect(kennungen).toContain(calendar.buildJoinButtonId(event.id));
    expect(kennungen).not.toContain(calendar.buildLeaveButtonId(event.id));
  });

  it('liest aus einer Knopfkennung die Termin-ID und die Absicht', () => {
    expect(calendar.parseCalendarButtonId(calendar.buildJoinButtonId('abc'))).toEqual({
      eventId: 'abc',
      aktion: 'JOIN',
    });
    expect(calendar.parseCalendarButtonId(calendar.buildLeaveButtonId('abc'))).toEqual({
      eventId: 'abc',
      aktion: 'LEAVE',
    });
    expect(calendar.parseCalendarButtonId('swisshub:tickets:close')).toBeNull();
  });

  it('führt die Anmeldung über Discord durch dieselbe Platzgrenze', async () => {
    // Der Knopf ruft `register` auf - dieselbe Funktion wie das Dashboard.
    // Deshalb gilt die Kapazität, und deshalb landet die dritte Person auf
    // der Warteliste statt auf einem Platz, den es nicht gibt.
    const entwurf = await calendar.createEvent(
      ADMIN,
      eingabe({ registrationEnabled: true, capacity: 2, waitlistEnabled: true }),
    );
    const event = await calendar.publishEvent(ADMIN, entwurf.id);

    const erste = await calendar.register(person(1), event.id);
    const zweite = await calendar.register(person(2), event.id);
    const dritte = await calendar.register(person(3), event.id);

    expect(erste.registration.status).toBe('CONFIRMED');
    expect(zweite.registration.status).toBe('CONFIRMED');
    expect(dritte.registration.status).toBe('WAITLIST');
    expect(dritte.registration.waitlistPosition).toBe(1);
  });

  it('verschwindet der Anmeldeknopf, sobald die Anmeldung zu ist', async () => {
    const entwurf = await calendar.createEvent(
      ADMIN,
      eingabe({ registrationEnabled: true, capacity: 5 }),
    );
    const event = await calendar.publishEvent(ADMIN, entwurf.id);
    expect(await calendar.zeigtAnmeldeknoepfe(event)).toBe(true);

    const abgesagt = await calendar.cancelEvent(ADMIN, event.id, 'Fällt aus.');
    expect(await calendar.zeigtAnmeldeknoepfe(abgesagt)).toBe(false);
  });
});
