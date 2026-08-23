import type { Metadata } from 'next';
import { resolveGuildId } from '@swisshub/discord';
import { music } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { Pagination } from '@/components/shared/pagination';
import { Badge } from '@/components/ui/badge';
import { MusicSectionNav } from '@/modules/music/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { musicSections } from '@/server/music';

export const metadata: Metadata = { title: 'Musik-Verlauf' };
export const dynamic = 'force-dynamic';

const dauer = (sekunden: number): string => {
  if (!sekunden) return '–';
  const m = Math.floor(sekunden / 60);
  const s = sekunden % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Was zuletzt lief.
 *
 * Bewusst kanal- und sitzungsbezogen: es soll nachvollziehbar sein, was in
 * einem Sprachkanal lief - nicht, was eine einzelne Person hoert.
 */
export default async function MusikVerlaufPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(music.MUSIC_PERMISSIONS.view);
  const params = await searchParams;
  const seite = Number.parseInt(params.seite ?? '1', 10);

  const { rows, total } = await music.listHistory({
    guildId: await resolveGuildId(),
    page: Number.isFinite(seite) && seite > 0 ? seite : 1,
    pageSize: 25,
  });

  return (
    <>
      <PageHeader title="Verlauf" description="Zuletzt gespielte Titel auf diesem Server." />
      <MusicSectionNav sections={musicSections(context)} />

      {rows.length === 0 ? (
        <EmptyState title="Noch kein Verlauf" description="Sobald Musik läuft, erscheint sie hier." />
      ) : (
        <>
          <ul className="divide-y divide-border/60 rounded-xl border border-border">
            {rows.map((eintrag) => (
              <li key={eintrag.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{eintrag.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {eintrag.artist ? `${eintrag.artist} · ` : ''}
                    {eintrag.requestedByUsername ? `von @${eintrag.requestedByUsername} · ` : ''}
                    {formatDateTime(eintrag.playedAt)}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-sm text-muted-foreground">
                    {dauer(eintrag.durationSeconds)}
                  </span>
                  {eintrag.skipped ? <Badge variant="outline">Übersprungen</Badge> : null}
                </span>
              </li>
            ))}
          </ul>

          {total > 25 ? (
            <Pagination
              page={Number.isFinite(seite) && seite > 0 ? seite : 1}
              totalPages={Math.ceil(total / 25)}
              total={total}
              buildHref={(s) => `/musik/verlauf?seite=${s}`}
            />
          ) : null}
        </>
      )}
    </>
  );
}
