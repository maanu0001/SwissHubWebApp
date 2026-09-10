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
// A - Dashboard: der Stand vor dem Priorisierungs-Umbau
// ---------------------------------------------------------------------------

describe('Dashboard steht wieder auf dem Stand vor dem Umbau', () => {
  const seite = lies('apps/web/src/app/(app)/dashboard/page.tsx');

  it('zeigt die Kennzahlen wieder als eine Reihe gleichwertiger Karten', () => {
    // Der Umbau teilte sie in «wichtig» (Karte) und «Kontext» (Textzeile).
    // Zurueck zur Reihe: `auto-fit` laesst kein Loch, wenn eine Karte wegen
    // fehlender Berechtigung entfaellt.
    expect(seite).toContain('aria-label="Kennzahlen"');
    expect(seite).toContain('repeat(auto-fit,minmax(min(100%,15rem),1fr))');
    expect(seite).not.toContain('teileKennzahlen');
    expect(seite).not.toContain('kontext.map');
  });

  it('hat wieder genau die fünf Kennzahlkarten in ihrer alten Reihenfolge', () => {
    const reihenfolge = [
      'label="Mitglieder"',
      'label="Aktive Jails"',
      'label="Verifikationen offen"',
      'label="Bot Status"',
      'label="Aktionen heute"',
    ];
    let vorher = -1;
    for (const karte of reihenfolge) {
      const stelle = seite.indexOf(karte);
      expect(stelle, karte).toBeGreaterThan(vorher);
      vorher = stelle;
    }
  });

  it('führt die Schnellaktionen wieder als Panel in der rechten Spalte', () => {
    // Der Umbau hatte sie nach oben geholt und nach Dringlichkeit sortiert.
    expect(seite).toContain('<Panel title="Schnellaktionen" icon={<Zap />} bodyClassName="space-y-2 p-5">');
    expect(seite).toContain('hatSchnellaktionen');
    expect(seite).not.toContain('ordneAktionen');
  });

  it('behält jede Schnellaktion in ihrer alten Reihenfolge', () => {
    const reihenfolge = [
      'title="Warteschlange"',
      'title="Ticket erstellen"',
      'title="Spielersuche starten"',
      'title="Musik starten"',
      'title="Mitglied jailen"',
      'title="Mitglied suchen"',
      'title="Audit Log"',
      'title="Einstellungen"',
    ];
    let vorher = -1;
    for (const aktion of reihenfolge) {
      const stelle = seite.indexOf(aktion);
      expect(stelle, aktion).toBeGreaterThan(vorher);
      vorher = stelle;
    }
  });

  it('trägt die Module wieder in ihrem Panel', () => {
    expect(seite).toContain('title="Module"');
    expect(seite).toContain('sm:grid-cols-3 lg:grid-cols-5');
  });

  it('hat wieder das feste zweispaltige Raster', () => {
    expect(seite).toContain('<div className="grid gap-6 xl:grid-cols-3">');
    expect(seite).toContain('<div className="min-w-0 space-y-6 xl:col-span-2">');
  });

  it('trägt keine Begrüssung und keine Kontextzeile mehr', () => {
    // Beides kam mit dem Umbau; der frühere Stand begann mit den Kennzahlen.
    expect(seite).not.toContain('Willkommen zurück');
    expect(seite).not.toContain('Das hier braucht gerade deine Aufmerksamkeit');
  });

  it('hält keine zweite Dashboard-Logik mehr vor', () => {
    // Kein altes und neues Dashboard nebeneinander: die Priorisierung ist
    // vollständig entfallen, nicht nur ungenutzt liegen geblieben.
    expect(() => lies('apps/web/src/app/(app)/dashboard/prioritaet.ts')).toThrow();
  });

  it('zeichnet im Ladezustand wieder das, was danach kommt', () => {
    const laden = lies('apps/web/src/app/(app)/dashboard/loading.tsx');
    expect(laden).toContain('xl:grid-cols-4');
    expect(laden).toContain('h-28');
  });

  it('behält jede Kennzahl und jede Schnellaktion', () => {
    for (const text of [
      'Mitglieder',
      'Aktive Jails',
      'Verifikationen offen',
      'Bot Status',
      'Aktionen heute',
      'Warteschlange',
      'Ticket erstellen',
      'Spielersuche starten',
      'Musik starten',
      'Mitglied jailen',
      'Mitglied suchen',
      'Audit Log',
      'Einstellungen',
      'Nächste Events',
      'Letzte Aktivitäten',
    ]) {
      expect(seite, text).toContain(text);
    }
  });

  it('behält die Sichtbarkeit nach Berechtigungen unverändert', () => {
    for (const pruefung of [
      'canViewJails',
      'canCreateJail',
      'canReleaseJail',
      'canViewAudit',
      'canViewMembers',
      'canManageModules',
      'canViewSettings',
      'canViewModeration',
      'darfNutzen',
    ]) {
      expect(seite, pruefung).toContain(pruefung);
    }
  });
});

