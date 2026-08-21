import type { Metadata } from 'next';
import { level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { RaffleForm, emptyRaffleForm } from '@/modules/level/components/raffle-form';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Neue Verlosung' };
export const dynamic = 'force-dynamic';

/** Neue Verlosung anlegen. Sie entsteht als Entwurf und ist noch für niemanden sichtbar. */
export default async function NewRafflePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.raffleCreate);
  const csrfToken = csrfTokenFor(context);
  const { channels, roles } = await loadDiscordOptions();

  return (
    <>
      <PageHeader
        title="Neue Verlosung"
        description="Die Verlosung entsteht als Entwurf – veröffentlicht wird sie erst im nächsten Schritt."
      />
      <LevelSectionNav sections={levelSections(context)} />
      <RaffleForm csrfToken={csrfToken} initial={emptyRaffleForm} channels={channels} roles={roles} />
    </>
  );
}
