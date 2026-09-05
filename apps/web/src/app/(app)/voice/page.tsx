import type { Metadata } from 'next';
import { Mic, Sparkles } from 'lucide-react';
import { resolveGuildId } from '@swisshub/discord';
import { voiceHub } from '@swisshub/modules';
import { can } from '@swisshub/auth';
import { EmptyState } from '@/components/shared/states';
import { PageToolbar } from '@/components/shared/page-header';
import { VoiceSectionNav } from '@/modules/voice/components/section-nav';
import { TalkPanel } from '@/modules/voice/components/talk-panel';
import { PreferencesPanel } from '@/modules/voice/components/preferences-panel';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { voiceKontext, voiceSections } from '@/server/voice';

export const metadata: Metadata = { title: 'Voice Hub' };
export const dynamic = 'force-dynamic';

/**
 * Die eigene Seite des Voice Hub.
 *
 * Wer gerade einen Talk besitzt, sieht ihn hier mit denselben Knöpfen wie im
 * Bedienfeld auf Discord. Wer keinen hat, erfährt, wie er einen bekommt - und
 * kann seine Voreinstellungen für den nächsten setzen.
 */
export default async function VoiceUebersichtPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(voiceHub.VOICE_HUB_PERMISSIONS.view);
  const p = voiceHub.VOICE_HUB_PERMISSIONS;

  const [eigener, hubs, guildId] = await Promise.all([
    voiceHub.eigenerTalk(context.user.discordId),
    voiceHub.listHubs().catch(() => []),
    resolveGuildId().catch(() => ''),
  ]);

  const csrfToken = csrfTokenFor(context);
  const aktiveHubs = hubs.filter((hub) => hub.enabled);

  const detail = eigener ? await voiceHub.getTalkDetail(eigener.id) : null;
  const zugriff = eigener ? voiceHub.getVoiceAccess(voiceKontext(context).viewer, eigener) : null;

  const vorlieben = await voiceHub.getPreferences(context.user.discordId);
  const vertraute = await voiceHub.listTrusted(context.user.discordId);

  return (
    <>
      <VoiceSectionNav sections={voiceSections(context)} />
      <PageToolbar />

      {detail && eigener && zugriff ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Mic className="size-4" aria-hidden="true" />
            Dein Talk
          </h2>
          {/*
            Den eigenen Talk bedient man auf Discord. Das Bedienfeld steht im
            Talk selbst, also dort, wo die Leute ohnehin sind - der Weg durch
            den Browser hiess, den Server zu verlassen, um den Kanal zu
            ändern, in dem man gerade sitzt. Für die Verwaltung bleibt er
            offen: sie greift von aussen ein, oft in einen Talk, in dem sie
            gar nicht sitzt.

            Dieselbe Regel gilt serverseitig - die Aktion weist einen Aufruf
            ohne Verwaltungsrechte ab. Was hier fehlt, ist der Knopf, nicht
            die Prüfung.
          */}
          <TalkPanel
            csrfToken={csrfToken}
            guildId={guildId}
            talk={{
              id: eigener.id,
              name: eigener.name,
              userLimit: eigener.userLimit,
              maxUserLimit: detail.preset?.maxUserLimit ?? 99,
              locked: eigener.locked,
              hidden: eigener.hidden,
              gameName: eigener.gameName,
              ownerDiscordId: eigener.ownerDiscordId,
              ownerUsername: eigener.ownerUsername,
              discordChannelId: eigener.discordChannelId,
              hatBedienfeld: eigener.controlMessageId !== null,
            }}
            mitglieder={detail.mitglieder.map((mitglied) => ({
              discordId: mitglied.discordId,
              username: mitglied.displayName ?? mitglied.discordId,
              isBot: mitglied.isBot,
            }))}
            ausnahmen={detail.access.map((eintrag) => ({
              discordId: eintrag.discordId,
              username: eintrag.username,
              kind: eintrag.kind,
            }))}
            darfVerwalten={zugriff.manage && zugriff.istVerwaltung}
            darfMitglieder={zugriff.members && zugriff.istVerwaltung}
            darfUebergeben={zugriff.transfer && zugriff.istVerwaltung}
            darfSchliessen={zugriff.destroy && zugriff.istVerwaltung}
            darfBedienfeldErneuern={zugriff.manage}
          />

          {zugriff.istVerwaltung ? null : (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              Namen, Limit, Sperre und wer hereindarf, stellst du im Bedienfeld
              deines Talks auf Discord ein - dort, wo du ohnehin bist.
            </p>
          )}
        </section>
      ) : (
        <EmptyState
          title="Du hast gerade keinen Talk"
          description={
            aktiveHubs.length > 0
              ? `Betritt auf Discord «${aktiveHubs[0]!.name}» - dein eigener Sprachkanal entsteht dann von selbst.`
              : 'Sobald die Serverleitung einen Hub-Channel eingerichtet hat, kannst du hier einen Talk öffnen.'
          }
        />
      )}

      {aktiveHubs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4" aria-hidden="true" />
            So bekommst du einen Talk
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {aktiveHubs.map((hub) => (
              <li key={hub.id} className="rounded-xl border border-border px-4 py-3">
                <p className="font-medium">{hub.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Vorlage «{hub.preset.name}»
                  {hub.preset.userLimit > 0 ? ` · bis ${hub.preset.userLimit} Personen` : ''}
                  {hub.preset.hiddenDefault ? ' · startet versteckt' : ''}
                  {hub.preset.lockedDefault ? ' · startet gesperrt' : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {can(context, p.use) ? (
        <PreferencesPanel
          csrfToken={csrfToken}
          vorlieben={{
            preferredName: vorlieben?.preferredName ?? '',
            preferredLimit: vorlieben?.preferredLimit ?? null,
            applyPreferences: vorlieben?.applyPreferences ?? false,
            autoAllowTrusted: vorlieben?.autoAllowTrusted ?? false,
          }}
          vertraute={vertraute.map((person) => ({
            discordId: person.discordId,
            username: person.username,
          }))}
        />
      ) : null}
    </>
  );
}

