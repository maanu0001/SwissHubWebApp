import type { Metadata } from 'next';
import Link from 'next/link';
import { isModuleEnabled, verification } from '@swisshub/modules';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { AiBadge, StatusBadge, dauer } from '@/modules/verification/components/shared';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Verifikation – Verlauf' };
export const dynamic = 'force-dynamic';

const FILTER = [
  { id: 'ALL', label: 'Alle' },
  { id: 'HUMAN_VERIFIED', label: 'Manuell verifiziert' },
  { id: 'AI_VERIFIED', label: 'AI verifiziert' },
  { id: 'REJECTED', label: 'Abgelehnt' },
  { id: 'LEFT_SERVER', label: 'Verlassen' },
  { id: 'EXPIRED', label: 'Abgelaufen' },
] as const;

/** Abgeschlossene Vorgänge mit Ergebnis, Entscheider und Grund. */
export default async function VerlaufPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  await requirePagePermission(verification.VERIFICATION_PERMISSIONS.historyView);
  const params = await searchParams;

  if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Verifikation ist ausgeschaltet." />;
  }

  const einfach = (wert: string | string[] | undefined): string | undefined =>
    Array.isArray(wert) ? wert[0] : wert;
  const roh = einfach(params.filter);
  const filter = FILTER.some((eintrag) => eintrag.id === roh)
    ? (roh as (typeof FILTER)[number]['id'])
    : 'ALL';
  const suche = einfach(params.search)?.trim();

  const zeilen = await verification.listHistory(filter, { search: suche, limit: 150 });

  return (
    <>
      <PageHeader title="Verlauf" description="Wer wann von wem entschieden wurde - und warum." />

      <form className="flex gap-2" action="/verifikation/verlauf">
        <input type="hidden" name="filter" value={filter} />
        <Input
          name="search"
          defaultValue={suche ?? ''}
          placeholder="Username, Displayname oder Discord-ID"
          aria-label="Verlauf durchsuchen"
        />
        <button
          type="submit"
          className="min-h-10 rounded-lg border border-border px-4 text-sm hover:bg-muted"
        >
          Suchen
        </button>
      </form>

      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1">
        {FILTER.map((eintrag) => (
          <Link
            key={eintrag.id}
            href={`/verifikation/verlauf?filter=${eintrag.id}${suche ? `&search=${encodeURIComponent(suche)}` : ''}`}
            aria-current={filter === eintrag.id}
            className={
              filter === eintrag.id
                ? 'min-h-9 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                : 'min-h-9 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted'
            }
          >
            {eintrag.label}
          </Link>
        ))}
      </div>

      {zeilen.length === 0 ? (
        <EmptyState title="Nichts gefunden" description="Für diese Auswahl gibt es keine Einträge." />
      ) : (
        <div className="space-y-2">
          {zeilen.map((zeile) => (
            <div
              key={zeile.id}
              className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-card p-3"
            >
              <DiscordAvatar
                discordId={zeile.discordId}
                avatarHash={zeile.avatarHash}
                name={zeile.displayName ?? zeile.discordId}
                size={32}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{zeile.displayName ?? zeile.username ?? zeile.discordId}</p>
                <p className="text-xs text-muted-foreground">
                  {zeile.decidedAt
                    ? new Intl.DateTimeFormat('de-CH', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(zeile.decidedAt)
                    : '—'}
                  {zeile.dauer !== null ? ` · Wartezeit ${dauer(zeile.dauer)}` : ''}
                  {' · '}
                  {zeile.decidedBy === 'AI'
                    ? 'AI-Prüfung'
                    : zeile.decidedBy === 'SYSTEM'
                      ? 'Zeitsteuerung'
                      : (zeile.decidedByUsername ?? 'Moderation')}
                </p>
                {zeile.latestMessage ? (
                  <p className="mt-1 truncate text-sm text-muted-foreground">«{zeile.latestMessage}»</p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nachricht nach Ablauf der Aufbewahrung entfernt.
                  </p>
                )}
                {zeile.decisionReason ? (
                  <p className="mt-1 text-xs text-muted-foreground">Grund: {zeile.decisionReason}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={zeile.status} />
                <AiBadge verdict={zeile.aiVerdict} confidence={zeile.aiConfidence} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
