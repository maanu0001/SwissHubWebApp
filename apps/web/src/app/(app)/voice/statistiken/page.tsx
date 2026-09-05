import type { Metadata } from 'next';
import { Clock, Mic, TrendingUp, Users } from 'lucide-react';
import { voiceHub } from '@swisshub/modules';
import { PageToolbar } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/states';
import { StatCard } from '@/components/shared/stat-card';
import { VoiceSectionNav } from '@/modules/voice/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { voiceSections } from '@/server/voice';

export const metadata: Metadata = { title: 'Voice-Statistiken' };
export const dynamic = 'force-dynamic';

/**
 * Kennzahlen des Voice Hub.
 *
 * Aggregiert und nur gemessen. Wer wann wie lange in welchem Talk sass, wäre
 * eine Bewegungsakte und steht hier nicht - und wo nichts gemessen wurde,
 * steht ein Strich statt einer erfundenen Zahl.
 */
export default async function VoiceStatistikenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(voiceHub.VOICE_HUB_PERMISSIONS.statsView);
  const stats = await voiceHub.getVoiceHubStats();

  return (
    <>
      <VoiceSectionNav sections={voiceSections(context)} />
      <PageToolbar />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Talks jetzt"
          value={stats.aktiveTalks}
          hint={`${stats.personenInTalks} Personen drin`}
          icon={<Mic className="size-4" aria-hidden="true" />}
          tone={stats.aktiveTalks > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Heute"
          value={stats.talksHeute}
          hint={`${stats.talks7Tage} in 7 Tagen`}
          icon={<TrendingUp className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="30 Tage"
          value={stats.talks30Tage}
          hint={`Höchstens ${stats.peakTalks} gleichzeitig`}
          icon={<Users className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="Ø Dauer"
          value={stats.durchschnittsdauerMinuten === null ? '–' : `${stats.durchschnittsdauerMinuten} Min.`}
          hint={
            stats.durchschnittTeilnehmer === null
              ? 'Noch kein Talk beendet'
              : `Ø ${stats.durchschnittTeilnehmer} Teilnehmer`
          }
          icon={<Clock className="size-4" aria-hidden="true" />}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Meistgenutzte Hubs</h2>
        {stats.beliebtesteHubs.length === 0 ? (
          <EmptyState title="Noch keine Talks" />
        ) : (
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {stats.beliebtesteHubs.map((hub, index) => (
              <li key={hub.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{hub.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {hub.anzahl} {hub.anzahl === 1 ? 'Talk' : 'Talks'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
