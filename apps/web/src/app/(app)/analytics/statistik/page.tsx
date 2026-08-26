import type { Metadata } from 'next';
import Link from 'next/link';
import { Download, Info } from 'lucide-react';
import { z } from 'zod';
import { analytics, isModuleEnabled } from '@swisshub/modules';
import { formatDate } from '@swisshub/shared';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { buttonVariants } from '@/components/ui/button';
import { requirePagePermission } from '@/server/auth';
import { analyticsAbilities, analyticsGuildId, analyticsSections } from '@/server/analytics';
import { AnalyticsSectionNav } from '@/modules/analytics/components/section-nav';
import { PeriodPicker } from '@/modules/analytics/components/period-picker';
import { KpiCard } from '@/modules/analytics/components/kpi-card';
import {
  BalkenDiagramm,
  HeatmapRaster,
  Legende,
  LinienDiagramm,
  type Reihe,
} from '@/modules/analytics/components/charts';
import { dauer, prozent, spanne, spitzenzeit, stunden, zahl } from '@/modules/analytics/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Statistik' };
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  zeitraum: z.string().max(10).optional(),
  von: z.string().max(10).optional(),
  bis: z.string().max(10).optional(),
});

/**
 * Die Statistik des Servers.
 *
 * Sie soll in wenigen Sekunden vier Fragen beantworten: Wächst die
 * Gemeinschaft? Ist mehr los als im Zeitraum davor? Wie viele Mitglieder
 * nutzen den Server wirklich? Wann ist am meisten los?
 *
 * Alles liest aus den Aggregaten, nie aus der Ereignistabelle - deshalb
 * bleibt die Seite auch bei Millionen Ereignissen schnell.
 */