describe('Dashboard behält die funktionalen Verbesserungen', () => {
  it('teilt sich die Discord-Abfrage der Gilde weiterhin mit dem Grundlayout', () => {
    // Ein Performance-Fix von nach dem Referenzstand - er wird nicht
    // mitzurückgerollt.
    const laden = lies('apps/web/src/server/dashboard.ts');
    expect(laden).toContain('currentGuild()');
    expect(laden).not.toContain('discord.guild.get()');
  });

  it('lässt einen langen Modulnamen die Seite weiterhin nicht breiter machen', () => {
    // Ebenfalls ein Fix von nach dem Referenzstand: das alte Layout hatte
    // hier einen echten Ueberlauf, und den fuehren wir nicht wieder ein.
    const karte = lies('apps/web/src/components/shared/module-card.tsx');
    expect(karte).toContain('min-w-0');
    expect(karte).toContain('break-words');
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

// ---------------------------------------------------------------------------
// Kalender: die Liste heisst auf jedem Geraet dasselbe
// ---------------------------------------------------------------------------

describe('Kalender: eine Regel für alle Geräte', () => {
  const seite = lies('apps/web/src/app/(app)/kalender/page.tsx');
  const filter = lies('apps/web/src/modules/calendar/components/kalender-filter.tsx');

  it('entscheidet einmal, welche Abfrage läuft - nicht je Bildschirmgrösse', () => {
    // Die fachliche Regel steht an einer Stelle und kennt keinen Viewport:
    // Liste -> alle Events, Monat/Woche -> Zeitraum. Eine zweite Regel für
    // das Telefon gäbe es sonst genau hier.
    expect(seite).toContain("const istListe = query.view === 'agenda'");
    expect(seite).toContain('calendar.listAlleEvents(query, sicht, heute)');
    expect(seite).toContain('calendar.listEventsInRange(von, bis, query, sicht)');
  });

  it('rendert die Liste ohne Bildschirmweiche', () => {
    // Der Listenzweig steht vor der Weiche `md:hidden`/`hidden md:block` -
    // dieselben Daten, dieselbe Darstellung, auf jedem Gerät.
    const liste = seite.indexOf(') : istListe ? (');
    const weiche = seite.indexOf('md:hidden');
    expect(liste).toBeGreaterThan(0);
    expect(weiche).toBeGreaterThan(liste);
  });

  it('filtert die Liste nirgends noch einmal im Browser', () => {
    // Kein `.filter()` über den Zeitraum nach dem Laden - was die Liste
    // zeigt, hat der Server so geliefert.
    expect(seite).not.toContain('zeilen.filter((zeile) => zeile.startAt >= von');
    expect(seite).not.toContain('selectedRange');
    expect(seite).not.toContain('currentMonth');
  });

  it('macht die Ansichtsumschaltung auf dem Telefon erreichbar', () => {
    // Die Ursache: sie war `md:flex`. Auf dem Telefon erscheinen Monat und
    // Woche als Tagesliste - ohne Umschalter sah man eine Liste, änderte den
    // Zeitraum, und sie wurde kürzer. Das war die Monatsansicht, aber nichts
    // sagte das, und die echte Liste war nicht erreichbar.
    expect(filter).toContain('<div className="flex rounded-lg border border-border p-0.5">');
    expect(filter).not.toContain('hidden rounded-lg border border-border p-0.5 md:flex');
  });

  it('nennt die Monatsansicht auf dem Telefon nicht mehr «Terminliste»', () => {
    // Der Hinweis benannte die Monatsansicht als Liste - genau die
    // Verwechslung, über die der Fehler gemeldet wurde.
    expect(filter).not.toContain('Auf dem Telefon zeigt der Kalender die Terminliste');
    // Auf eine Wendung geprüft, die der Zeilenumbruch von Prettier nicht
    // zerlegt - der Satz selbst darf sich umbrechen.
    expect(filter).toContain('erscheint dieser Zeitraum als Tagesliste');
  });

  it('zeigt den Hinweis nur dort, wo der Zeitraum überhaupt wirkt', () => {
    const stelle = filter.indexOf('Auf dem Telefon erscheint dieser Zeitraum');
    expect(stelle).toBeGreaterThan(0);
    expect(filter.slice(Math.max(0, stelle - 400), stelle)).toContain('{zeitraumRelevant ? (');
  });

  it('blendet die Zeitraumsteuerung in der Liste auf jedem Gerät aus', () => {
    expect(seite).toContain('zeitraumRelevant={!istListe}');
    expect(filter).toContain('{zeitraumRelevant ? (');
  });

  it('behält Monat und Woche als eigene Ansichten', () => {
    // Nichts entfernt: auf dem Telefon erscheinen sie weiterhin als
    // Tagesliste, am Rechner als Raster.
    expect(seite).toContain('<Monatsansicht');
    expect(seite).toContain('<Wochenansicht');
    expect(filter).toContain("['month', 'Monat']");
    expect(filter).toContain("['week', 'Woche']");
    expect(filter).toContain("['agenda', 'Liste']");
  });
});
