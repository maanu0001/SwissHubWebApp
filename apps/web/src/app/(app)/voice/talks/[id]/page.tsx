import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatDateTime } from '@swisshub/shared';
import { resolveGuildId } from '@swisshub/discord';
import { voiceHub } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { TalkPanel } from '@/modules/voice/components/talk-panel';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { voiceKontext } from '@/server/voice';

export const metadata: Metadata = { title: 'Talk' };
export const dynamic = 'force-dynamic';

const EREIGNIS_TEXT: Record<string, string> = {
  VOICE_CREATED: 'Talk erstellt',
  VOICE_DELETED: 'Talk geschlossen',
  VOICE_RENAMED: 'Umbenannt',
  VOICE_LIMIT_CHANGED: 'Limit geändert',
  VOICE_LOCKED: 'Gesperrt',
  VOICE_UNLOCKED: 'Entsperrt',
  VOICE_HIDDEN: 'Versteckt',
  VOICE_SHOWN: 'Sichtbar gemacht',
  MEMBER_ALLOWED: 'Mitglied zugelassen',
  MEMBER_DENIED: 'Mitglied gesperrt',
  MEMBER_KICKED: 'Mitglied entfernt',
  OWNER_TRANSFERRED: 'Übergeben',
  OWNER_AUTO_TRANSFERRED: 'Selbsttätig übergeben',
};

/**
 * Ein einzelner Talk in der Verwaltung.
 *
 * Dieselben Knöpfe wie auf der eigenen Seite und im Discord-Bedienfeld - die
 * Zugriffsprüfung entscheidet, welche davon etwas bewirken. Wer weder
 * Besitzer noch zuständig ist, bekommt dieselbe Antwort wie bei einem Talk,
 * den es nicht gibt.
 */
export default async function TalkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const context = await requireMember();
  const kontext = voiceKontext(context);

  const guildId = await resolveGuildId().catch(() => '');
  const detail = await voiceHub.getTalkDetail(id);
  if (!detail || detail.closedAt !== null) {
    notFound();
  }

  const zugriff = voiceHub.getVoiceAccess(kontext.viewer, detail);
  if (!zugriff.view) {
    // Bewusst dieselbe Antwort wie bei einem nicht vorhandenen Talk: sonst
    // liesse sich an der Antwort ablesen, welche Talks es gibt.
    notFound();
  }

  const ereignisse = await voiceHub.getTalkEvents(id, 30);

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.name}
        description={`Besitzer: ${detail.ownerUsername}${detail.hub ? ` · ${detail.hub.name}` : ''}`}
      />

      <TalkPanel
        csrfToken={csrfTokenFor(context)}
        guildId={guildId}
        talk={{
          id: detail.id,
          name: detail.name,
          userLimit: detail.userLimit,
          maxUserLimit: detail.preset?.maxUserLimit ?? 99,
          locked: detail.locked,
          hidden: detail.hidden,
          gameName: detail.gameName,
          ownerDiscordId: detail.ownerDiscordId,
          ownerUsername: detail.ownerUsername,
          discordChannelId: detail.discordChannelId,
          hatBedienfeld: detail.controlMessageId !== null,
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
        darfVerwalten={zugriff.manage}
        darfMitglieder={zugriff.members}
        darfUebergeben={zugriff.transfer}
        darfSchliessen={zugriff.destroy}
        alsVerwaltung={zugriff.alsVerwaltung}
      />

      {ereignisse.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Verlauf</h2>
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {ereignisse.map((ereignis) => (
              <li
                key={ereignis.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="w-36 shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(ereignis.createdAt)}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {EREIGNIS_TEXT[ereignis.kind] ?? ereignis.kind}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
