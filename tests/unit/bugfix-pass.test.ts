import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendar } from '@swisshub/modules';

/**
 * Vier gemeldete Fehler, vier Ursachen.
 *
 * Diese Datei haelt die **Ursachen** fest, nicht ihre Symptome. Ein Test, der
 * nur pruefte «der Kalender oeffnet mit der Liste», bliebe gruen, wenn jemand
 * das Vorgabeverhalten an einer zweiten Stelle wieder ueberschreibt. Deshalb
 * steht hier jeweils die Bedingung, unter der der Fehler entstand.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

// ---------------------------------------------------------------------------
// A - Dashboard
// ---------------------------------------------------------------------------

describe('Dashboard: das Raster folgt dem Inhalt', () => {
  const seite = lies('apps/web/src/app/(app)/dashboard/page.tsx');

  it('macht die zweite Spalte von ihrem Inhalt abhängig', () => {
    // Ein Rasterfeld verschwindet nicht dadurch, dass sein Kind `null`
    // rendert: die leere Spalte belegte ihr Drittel, und der Inhalt links
    // wurde auf zwei Drittel gequetscht. Wer kein `audit.view` hat, sah
    // rechts ein Drittel Nichts.
    expect(seite).toContain("cn('grid gap-6', canViewAudit && 'xl:grid-cols-3')");
    expect(seite).toContain("cn('min-w-0 space-y-6', canViewAudit && 'xl:col-span-2')");
  });

  it('rendert die zweite Spalte gar nicht, wenn sie leer wäre', () => {
    // Die Bedingung steht jetzt um das Rasterkind, nicht darin.
    const stelle = seite.indexOf('{canViewAudit ? (\n          <div className="min-w-0 space-y-6">');
    expect(stelle).toBeGreaterThan(0);
  });

  it('hält den Hinweis der Mitgliederzahl inline', () => {
    // In der Kontextzeile steht dieser Hinweis zwischen zwei Klammern. Als
    // Blockelement erzwang er anonyme Blockboxen - die öffnende Klammer auf
    // einer Zeile, der Hinweis darunter, die schliessende wieder darunter.
    expect(seite).toContain('inline-flex items-center gap-1.5 align-middle');
    expect(seite).not.toContain('<span className="flex items-center gap-1.5">\n            online:');
  });

  it('lässt eine einzelne dringende Karte nicht über die ganze Breite laufen', () => {
    // `auto-fit` mit `1fr` füllt die Reihe restlos. Bei fünf Karten war das
    // richtig; bei einer - dem jetzt häufigen Fall - zieht es dieselbe Karte
    // über sechzehnhundert Pixel.
    expect(seite).toContain('<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">');
    expect(seite).not.toContain('repeat(auto-fit,minmax(min(100%,15rem),1fr))');
  });

  it('behält jede Kennzahl und jede Schnellaktion', () => {
    for (const text of [
      'Mitglieder',
      'Aktive Jails',
      'Verifikationen offen',
      'Aktionen heute',
      'Warteschlange',
      'Ticket erstellen',
      'Spielersuche starten',
      'Musik starten',
      'Mitglied jailen',
      'Mitglied suchen',
      'Audit Log',
      'Einstellungen',
    ]) {
      expect(seite, text).toContain(text);
    }
  });

  it('lässt einen langen Modulnamen die Seite nicht breiter machen', () => {
    // Rasterkinder haben von sich aus `min-width: auto`: ein Name, der nicht
    // in seine Spalte passt, liess die Spalte wachsen - und das ganze Raster
    // schob die Seite über den rechten Rand.
    const karte = lies('apps/web/src/components/shared/module-card.tsx');
    expect(karte).toContain('min-w-0');
    expect(karte).toContain('break-words');
  });

  it('drängt die Modulkacheln nicht zu früh in fünf Spalten', () => {
    expect(seite).toContain('sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5');
  });
});

// ---------------------------------------------------------------------------
// B - Kommunikation
// ---------------------------------------------------------------------------

describe('Kommunikation: der erste Klick wird sofort sichtbar', () => {
  it('hat eine Ladegrenze', () => {
    // Ohne sie hat Next nichts, was es waehrend des Renderns zeigen koennte:
    // der Browser bleibt auf der alten Seite stehen, bis der Server fertig
    // ist. Der Klick sah aus, als sei er ins Leere gegangen.
    expect(() => lies('apps/web/src/app/(app)/communication/loading.tsx')).not.toThrow();
    expect(() => lies('apps/web/src/app/(app)/communication/history/loading.tsx')).not.toThrow();
  });

  it('löst das mit demselben Mechanismus wie die übrigen Bereiche', () => {
    // Kein Kunstgriff an der Navigation - dieselbe Ladegrenze, die Dashboard,
    // Mitglieder, Moderation, Audit, Analytics und Profil bereits haben.
    for (const bereich of ['dashboard', 'members', 'moderation', 'audit', 'analytics', 'profile']) {
      expect(() => lies(`apps/web/src/app/(app)/${bereich}/loading.tsx`), bereich).not.toThrow();
    }
  });

  it('fasst die Discord-Abfrage der Gilde je Seitenaufruf zusammen', () => {
    // Grundlayout und Seite fragten unabhängig voneinander - zweimal warten
    // auf dieselbe Antwort, und jede Anfrage darf zehn Sekunden dauern und
    // wird bis zu dreimal wiederholt.
    const haken = lies('apps/web/src/server/guild.ts');
    expect(haken).toContain('cache(');
    expect(haken).toContain('discord.guild.get()');

    for (const datei of [
      'apps/web/src/app/(app)/layout.tsx',
      'apps/web/src/server/dashboard.ts',
      'apps/web/src/server/communication.ts',
    ]) {
      const quelle = lies(datei);
      expect(quelle, datei).toContain('currentGuild');
      expect(quelle, datei).not.toContain('discord.guild.get()');
    }
  });

  it('verliert die Warnung bei nicht erreichbarem Discord nicht', () => {
    // Ein Fehler ist kein leeres Ergebnis: fiele die Warnung weg, wäre
    // «Discord nicht erreichbar» im Protokoll nicht mehr von «niemand hat
    // gefragt» zu unterscheiden.
    expect(lies('apps/web/src/server/guild.ts')).toContain('log.warn(');
  });

  it('greift zu keinem Navigations-Kunstgriff', () => {
    const nav = lies('apps/web/src/components/layout/sidebar-nav.tsx');
    expect(nav).not.toContain('setTimeout');
    expect(nav).not.toContain('preventDefault');
    expect(nav).not.toContain('router.push');
    // Jeder Eintrag ist derselbe `<Link>` - Kommunikation hat keine
    // Sonderbehandlung. Genannt wird sie nur im Kommentar zum Pfadvergleich,
    // als Beispiel; einen Zweig im Code gibt es nicht.
    expect(nav).not.toContain("'/communication'");
    expect(nav).not.toContain("=== '/communication");
  });

  it('markiert den aktiven Eintrag über denselben Pfadvergleich wie alle', () => {
    const nav = lies('apps/web/src/components/layout/sidebar-nav.tsx');
    expect(nav).toContain('pathname === href || pathname.startsWith(`${href}/`)');
    expect(nav).toContain("aria-current={active ? 'page' : undefined}");
  });
});

// ---------------------------------------------------------------------------
// C - Profilbild
// ---------------------------------------------------------------------------

describe('Profilbild: Bild und Rand aus demselben Kasten', () => {
  const menue = lies('apps/web/src/components/layout/user-menu.tsx');
  const avatar = lies('apps/web/src/components/shared/discord-avatar.tsx');

  it('setzt den Ring an den Avatar statt um ihn herum', () => {
    // Ein `<span>` ist inline: seine Höhe kam aus der Zeilenhöhe, nicht vom
    // Kind. Der Ring lag damit um einen anderen Kasten als das Bild.
    expect(menue).toContain('className="ring-2 ring-primary/60"');
    expect(menue).not.toContain('<span className="rounded-full ring-2 ring-primary/40">');
  });

  it('lässt den Avatar seine Geometrie selbst bestimmen', () => {
    expect(avatar).toContain('rounded-full');
    expect(avatar).toContain('overflow-hidden');
    expect(avatar).toContain('style={{ width: size, height: size }}');
    expect(avatar).toContain('object-cover');
  });

  it('trägt nur noch einen Ring', () => {
    // `twMerge` löst `ring-1 ring-border` gegen `ring-2 ring-primary/60` auf -
    // die graue Linie zwischen Bild und Rand ist damit weg.
    expect(avatar).toContain('ring-1 ring-border');
    expect(menue).toContain('ring-2');
  });

  it('verschiebt beim Überfahren nichts', () => {
    // Der Rahmen ist immer da, nur durchsichtig - `hover:border` allein
    // hätte die Schaltfläche um zwei Pixel wachsen lassen.
    expect(menue).toContain('border border-transparent');
    expect(menue).toContain('hover:border-border');
  });
});

// ---------------------------------------------------------------------------
// D - Community-Kalender
// ---------------------------------------------------------------------------

describe('Kalender: die Liste ist die Vorgabe', () => {
  const parse = (roh: Record<string, unknown>) => calendar.calendarQuerySchema.parse(roh);

  it('öffnet ohne Parameter mit der Liste', () => {
    expect(parse({}).view).toBe('agenda');
    expect(parse({ view: undefined }).view).toBe('agenda');
  });

  it('versteht «list» und «calendar»', () => {
    expect(parse({ view: 'list' }).view).toBe('agenda');
    expect(parse({ view: 'calendar' }).view).toBe('month');
  });

  it('achtet dabei nicht auf Gross- und Kleinschreibung', () => {
    expect(parse({ view: 'List' }).view).toBe('agenda');
    expect(parse({ view: ' CALENDAR ' }).view).toBe('month');
  });

  it('bricht bestehende Verweise nicht', () => {
    expect(parse({ view: 'month' }).view).toBe('month');
    expect(parse({ view: 'week' }).view).toBe('week');
    expect(parse({ view: 'agenda' }).view).toBe('agenda');
  });

  it('fällt bei einem unbekannten Wert auf die Liste zurück, statt zu scheitern', () => {
    // Vorher warf `z.enum(...).parse('quatsch')` - `default` greift nur bei
    // einem fehlenden Wert. Die Seite zeigte dann ihre Fehlerseite statt des
    // Kalenders.
    expect(() => parse({ view: 'quatsch' })).not.toThrow();
    expect(parse({ view: 'quatsch' }).view).toBe('agenda');
    expect(parse({ view: '' }).view).toBe('agenda');
    expect(parse({ view: 42 }).view).toBe('agenda');
  });

  it('lässt die übrigen Filter unverändert', () => {
    const geprueft = parse({ view: 'list', mine: 'true', search: ' turnier ', categoryId: 'abc' });
    expect(geprueft.mine).toBe(true);
    expect(geprueft.search).toBe('turnier');
    expect(geprueft.categoryId).toBe('abc');
  });
});

describe('Kalender: Zeitraum und Liste sind entkoppelt', () => {
  const seite = lies('apps/web/src/app/(app)/kalender/page.tsx');
  const abfragen = lies('packages/modules/src/calendar/queries.ts');
  const filter = lies('apps/web/src/modules/calendar/components/kalender-filter.tsx');

  it('holt für die Liste alle Events statt eines Zeitraums', () => {
    expect(seite).toContain("const istListe = query.view === 'agenda'");
    expect(seite).toContain('calendar.listAlleEvents(query, sicht, heute)');
    expect(seite).toContain('calendar.listEventsInRange(von, bis, query, sicht)');
  });

  it('lässt die Kalenderansicht den Zeitraum weiterhin verwenden', () => {
    expect(abfragen).toContain('export async function listEventsInRange(');
    expect(abfragen).toContain('startAt: { gte: von, lt: bis }');
  });

  it('teilt sich mit der Kalenderansicht denselben Filter', () => {
    // Kategorie, Suche, «meine Events», Sichtbarkeit gelten in beiden. Eine
    // Kopie hätte beim nächsten neuen Filter an einer Stelle gefehlt.
    expect(abfragen).toContain('function grundFilter(');
    expect(abfragen).toContain('...grundFilter(guildId, query, options),');
    expect(abfragen).toContain('const filter = grundFilter(guildId, query, options);');
  });

  it('holt kommende und vergangene Events getrennt', () => {
    // Mit einer einzigen aufsteigenden Abfrage hätten dreihundert vergangene
    // Termine die kommenden aus der Obergrenze verdrängt - ausgerechnet die,
    // wegen derer man die Liste öffnet.
    expect(abfragen).toContain("orderBy: { startAt: 'asc' },\n      take: grenze,");
    expect(abfragen).toContain("orderBy: { startAt: 'desc' },\n      take: grenze,");
  });

  it('zeigt kommende Events vor vergangenen', () => {
    expect(abfragen).toContain('const events = [...kommend, ...vergangen];');
    expect(seite).toContain('Vergangene Events');
  });

  it('blendet die Zeitraumsteuerung in der Liste aus', () => {
    // Eine Steuerung, die sichtbar ist und nichts bewirkt, ist schlimmer als
    // keine: man klickt, nichts passiert, und sucht den Fehler bei sich.
    expect(seite).toContain('zeitraumRelevant={!istListe}');
    expect(filter).toContain('{zeitraumRelevant ? (');
  });

  it('behält die Ansichtsumschaltung und alle Filter', () => {
    for (const text of ["['month', 'Monat']", "['week', 'Woche']", "['agenda', 'Liste']"]) {
      expect(filter, text).toContain(text);
    }
    for (const text of ['Meine Events', 'Mit Anmeldung', 'Plätze frei', 'Event suchen ...']) {
      expect(filter, text).toContain(text);
    }
  });

  it('behält jede Event-Funktion der Seite', () => {
    for (const text of ['Event erstellen', '/kalender/verwaltung', '<EventKarte', '<Agendaansicht']) {
      expect(seite, text).toContain(text);
    }
  });
});
