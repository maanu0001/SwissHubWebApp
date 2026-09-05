import type { Metadata } from 'next';
import Link from 'next/link';
import { can } from '@swisshub/auth';
import { discord } from '@swisshub/discord';
import { moderation } from '@swisshub/modules';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/states';
import { requirePagePermission, csrfTokenFor } from '@/server/auth';
import { alleReasonTemplates, moderationAbilities, moderationSections } from '@/server/moderation';
import { ModerationSectionNav } from '@/modules/moderation/components/section-nav';
import { ModerationDialog } from '@/modules/moderation/components/moderation-dialog';
import { UnbanButton } from '@/modules/moderation/components/unban-button';

export const metadata: Metadata = { title: 'Banns' };
export const dynamic = 'force-dynamic';

interface BannZeile {
  discordId: string;
  username: string;
  reason: string | null;
}

/**
 * Die Bannliste.
 *
 * Sie kommt von Discord, nicht aus unserer Datenbank: dort ist sie die
 * Wahrheit. Ein Bann, den jemand direkt in Discord gesetzt hat, steht deshalb
 * ebenfalls hier - und seit direkt in Discord ergriffene Massnahmen erkannt
 * werden, in aller Regel auch in der Akte. In aller Regel, nicht immer: ein
 * Bann aus einer Zeit, in der der Bot nicht lief, ist Discord bekannt und uns
 * nicht. Genau deshalb bleibt Discord hier die Quelle.
 */
export default async function ModerationBannsPage(): Promise<React.JSX.Element> {
  const p = moderation.MODERATION_PERMISSIONS;
  const context = await requirePagePermission([p.ban, p.unban]);

  const abilities = moderationAbilities(context);
  const grundVorlagen = await alleReasonTemplates();
  const darfEntbannen = can(context, p.unban);

  // Faellt Discord aus, wird das gesagt - keine leere Liste, die aussieht wie
  // «es gibt keine Banns».
  const banns = await discord.bans
    .list({ limit: 1000 })
    .then((zeilen) => ({ ok: true as const, zeilen }))
    .catch(() => ({ ok: false as const, zeilen: [] as BannZeile[] }));

  const csrfToken = csrfTokenFor(context);

  return (
    <>
      <ModerationSectionNav sections={moderationSections(context)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Die Bannliste stammt direkt von Discord. Banns aus dem Discord-Client stehen ebenfalls hier -
          ohne Eintrag in unserer Akte.
        </p>
        {abilities.ban ? (
          <ModerationDialog
            csrfToken={csrfToken}
            abilities={abilities}
            triggerLabel="Bann aussprechen"
            grundVorlagen={grundVorlagen}
          />
        ) : null}
      </div>

      {banns.ok ? (
        <DataTable
          columns={[
            {
              key: 'user',
              header: 'Benutzer',
              render: (row: BannZeile) => (
                <Link href={`/members/${row.discordId}`} className="hover:underline">
                  {row.username}
                </Link>
              ),
            },
            {
              key: 'id',
              header: 'Discord-ID',
              render: (row: BannZeile) => (
                <span className="font-mono text-xs text-muted-foreground">{row.discordId}</span>
              ),
            },
            {
              key: 'reason',
              header: 'Grund',
              className: 'max-w-md',
              render: (row: BannZeile) => (
                <span className="line-clamp-2 break-words text-muted-foreground">{row.reason ?? '—'}</span>
              ),
            },
            ...(darfEntbannen
              ? [
                  {
                    key: 'actions',
                    header: '',
                    render: (row: BannZeile) => (
                      <UnbanButton
                        csrfToken={csrfToken}
                        discordId={row.discordId}
                        username={row.username}
                      />
                    ),
                  },
                ]
              : []),
          ]}
          rows={banns.zeilen}
          getRowKey={(row) => row.discordId}
          emptyTitle="Keine Banns"
          emptyDescription="Auf diesem Server ist niemand gebannt."
          caption="Bannliste"
        />
      ) : (
        <EmptyState
          title="Bannliste nicht abrufbar"
          description="Discord hat die Liste nicht geliefert. Das heisst nicht, dass es keine Banns gibt - bitte später erneut versuchen."
        />
      )}
    </>
  );
}
