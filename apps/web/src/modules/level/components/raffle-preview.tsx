'use client';

import { Gift, Users } from 'lucide-react';
import type { ChannelOption } from '@/modules/configuration/components/discord-option-types';
import { formatXp } from './raffle-shared';
import type { RaffleFormValues } from './raffle-form';

/**
 * Live-Vorschau beim Anlegen einer Verlosung.
 *
 * Zeigt beides nebeneinander: die Karte auf der Mitgliederseite und das
 * Discord-Embed. Die Texte stammen aus denselben Bausteinen wie später im
 * Betrieb, damit die Vorschau nicht auseinanderläuft.
 */
export function RafflePreview({
  values,
  channels,
}: {
  values: RaffleFormValues;
  channels: ChannelOption[];
}): React.JSX.Element {
  // Die WebApp spricht Deutsch, die Ankündigung auf Discord Schweizerdeutsch.
  // Die Vorschau zeigt beides so, wie es später wirklich erscheint - sonst
  // wäre sie nur halb eine Vorschau.
  const einsatzWeb =
    values.entryModel === 'FIXED'
      ? `${formatXp(Number(values.fixedEntryXp) || 0)} für alle`
      : [
          `${values.percentage || 0} % der eigenen XP`,
          values.minimumEntryXp ? `mindestens ${formatXp(Number(values.minimumEntryXp))}` : null,
          values.maximumEntryXp ? `höchstens ${formatXp(Number(values.maximumEntryXp))}` : null,
        ]
          .filter(Boolean)
          .join(', ');

  const einsatzDiscord =
    values.entryModel === 'FIXED'
      ? `${formatXp(Number(values.fixedEntryXp) || 0)} für alli`
      : [
          `${values.percentage || 0} % vo dine XP`,
          values.minimumEntryXp ? `min. ${formatXp(Number(values.minimumEntryXp))}` : null,
          values.maximumEntryXp ? `max. ${formatXp(Number(values.maximumEntryXp))}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const fairnessWeb =
    values.entryModel === 'FIXED'
      ? 'Alle zahlen denselben Einsatz und haben dieselbe Gewinnchance.'
      : 'Die Gewinnchance richtet sich nach dem eingesetzten XP-Betrag im Verhältnis zu allen Einsätzen.';

  const fairnessDiscord =
    values.entryModel === 'FIXED'
      ? 'Alli zahled glich vill und hend die glich Chance.'
      : 'Dini Chance richtet sich nach dim Isatz im Verhältnis zu allne Isätz.';

  const channel = channels.find((entry) => entry.id === values.discordChannelId);

  return (
    <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
      <div>
        <h3 className="text-sm font-semibold">Vorschau</h3>
        <p className="text-xs text-muted-foreground">So erscheint die Verlosung.</p>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          Mitgliederseite
        </p>
        {values.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- freie Adresse, kein Bild-Optimierer.
          <img
            src={values.bannerUrl}
            alt=""
            className="h-28 w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        <div className="space-y-3 p-4">
          <div>
            <p className="text-base font-semibold">{values.title || 'Titel der Verlosung'}</p>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {values.description || 'Setze deine XP als Einsatz und nimm an der Verlosung teil.'}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Gewinn</dt>
              <dd className="font-medium">{values.prizeDescription || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Einsatz</dt>
              <dd className="font-medium">{einsatzWeb}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Teilnehmende</dt>
              <dd className="font-medium tabular-nums">0</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">XP im Topf</dt>
              <dd className="font-medium tabular-nums">0 XP</dd>
            </div>
          </dl>
          <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">{fairnessWeb}</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          Discord {channel ? `· #${channel.name}` : '· kein Channel gewählt'}
        </p>
        <div className="p-4">
          <div className="rounded border-l-4 border-primary bg-background p-3">
            <p className="text-sm font-semibold">🎡 {values.title || 'Titel der Verlosung'}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {values.description || 'Setz dini XP ii und mach bi de Verlosig mit!'}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="col-span-2">
                <dt className="font-medium">🎁 Gwünn</dt>
                <dd className="text-muted-foreground">{values.prizeDescription || '—'}</dd>
              </div>
              <div>
                <dt className="font-medium">💰 Isatz</dt>
                <dd className="text-muted-foreground">{einsatzDiscord}</dd>
              </div>
              <div>
                <dt className="font-medium">👥 Teilnehmer</dt>
                <dd className="text-muted-foreground tabular-nums">0</dd>
              </div>
              <div className="col-span-2">
                <dt className="font-medium">⚖️ Fairness</dt>
                <dd className="text-muted-foreground">{fairnessDiscord}</dd>
              </div>
            </dl>
            <div className="mt-3 flex gap-2">
              <span className="rounded bg-emerald-600/90 px-2 py-1 text-xs font-medium text-white">
                🎟️ Mitmache
              </span>
              <span className="rounded border border-border px-2 py-1 text-xs">Zum Glücksrad</span>
            </div>
          </div>
        </div>
      </section>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        {values.prizeKind === 'XP_PRIZE' ? (
          <Gift className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>
          Die eingesetzten XP sind Teilnahmegebühr und werden nicht automatisch ausgezahlt. Der Gewinn ist
          das, was oben unter „Gewinn“ steht.
        </span>
      </p>
    </aside>
  );
}