export default async function StatistikPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(analytics.ANALYTICS_PERMISSIONS.statisticsView);
  const query = querySchema.parse(await searchParams);
  const abilities = analyticsAbilities(context);
  const sections = analyticsSections(context);

  if (!(await isModuleEnabled(analytics.ANALYTICS_MODULE_ID))) {
    return (
      <>
        <AnalyticsSectionNav sections={sections} />
        <EmptyState
          title="Analytics ist nicht aktiviert"
          description="Solange das Modul aus ist, wird nichts gezählt - und ohne Zählung gibt es keine Statistik."
          action={
            <Link href="/modules" className={cn(buttonVariants({ variant: 'outline' }))}>
              Zu den Modulen
            </Link>
          }
        />
      </>
    );
  }

  const guildId = await analyticsGuildId();
  const stand = await analytics.trackingStand(guildId);
  const zeitraum = analytics.aufloesen({
    id: query.zeitraum,
    von: query.von,
    bis: query.bis,
    datenBeginn: stand?.startedAt ?? null,
  });

  const einstellungen = await analytics.statistik.statistikEinstellungen();
  const scope = { guildId, zeitraum, mitBots: einstellungen.mitBots };

  const [
    lage,
    zahlen,
    heuteWerte,
    punkte,
    topText,
    topVoice,
    textKanaele,
    voiceKanaele,
    bild,
    art,
    neu,
    wieder,
  ] = await Promise.all([
    analytics.statistik.datenlage(guildId, zeitraum),
    analytics.statistik.kennzahlen(scope),
    analytics.statistik.heute(guildId, einstellungen.mitBots),
    analytics.statistik.verlauf(scope),
    analytics.statistik.topMitglieder(scope, 'messages'),
    analytics.statistik.topMitglieder(scope, 'voice'),
    analytics.statistik.topKanaele(scope, 'TEXT'),
    analytics.statistik.topKanaele(scope, 'VOICE'),
    analytics.statistik.heatmap(scope),
    analytics.statistik.nutzungsart(scope),
    analytics.statistik.neueMitglieder(scope),
    analytics.statistik.wiederkehrende(scope),
  ]);

  if (lage.leer) {
    return (
      <>
        <AnalyticsSectionNav sections={sections} />
        <EmptyState
          title="Die Zählung hat gerade erst begonnen"
          description="Analytics sammelt ab jetzt Daten. Aussagekräftige Trends entstehen mit zunehmender Nutzungsdauer - schau in ein paar Tagen wieder vorbei."
        />
      </>
    );
  }

  /** Übernimmt den gewählten Zeitraum in den Export - sonst exportierte er etwas anderes, als die Seite zeigt. */
  const exportHref = (art: string): string => {
    const parameter = new URLSearchParams({ art });
    if (query.zeitraum) {
      parameter.set('zeitraum', query.zeitraum);
    }
    if (query.von) {
      parameter.set('von', query.von);
    }
    if (query.bis) {
      parameter.set('bis', query.bis);
    }
    return `/api/analytics/statistik-export?${parameter.toString()}`;
  };

  const labels = punkte.map((punkt) => punkt.label);
  const aktivitaetsReihen: Reihe[] = [
    {
      id: 'nachrichten',
      label: 'Nachrichten',
      werte: punkte.map((punkt) => punkt.nachrichten),
      farbe: 'text-primary',
    },
    {
      id: 'sprache',
      label: 'Sprachstunden',
      werte: punkte.map((punkt) => Math.round(punkt.sprachSekunden / 3600)),
      farbe: 'text-success',
    },
  ];
  const wachstumsReihen: Reihe[] = [
    { id: 'beitritte', label: 'Beitritte', werte: punkte.map((p) => p.beitritte), farbe: 'text-success' },
    { id: 'austritte', label: 'Austritte', werte: punkte.map((p) => p.austritte), farbe: 'text-destructive' },
  ];
  const mitgliederPunkte = punkte.filter((punkt) => punkt.mitglieder !== null);

  return (
    <>
      <AnalyticsSectionNav sections={sections} />

      <PeriodPicker
        aktiv={zeitraum.id}
        von={query.von ?? ''}
        bis={query.bis ?? ''}
        vergleich={
          zeitraum.vergleichVon && zeitraum.vergleichBis
            ? `${formatDate(zeitraum.vergleichVon)} bis ${formatDate(zeitraum.vergleichBis)}`
            : null
        }
      />

      {/* Die wichtigste Auskunft der Seite: was die Zahlen überhaupt abdecken. */}
      <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-4 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {lage.seit
            ? `Daten werden seit ${formatDate(lage.seit)} erfasst.`
            : 'Die Zählung hat gerade begonnen.'}
          {lage.nachrichtenSeit && lage.seit && lage.nachrichtenSeit > lage.seit
            ? ` Nachrichten seit ${formatDate(lage.nachrichtenSeit)}.`
            : ''}
          {lage.unvollstaendig
            ? ' Der gewählte Zeitraum reicht weiter zurück - für die Zeit davor liegen keine Daten vor.'
            : ''}
        </span>
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Überblick</h2>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
          <KpiCard
            label="Mitglieder"
            wert={zahlen.mitglieder === null ? '–' : zahl(zahlen.mitglieder)}
            hinweis={zahlen.mitglieder === null ? 'Noch keine Mitgliederzahl erfasst' : 'Letzter Stand'}
          />
          <KpiCard
            label="Nachrichten"
            wert={zahl(zahlen.nachrichten.wert)}
            veraenderung={zahlen.nachrichten}
            hinweis={`${zahl(zahlen.nachrichtenProTag ?? 0)} pro Tag`}
          />
          <KpiCard
            label="Sprachzeit"
            wert={stunden(zahlen.sprachSekunden.wert)}
            veraenderung={zahlen.sprachSekunden}
            hinweis={`${zahl(zahlen.sprachSitzungen.wert)} Sitzungen`}
          />
          <KpiCard
            label="Neue Mitglieder"
            wert={zahl(zahlen.neueMitglieder.wert)}
            veraenderung={zahlen.neueMitglieder}
            hinweis={`Netto ${zahlen.nettoWachstum.wert >= 0 ? '+' : ''}${zahl(zahlen.nettoWachstum.wert)}`}
          />
          <KpiCard
            label="Aktive Mitglieder"
            wert={zahl(zahlen.aktiveMitglieder.wert)}
            veraenderung={zahlen.aktiveMitglieder}
            hinweis={
              zahlen.aktivenAnteil === null
                ? 'Anteil unbekannt'
                : `${prozent(zahlen.aktivenAnteil)} aller Mitglieder`
            }
          />
          <KpiCard
            label="Austritte"
            wert={zahl(zahlen.austritte.wert)}
            veraenderung={zahlen.austritte}
            anstiegIstGut={false}
            hinweis={
              zahlen.beitrittsVerhaeltnis === null
                ? 'Zu wenige für ein Verhältnis'
                : `${zahlen.beitrittsVerhaeltnis.toLocaleString('de-CH')} : 1 Beitritte zu Austritten`
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Heute</h2>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]">
          <KpiCard label="Nachrichten heute" wert={zahl(heuteWerte.nachrichten)} />
          <KpiCard label="Sprachzeit heute" wert={stunden(heuteWerte.sprachSekunden)} />
          <KpiCard label="Aktiv heute" wert={zahl(heuteWerte.aktive)} />
          <KpiCard
            label="Gerade im Sprachkanal"
            wert={zahl(heuteWerte.imSprachkanal)}
            hinweis="Laufende Anwesenheit"
          />
        </div>
      </section>

      <Panel title="Aktivität über Zeit" description={zeitraum.label} className="min-w-0">
        <div className="space-y-3">
          <Legende reihen={aktivitaetsReihen} />
          <LinienDiagramm
            reihen={aktivitaetsReihen}
            labels={labels}
            beschreibung={`Nachrichten und Sprachstunden im Zeitraum ${zeitraum.label}`}
          />
        </div>
      </Panel>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="Mitgliederentwicklung" description="Letzter bekannter Stand je Tag">
          {mitgliederPunkte.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Mitgliederzahlen erfasst. Sie werden stündlich festgehalten, sobald der Bot läuft.
            </p>
          ) : (
            <LinienDiagramm
              reihen={[
                {
                  id: 'mitglieder',
                  label: 'Mitglieder',
                  werte: mitgliederPunkte.map((punkt) => punkt.mitglieder ?? 0),
                  farbe: 'text-primary',
                },
              ]}
              labels={mitgliederPunkte.map((punkt) => punkt.label)}
              hoehe={180}
              // Ein Bestand, keine Menge: die Achse liegt um die Werte, sonst
              // sähe jede Mitgliederkurve wie eine Gerade am oberen Rand aus.
              nullpunkt="daten"
              beschreibung="Mitgliederzahl über Zeit"
            />
          )}
        </Panel>

        <Panel title="Beitritte und Austritte" description={`Netto ${zahl(zahlen.nettoWachstum.wert)}`}>
          <div className="space-y-3">
            <Legende reihen={wachstumsReihen} />
            <BalkenDiagramm
              labels={labels}
              reihen={wachstumsReihen}
              hoehe={180}
              beschreibung="Beitritte und Austritte über Zeit"
            />
          </div>
        </Panel>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="Top 10 – Nachrichten" bodyClassName="p-0">
          <Rangliste eintraege={topText} art="messages" />
        </Panel>
        <Panel title="Top 10 – Sprachzeit" bodyClassName="p-0">
          <Rangliste eintraege={topVoice} art="voice" />
        </Panel>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="Top Textkanäle" bodyClassName="p-0">
          <KanalListe eintraege={textKanaele} art="TEXT" />
        </Panel>
        <Panel title="Top Sprachkanäle" bodyClassName="p-0">
          <KanalListe eintraege={voiceKanaele} art="VOICE" />
        </Panel>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Aktivitätszeiten
        </h2>
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Panel
            title="Nachrichten"
            description={`Spitze: ${spitzenzeit(bild.spitzeNachrichten)}`}
            className="min-w-0"
          >
            <HeatmapRaster
              zellen={bild.zellen.map((zelle) => ({ ...zelle, wert: zelle.nachrichten }))}
              max={bild.maxNachrichten}
              formatWert={(wert) => `${zahl(wert)} Nachrichten`}
              beschreibung="Nachrichten nach Wochentag und Stunde"
            />
          </Panel>
          <Panel
            title="Sprachkanäle"
            description={`Spitze: ${spitzenzeit(bild.spitzeSprache)}`}
            className="min-w-0"
          >
            <HeatmapRaster
              zellen={bild.zellen.map((zelle) => ({ ...zelle, wert: zelle.sprachSekunden }))}
              max={bild.maxSprachSekunden}
              formatWert={(wert) => dauer(wert)}
              beschreibung="Sprachzeit nach Wochentag und Stunde"
            />
          </Panel>
        </div>
        <p className="text-xs text-muted-foreground">
          Wochentag und Uhrzeit in Schweizer Zeit (Europe/Zurich).
        </p>
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Panel title="Wie wird der Server genutzt?" description={zeitraum.label}>
          <Nutzung art={art} />
        </Panel>

        <Panel title="Neue Mitglieder" description="Aktivierung und Bindung">
          <NeueMitglieder daten={neu} wieder={wieder} />
        </Panel>
      </div>

      {abilities.export ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Export
          </h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['verlauf', 'Tagesverlauf'],
                ['mitglieder', 'Mitglieder-Rangliste'],
                ['kanaele', 'Kanal-Rangliste'],
                ['wachstum', 'Mitgliederwachstum'],
              ] as const
            ).map(([art, label]) => (
              <a
                key={art}
                href={exportHref(art)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                download
              >
                <Download aria-hidden="true" />
                {label}
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Jeder Export wird im Audit Log vermerkt - er trägt Daten aus dem System heraus.
          </p>
        </section>
      ) : null}
    </>
  );
}

