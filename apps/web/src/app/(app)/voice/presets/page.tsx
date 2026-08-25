import type { Metadata } from 'next';
import { prisma } from '@swisshub/database';
import { voiceHub } from '@swisshub/modules';
import { PageToolbar } from '@/components/shared/page-header';
import { VoiceSectionNav } from '@/modules/voice/components/section-nav';
import { PresetManager } from '@/modules/voice/components/preset-manager';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { voiceSections } from '@/server/voice';

export const metadata: Metadata = { title: 'Voice-Presets' };
export const dynamic = 'force-dynamic';

/** Vorlagen, aus denen Talks entstehen. */
export default async function PresetsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(voiceHub.VOICE_HUB_PERMISSIONS.presetsManage);

  const [presets, optionen] = await Promise.all([
    prisma.voicePreset.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { hubs: true } } },
    }),
    loadDiscordOptions(),
  ]);

  return (
    <>
      <VoiceSectionNav sections={voiceSections(context)} />
      <PageToolbar />
      <PresetManager
        csrfToken={csrfTokenFor(context)}
        channels={optionen.channels}
        roles={optionen.roles}
        presets={presets.map(({ _count, ...preset }) => ({
          id: preset.id,
          name: preset.name,
          nameTemplate: preset.nameTemplate,
          userLimit: preset.userLimit,
          maxUserLimit: preset.maxUserLimit,
          bitrate: preset.bitrate,
          lockedDefault: preset.lockedDefault,
          hiddenDefault: preset.hiddenDefault,
          targetCategoryId: preset.targetCategoryId,
          allowedRoleIds: preset.allowedRoleIds,
          blockedRoleIds: preset.blockedRoleIds,
          deleteGraceSeconds: preset.deleteGraceSeconds,
          renameCooldownSeconds: preset.renameCooldownSeconds,
          ownerModeration: preset.ownerModeration,
          hubs: _count.hubs,
        }))}
      />
    </>
  );
}
