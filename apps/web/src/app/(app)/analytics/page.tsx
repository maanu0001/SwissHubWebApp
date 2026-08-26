import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, Download, EyeOff, Info } from 'lucide-react';
import { z } from 'zod';
import { analytics, isModuleEnabled } from '@swisshub/modules';
import { formatDateTime, sanitizeText } from '@swisshub/shared';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { buttonVariants } from '@/components/ui/button';
import { requirePagePermission } from '@/server/auth';
import { analyticsAbilities, analyticsGuildId, analyticsSections } from '@/server/analytics';
import { AnalyticsFilters } from '@/modules/analytics/components/filters';
import { AnalyticsSectionNav } from '@/modules/analytics/components/section-nav';
import { EventRow } from '@/modules/analytics/components/event-row';
import { CATEGORIES, CATEGORY_LABEL } from '@/modules/analytics/labels';
import { cn } from '@/lib/utils';
import type { DiscordEventCategory } from '@swisshub/database';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const querySchema = z.object({
  kategorie: z
    .string()
    .optional()
    .transform((wert) =>
      wert && (CATEGORIES as string[]).includes(wert) ? (wert as DiscordEventCategory) : undefined,
    ),
  akteur: z
    .string()
    .max(30)
    .optional()
    .transform((wert) => (wert && /^\d{17,20}$/u.test(wert) ? wert : undefined)),
  betroffen: z
    .string()
    .max(30)
    .optional()
    .transform((wert) => (wert && /^\d{17,20}$/u.test(wert) ? wert : undefined)),
  suche: z
    .string()
    .max(100)
    .optional()
    .transform((wert) => (wert ? sanitizeText(wert, 100) : undefined)),
  von: z.string().max(10).optional(),
  bis: z.string().max(10).optional(),
  cursor: z
    .string()
    .max(40)
    .optional()
    .transform((wert) => (wert ? sanitizeText(wert, 40) : undefined)),
});

function alsDatum(wert: string | undefined, endeDesTages = false): Date | undefined {
  if (!wert || !/^\d{4}-\d{2}-\d{2}$/u.test(wert)) {
    return undefined;
  }
  const datum = new Date(`${wert}T${endeDesTages ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(datum.getTime()) ? undefined : datum;
}

/**
 * Die Zeitleiste der Server-Ereignisse.
 *
 * Wer keine Berechtigung für Nachrichteninhalte hat, sieht die Ereignisse
 * trotzdem - nur ohne Text. Das ist Absicht: «wer hat wann was gelöscht» und
 * «was stand darin» sind verschieden schwere Auskünfte. Die Trennung ist
 * nicht kosmetisch: die Textspalten werden gar nicht erst aus der Datenbank
 * geladen.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(analytics.ANALYTICS_PERMISSIONS.view);
  const query = querySchema.parse(await searchParams);
  const abilities = analyticsAbilities(context);

  const sections = analyticsSections(context);

  const aktiv = await isModuleEnabled(analytics.ANALYTICS_MODULE_ID);
  if (!aktiv) {
    return (
      <>
        <AnalyticsSectionNav sections={sections} />
        <EmptyState
          title="Analytics ist nicht aktiviert"
          description="Solange das Modul aus ist, wird nichts aufgezeichnet. Es lässt sich unter Module einschalten."
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
  const [seite, kennzahlen] = await Promise.all([
    analytics.timeline({
      guildId,
      category: query.kategorie ? [query.kategorie] : undefined,
      actorDiscordId: query.akteur,
      subjectDiscordId: query.betroffen,
      suche: query.suche,
      von: alsDatum(query.von),
      bis: alsDatum(query.bis, true),
      cursor: query.cursor,
      pageSize: PAGE_SIZE,
      mitInhalten: abilities.content,
    }),
    analytics.analyticsStats(guildId),
  ]);

  const parameter = {
    kategorie: query.kategorie,
    akteur: query.akteur,
    betroffen: query.betroffen,
    suche: query.suche,
    von: query.von,
    bis: query.bis,
  };

  const mitCursor = (cursor: string): string => {
    const suche = new URLSearchParams();
    for (const [schluessel, wert] of Object.entries(parameter)) {
      if (wert) {
        suche.set(schluessel, wert);
      }
    }
    suche.set('cursor', cursor);
    return `/analytics?${suche.toString()}`;
  };

  const exportHref = (): string => {
    const suche = new URLSearchParams();
    for (const [schluessel, wert] of Object.entries(parameter)) {
      if (wert) {
        suche.set(schluessel, wert);
      }
    }
    const abfrage = suche.toString();
    return abfrage ? `/api/analytics/export?${abfrage}` : '/api/analytics/export';
  };

  return (
    <>
      <AnalyticsSectionNav sections={sections} />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
        <StatCard
          label="Ereignisse heute"
          value={kennzahlen.heute}
          icon={<Activity aria-hidden="true" />}
          hint={`${kennzahlen.gesamt.toLocaleString('de-CH')} insgesamt`}
        />
        {kennzahlen.proKategorie.slice(0, 3).map((eintrag) => (
          <StatCard key={eintrag.category} label={CATEGORY_LABEL[eintrag.category]} value={eintrag.anzahl} />
        ))}
      </div>

      {kennzahlen.aeltestes ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Ältester Eintrag: {formatDateTime(kennzahlen.aeltestes)}. Was älter ist als die
            Aufbewahrungsfrist, wird automatisch gelöscht.
          </span>
        </p>
      ) : null}

      {abilities.content ? null : (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-4 py-2.5 text-sm text-muted-foreground">
          <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Nachrichteninhalte werden dir nicht angezeigt. Du siehst, dass etwas geschehen ist, nicht was
            darin stand.
          </span>
        </p>
      )}

      <AnalyticsFilters
        kategorie={query.kategorie ?? ''}
        akteur={query.akteur ?? ''}
        betroffen={query.betroffen ?? ''}
        suche={query.suche ?? ''}
        von={query.von ?? ''}
        bis={query.bis ?? ''}
        mitInhalten={abilities.content}
        aktion={
          abilities.export ? (
            <a href={exportHref()} className={cn(buttonVariants({ variant: 'outline' }))} download>
              <Download aria-hidden="true" />
              CSV
            </a>
          ) : null
        }
      />

      {seite.zeilen.length === 0 ? (
        <EmptyState title="Keine Ereignisse" description="Für diese Auswahl ist nichts aufgezeichnet." />
      ) : (
        <ol className="divide-y divide-border/60 rounded-xl border border-border bg-card">
          {seite.zeilen.map((zeile) => (
            <EventRow key={zeile.id} event={zeile} mitInhalten={abilities.content} />
          ))}
        </ol>
      )}

      {seite.naechsterCursor ? (
        <div className="flex justify-center">
          <Link
            href={mitCursor(seite.naechsterCursor)}
            className={cn(buttonVariants({ variant: 'outline' }))}
            rel="next"
          >
            Weitere {PAGE_SIZE} laden
          </Link>
        </div>
      ) : null}
    </>
  );
}
