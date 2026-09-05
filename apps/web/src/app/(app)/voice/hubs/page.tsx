import type { Metadata } from 'next';
import { voiceHub } from '@swisshub/modules';
import { PageToolbar } from '@/components/shared/page-header';
import { VoiceSectionNav } from '@/modules/voice/components/section-nav';
import { HubManager } from '@/modules/voice/components/hub-manager';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { voiceSections } from '@/server/voice';

export const metadata: Metadata = { title: 'Hub-Channels' };
export const dynamic = 'force-dynamic';

/**
 * Die Join-to-Create-Channels.
 *
 * Jeder Hub bekommt hier seine Gesundheitsprüfung mit: fehlt der Channel oder
 * die Kategorie, steht es an der Zeile und nicht in einem Protokoll, das
 * niemand liest.
 */
export default async function HubsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(voiceHub.VOICE_HUB_PERMISSIONS.hubsManage);

  const [hubs, presets, optionen] = await Promise.all([
    voiceHub.listHubs(),
    voiceHub.listPresets(),
    loadDiscordOptions(),
  ]);

  const kanalNach = new Map(optionen.channels.map((kanal) => [kanal.id, kanal]));

  return (
    <>
      <VoiceSectionNav sections={voiceSections(context)} />
      <PageToolbar />
      <HubManager
        csrfToken={csrfTokenFor(context)}
        presets={presets.map((preset) => ({ id: preset.id, name: preset.name }))}
        channels={optionen.channels}
        roles={optionen.roles}
        hubs={hubs.map((hub) => ({
          id: hub.id,
          name: hub.name,
          discordChannelId: hub.discordChannelId,
          targetCategoryId: hub.targetCategoryId,
          overflowCategoryId: hub.overflowCategoryId,
          presetId: hub.presetId,
          presetName: hub.preset.name,
          allowedRoleIds: hub.allowedRoleIds,
          blockedRoleIds: hub.blockedRoleIds,
          enabled: hub.enabled,
          hinweise: pruefeHub(hub, kanalNach),
        }))}
      />
    </>
  );
}

/** Was an einem Hub nicht stimmt - in der Sprache dessen, der ihn einrichtet. */
function pruefeHub(
  hub: Awaited<ReturnType<typeof voiceHub.listHubs>>[number],
  kanaele: Map<string, { id: string; kind: string | null; name: string }>,
): string[] {
  const hinweise: string[] = [];

  const hubKanal = kanaele.get(hub.discordChannelId);
  if (!hubKanal) {
    hinweise.push('Der Hub-Channel existiert auf Discord nicht mehr.');
  } else if (hubKanal.kind !== 'voice') {
    hinweise.push('Der Hub-Channel ist kein Sprachkanal mehr.');
  }

  const kategorie = kanaele.get(hub.targetCategoryId);
  if (!kategorie) {
    hinweise.push('Die Zielkategorie existiert auf Discord nicht mehr.');
  } else if (kategorie.kind !== 'category') {
    hinweise.push('Die Zielkategorie ist keine Kategorie mehr.');
  }

  if (hub.overflowCategoryId && !kanaele.get(hub.overflowCategoryId)) {
    hinweise.push('Die Ausweichkategorie existiert auf Discord nicht mehr.');
  }

  return hinweise;
}