function Rangliste({
  eintraege,
  art,
}: {
  eintraege: analytics.statistik.RanglisteEintrag[];
  art: 'messages' | 'voice';
}): React.JSX.Element {
  if (eintraege.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Noch keine Aktivität"
        description="Für diesen Zeitraum ist nichts gezählt."
      />
    );
  }
  return (
    <ol className="divide-y divide-border/60">
      {eintraege.map((eintrag, index) => (
        <li key={eintrag.discordId} className="flex items-center gap-3 px-5 py-2.5">
          <span className="w-5 shrink-0 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
          <DiscordAvatar
            discordId={eintrag.discordId}
            avatarHash={eintrag.avatarHash}
            name={eintrag.displayName ?? eintrag.username ?? eintrag.discordId}
            size={28}
          />
          <Link
            href={`/members/${eintrag.discordId}`}
            className="min-w-0 flex-1 truncate text-sm hover:underline"
          >
            {/* Erst der Anzeigename, dann der Benutzername - und erst wenn
                beides fehlt, die Kennung. Das passiert nur bei Personen, die
                seit der Umstellung nichts mehr geschrieben haben. */}
            {eintrag.displayName ?? eintrag.username ?? eintrag.discordId}
          </Link>
          <span className="shrink-0 text-right text-sm tabular-nums">
            {art === 'messages' ? zahl(eintrag.nachrichten) : dauer(eintrag.sprachSekunden)}
            <span className="ml-2 text-xs text-muted-foreground">{prozent(eintrag.anteil)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function KanalListe({
  eintraege,
  art,
}: {
  eintraege: analytics.statistik.KanalEintrag[];
  art: 'TEXT' | 'VOICE';
}): React.JSX.Element {
  if (eintraege.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Noch keine Aktivität"
        description="Für diesen Zeitraum ist nichts gezählt."
      />
    );
  }
  return (
    <ol className="divide-y divide-border/60">
      {eintraege.map((eintrag) => (
        <li key={eintrag.channelId} className="flex items-center gap-3 px-5 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">
            {art === 'TEXT' ? '#' : ''}
            {eintrag.channelName ?? eintrag.channelId}
          </span>
          {eintrag.veraenderung.prozent !== null && eintrag.veraenderung.richtung !== 'gleich' ? (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                eintrag.veraenderung.richtung === 'auf' ? 'text-success' : 'text-warning',
              )}
            >
              {eintrag.veraenderung.prozent > 0 ? '+' : ''}
              {eintrag.veraenderung.prozent.toLocaleString('de-CH')} %
            </span>
          ) : null}
          <span className="shrink-0 text-right text-sm tabular-nums">
            {art === 'TEXT' ? zahl(eintrag.nachrichten) : dauer(eintrag.sprachSekunden)}
            <span className="ml-2 text-xs text-muted-foreground">{prozent(eintrag.anteil)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Nutzung({ art }: { art: analytics.statistik.Nutzungsart }): React.JSX.Element {
  const aktive = art.nurText + art.nurSprache + art.beides;
  if (aktive === 0) {
    return (
      <p className="text-sm text-muted-foreground">Für diesen Zeitraum ist niemand als aktiv gezählt.</p>
    );
  }
  const zeilen = [
    { label: 'Nur Text', wert: art.nurText, farbe: 'bg-primary' },
    { label: 'Nur Sprache', wert: art.nurSprache, farbe: 'bg-success' },
    { label: 'Text und Sprache', wert: art.beides, farbe: 'bg-warning' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        {zeilen.map((zeile) => (
          <span
            key={zeile.label}
            className={zeile.farbe}
            style={{ width: `${(zeile.wert / aktive) * 100}%` }}
          />
        ))}
      </div>
      <ul className="space-y-1.5 text-sm">
        {zeilen.map((zeile) => (
          <li key={zeile.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className={cn('size-2.5 shrink-0 rounded-sm', zeile.farbe)} aria-hidden="true" />
              <span className="truncate">{zeile.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {zahl(zeile.wert)}
              <span className="ml-2 text-xs text-muted-foreground">
                {prozent(Math.round((zeile.wert / aktive) * 1000) / 10)}
              </span>
            </span>
          </li>
        ))}
        {art.inaktiv === null ? null : (
          <li className="flex items-center justify-between gap-3 border-t border-border/60 pt-1.5 text-muted-foreground">
            <span>Ohne Aktivität</span>
            <span className="tabular-nums">{zahl(art.inaktiv)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

function NeueMitglieder({
  daten,
  wieder,
}: {
  daten: analytics.statistik.NeuMitglieder;
  wieder: analytics.statistik.Wiederkehrende | null;
}): React.JSX.Element {
  return (
    <dl className="space-y-2.5 text-sm">
      <Zeile label="Beigetreten" wert={zahl(daten.beigetreten)} />
      <Zeile
        label="Davon aktiv geworden"
        wert={`${zahl(daten.aktiviert)}${daten.aktivierungsQuote === null ? '' : ` · ${prozent(daten.aktivierungsQuote)}`}`}
        hinweis={
          daten.aktivierungsQuote === null
            ? 'Für eine Quote sind es noch zu wenige'
            : 'Erste Nachricht oder Sprachsitzung innerhalb von sieben Tagen'
        }
      />
      <Zeile
        label="Zeit bis zur ersten Äusserung"
        wert={spanne(daten.zeitBisAktivitaet)}
        hinweis={daten.zeitBisAktivitaet === null ? 'Noch zu wenige Daten' : 'Durchschnitt'}
      />
      {daten.bindung.map((eintrag) => (
        <Zeile
          key={eintrag.tage}
          label={`Noch da nach ${eintrag.tage} Tagen`}
          wert={eintrag.quote === null ? '–' : prozent(eintrag.quote)}
          hinweis={
            eintrag.quote === null
              ? 'Kohorte noch zu klein'
              : `${zahl(eintrag.geblieben)} von ${zahl(eintrag.kohorte)}`
          }
        />
      ))}
      {wieder ? (
        <Zeile
          label="Wiederkehrend aktiv"
          wert={`${zahl(wieder.wiederkehrend)}${wieder.quote === null ? '' : ` · ${prozent(wieder.quote)}`}`}
          hinweis={`${zahl(wieder.neuAktiv)} neu aktiv gegenüber dem Zeitraum davor`}
        />
      ) : null}
    </dl>
  );
}

function Zeile({
  label,
  wert,
  hinweis,
}: {
  label: string;
  wert: string;
  hinweis?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <dt className="min-w-0 text-muted-foreground">
        {label}
        {hinweis ? <span className="block text-xs opacity-80">{hinweis}</span> : null}
      </dt>
      <dd className="shrink-0 tabular-nums">{wert}</dd>
    </div>
  );
}
