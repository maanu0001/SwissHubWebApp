import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_kalender_liste');

/**
 * Die Listenansicht des Kalenders.
 *
 * Sie ist die Gesamtuebersicht: **alle** Termine, unabhaengig davon, welcher
 * Monat oben eingestellt ist. Das laesst sich nur gegen eine echte Datenbank
 * pruefen - die entscheidenden Fragen sind, ob die Trennung in «kommend» und
 * «vergangen» am Rand richtig faellt und ob eine der beiden Haelften die
 * andere aus der Obergrenze verdraengen kann.
 */
const { prisma } = await import('@swisshub/database');
const { calendar, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000410', username: 'verwaltung' };
const KANAL = '900000000000000410';

const eingabe = (overrides: Record<string, unknown> = {}) =>
  calendar.eventInputSchema.parse({
    title: 'Community Gaming Night',
    description: 'Wir zocken zusammen.',
    startAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
    ...overrides,
  });

/** Ein veroeffentlichter Termin zu einem bestimmten Zeitpunkt. */
async function termin(titel: string, startAt: Date, extra: Record<string, unknown> = {}): Promise<string> {
  const event = await calendar.createEvent(
    ADMIN,
    eingabe({ title: titel, startAt: startAt.toISOString(), ...extra }),
  );
  await calendar.publishEvent(ADMIN, event.id);
  return event.id;
}

const TAG = 24 * 3600_000;

describeWithDatabase('Kalender: Listenansicht', () => {
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

  it('zeigt Termine aus Vergangenheit, Gegenwart und Zukunft zusammen', async () => {
    // Der Kern der Anforderung: die Liste haengt nicht am gewaehlten Monat.
    const langeHer = new Date(Date.now() - 200 * TAG);
    const letzterMonat = new Date(Date.now() - 35 * TAG);
    const bald = new Date(Date.now() + 2 * TAG);
    const naechstesJahr = new Date(Date.now() + 400 * TAG);

    const ids = [
      await termin('Sehr alt', langeHer),
      await termin('Letzter Monat', letzterMonat),
      await termin('Bald', bald),
      await termin('Nächstes Jahr', naechstesJahr),
    ];

    const zeilen = await calendar.listAlleEvents({}, {});
    expect(zeilen.map((zeile) => zeile.id).sort()).toEqual([...ids].sort());
  });

  it('stellt kommende Termine vor die vergangenen', async () => {
    await termin('Vergangen', new Date(Date.now() - 10 * TAG));
    await termin('Kommend', new Date(Date.now() + 10 * TAG));

    const titel = (await calendar.listAlleEvents({}, {})).map((zeile) => zeile.title);
    expect(titel).toEqual(['Kommend', 'Vergangen']);
  });

  it('sortiert die kommenden aufsteigend', async () => {
    await termin('In zwanzig Tagen', new Date(Date.now() + 20 * TAG));
    await termin('Morgen', new Date(Date.now() + 1 * TAG));
    await termin('In fünf Tagen', new Date(Date.now() + 5 * TAG));

    const titel = (await calendar.listAlleEvents({}, {})).map((zeile) => zeile.title);
    expect(titel).toEqual(['Morgen', 'In fünf Tagen', 'In zwanzig Tagen']);
  });

  it('sortiert die vergangenen mit dem jüngsten voran', async () => {
    // Wer zurückschaut, sucht meist das Letzte - nicht das Erste.
    await termin('Vor hundert Tagen', new Date(Date.now() - 100 * TAG));
    await termin('Gestern', new Date(Date.now() - 1 * TAG));
    await termin('Vor zehn Tagen', new Date(Date.now() - 10 * TAG));

    const titel = (await calendar.listAlleEvents({}, {})).map((zeile) => zeile.title);
    expect(titel).toEqual(['Gestern', 'Vor zehn Tagen', 'Vor hundert Tagen']);
  });

  it('zählt einen laufenden Termin zu den kommenden', async () => {
    // Er hat begonnen und ist noch nicht vorbei - unter «vergangen» wäre er
    // falsch einsortiert, und zwar genau dann, wenn er am wichtigsten ist.
    const laeuft = await termin('Läuft gerade', new Date(Date.now() - 3600_000), {
      endAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await termin('Vorbei', new Date(Date.now() - 10 * TAG));

    const zeilen = await calendar.listAlleEvents({}, {});
    expect(zeilen[0]?.id).toBe(laeuft);
  });

  it('zählt einen begonnenen Termin ohne Endzeit zu den vergangenen', async () => {
    // Ohne Endzeit ist ein Termin vorbei, sobald er begonnen hat - dieselbe
    // Regel wie im Zeitraumfilter.
    await termin('Ohne Ende, begonnen', new Date(Date.now() - 3600_000));
    await termin('Kommt noch', new Date(Date.now() + 3600_000));

    const titel = (await calendar.listAlleEvents({}, {})).map((zeile) => zeile.title);
    expect(titel).toEqual(['Kommt noch', 'Ohne Ende, begonnen']);
  });

  it('lässt vergangene Termine die kommenden nicht aus der Obergrenze verdrängen', async () => {
    // Der Grund für zwei Abfragen statt einer: aufsteigend sortiert und
    // gemeinsam begrenzt hätten die alten die neuen abgeschnitten -
    // ausgerechnet die, wegen derer man die Liste öffnet.
    for (let index = 0; index < 5; index += 1) {
      await termin(`Alt ${index}`, new Date(Date.now() - (index + 1) * TAG));
    }
    const kommend = await termin('Der kommende', new Date(Date.now() + TAG));

    const zeilen = await calendar.listAlleEvents({}, {}, new Date(), 2);
    expect(zeilen.map((zeile) => zeile.id)).toContain(kommend);
    expect(zeilen[0]?.id).toBe(kommend);
  });

  it('hält sich an dieselbe Sichtbarkeit wie die Kalenderansicht', async () => {
    // Ein Entwurf ist für gewöhnliche Mitglieder nicht vorhanden - auch
    // nicht über die Liste.
    const entwurf = await calendar.createEvent(ADMIN, eingabe({ title: 'Entwurf' }));

    const fuerMitglieder = await calendar.listAlleEvents({}, {});
    const fuerVerwaltung = await calendar.listAlleEvents({}, { includeDrafts: true });

    expect(fuerMitglieder.map((zeile) => zeile.id)).not.toContain(entwurf.id);
    expect(fuerVerwaltung.map((zeile) => zeile.id)).toContain(entwurf.id);
  });

  it('wendet dieselbe Textsuche an wie die Kalenderansicht', async () => {
    await termin('Turnierabend', new Date(Date.now() + TAG));
    await termin('Filmabend', new Date(Date.now() + 2 * TAG));

    const treffer = await calendar.listAlleEvents({ search: 'turnier' }, {});
    expect(treffer.map((zeile) => zeile.title)).toEqual(['Turnierabend']);
  });

  it('wendet den Kategoriefilter an', async () => {
    const kategorie = await calendar.saveCategory(ADMIN, {
      name: 'Turniere',
      color: '#ff0000',
    } as Parameters<typeof calendar.saveCategory>[1]);
    await termin('Mit Kategorie', new Date(Date.now() + TAG), { categoryId: kategorie.id });
    await termin('Ohne Kategorie', new Date(Date.now() + 2 * TAG));

    const treffer = await calendar.listAlleEvents({ categoryId: kategorie.id }, {});
    expect(treffer.map((zeile) => zeile.title)).toEqual(['Mit Kategorie']);
  });

  it('gibt eine leere Liste zurück, wenn es nichts gibt', async () => {
    expect(await calendar.listAlleEvents({}, {})).toEqual([]);
  });

  it('lässt die Kalenderansicht unverändert am Zeitraum hängen', async () => {
    // Die Gegenprobe: was die Liste absichtlich ignoriert, muss dort
    // weiterhin wirken.
    const weitWeg = await termin('Nächstes Jahr', new Date(Date.now() + 400 * TAG));
    const bald = await termin('Bald', new Date(Date.now() + TAG));

    const imAusschnitt = await calendar.listEventsInRange(
      new Date(Date.now() - TAG),
      new Date(Date.now() + 30 * TAG),
      {},
      {},
    );
    expect(imAusschnitt.map((zeile) => zeile.id)).toContain(bald);
    expect(imAusschnitt.map((zeile) => zeile.id)).not.toContain(weitWeg);

    const inDerListe = await calendar.listAlleEvents({}, {});
    expect(inDerListe.map((zeile) => zeile.id)).toContain(weitWeg);
  });
});
