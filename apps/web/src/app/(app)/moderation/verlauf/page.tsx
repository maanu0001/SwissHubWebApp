import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { moderation } from '@swisshub/modules';
import { formatDateTime, sanitizeText } from '@swisshub/shared';
import { DataTable } from '@/components/shared/data-table';
import { StatusBadge } from '@/components/shared/status-badge';
import { buttonVariants } from '@/components/ui/button';
import { requirePagePermission } from '@/server/auth';
import { moderationSections } from '@/server/moderation';
import { ModerationSectionNav } from '@/modules/moderation/components/section-nav';
import { ActionTypeBadge } from '@/modules/moderation/components/action-type-badge';
import { HistoryFilters } from '@/modules/moderation/components/history-filters';
import { ACTION_TYPES, SOURCES } from '@/modules/moderation/sections';
import { SourceBadge } from '@/modules/moderation/components/source-badge';
import { cn } from '@/lib/utils';
import type { ModerationAction, ModerationActionType, ModerationSource } from '@swisshub/database';

export const metadata: Metadata = { title: 'Moderationsverlauf' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const querySchema = z.object({
  type: z
    .string()
    .optional()
    .transform((wert) =>
      wert && (ACTION_TYPES as string[]).includes(wert) ? (wert as ModerationActionType) : undefined,
    ),
  quelle: z
    .string()
    .optional()
    .transform((wert) => (wert && (SOURCES as string[]).includes(wert) ? (wert as ModerationSource) : undefined)),
  member: z
    .string()
    .max(30)
    .optional()
    .transform((wert) => (wert && /^\d{17,20}$/.test(wert) ? wert : undefined)),
  actor: z
    .string()
    .max(30)
    .optional()
    .transform((wert) => (wert && /^\d{17,20}$/.test(wert) ? wert : undefined)),
  von: z.string().max(10).optional(),
  bis: z.string().max(10).optional(),
  cursor: z
    .string()
    .max(40)
    .optional()
    .transform((wert) => (wert ? sanitizeText(wert, 40) : undefined)),
});

/** `YYYY-MM-DD` als Datum - alles andere wird stillschweigend ignoriert. */
function alsDatum(wert: string | undefined, endeDesTages = false): Date | undefined {
  if (!wert || !/^\d{4}-\d{2}-\d{2}$/.test(wert)) {
    return undefined;
  }
  const datum = new Date(`${wert}T${endeDesTages ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(datum.getTime()) ? undefined : datum;
}

/**
 * Der gemeinsame Verlauf aller Massnahmen.
 *
 * Geblättert wird über einen Cursor statt über Seitenzahlen: die Tabelle
 * wächst, während jemand liest, und mit `skip` verschöbe sich der Ausschnitt
 * bei jedem neuen Eintrag.
 */
export default async function ModerationVerlaufPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(moderation.MODERATION_PERMISSIONS.view);
  const query = querySchema.parse(await searchParams);

  const { zeilen, naechsterCursor } = await moderation.listActions({
    type: query.type ? [query.type] : undefined,
    targetDiscordId: query.member,
    actorDiscordId: query.actor,
    von: alsDatum(query.von),
    bis: alsDatum(query.bis, true),
    source: query.quelle ? [query.quelle] : undefined,
    cursor: query.cursor,
    pageSize: PAGE_SIZE,
  });

  const weiterHref = (cursor: string): string => {
    const suche = new URLSearchParams();
    for (const [schluessel, wert] of Object.entries({
      type: query.type,
      quelle: query.quelle,
      member: query.member,
      actor: query.actor,
      von: query.von,
      bis: query.bis,
    })) {
      if (wert) {
        suche.set(schluessel, wert);
      }
    }
    suche.set('cursor', cursor);
    return `/moderation/verlauf?${suche.toString()}`;
  };

  return (
    <>
      <ModerationSectionNav sections={moderationSections(context)} />

      <HistoryFilters
        type={query.type ?? ''}
        quelle={query.quelle ?? ''}
        member={query.member ?? ''}
        actor={query.actor ?? ''}
        von={query.von ?? ''}
        bis={query.bis ?? ''}
      />

      <DataTable
        columns={[
          {
            key: 'time',
            header: 'Zeitpunkt',
            render: (row: ModerationAction) => (
              <span className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(row.createdAt)}
              </span>
            ),
          },
          {
            key: 'type',
            header: 'Massnahme',
            render: (row: ModerationAction) => <ActionTypeBadge type={row.type} />,
          },
          {
            key: 'target',
            header: 'Betroffen',
            render: (row: ModerationAction) => (
              <Link href={`/members/${row.targetDiscordId}`} className="hover:underline">
                {row.targetUsername}
              </Link>
            ),
          },
          {
            key: 'actor',
            header: 'Moderator',
            render: (row: ModerationAction) => (
              <span className="whitespace-nowrap">
                {row.actorUsername}
                {/* Ein Bot handelt anders als ein Mensch - das gehoert an den
                    Namen, nicht in eine Fussnote. */}
                {row.actorType === 'BOT' ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">(Bot)</span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'source',
            header: 'Quelle',
            render: (row: ModerationAction) => <SourceBadge source={row.source} />,
          },
          {
            key: 'reason',
            header: 'Grund',
            className: 'max-w-xs',
            render: (row: ModerationAction) => (
              // Bei einer Massnahme aus dem Dashboard ist der Grund Pflicht,
              // bei einer aus Discord steht hier, was Discord hergab - und
              // manchmal gab es nichts her. Erfunden wird keiner.
              <span className="line-clamp-2 break-words text-muted-foreground">
                {row.reason ?? 'Kein Grund angegeben'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (row: ModerationAction) => <StatusBadge status={row.status} />,
          },
        ]}
        rows={zeilen}
        getRowKey={(row) => row.id}
        emptyTitle="Keine Einträge"
        emptyDescription="Für diese Auswahl gibt es keine Massnahmen."
        caption="Moderationsverlauf"
      />

      {naechsterCursor ? (
        <div className="flex justify-center">
          <Link
            href={weiterHref(naechsterCursor)}
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
