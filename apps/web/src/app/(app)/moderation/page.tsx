import type { Metadata } from 'next';
import Link from 'next/link';
import { AlarmClock, Gavel, Lock, ShieldAlert, ShieldBan } from 'lucide-react';
import { redirect } from 'next/navigation';
import { can } from '@swisshub/auth';
import { jail, moderation } from '@swisshub/modules';
import { formatDateTime, formatDayTime } from '@swisshub/shared';
import { StatCard } from '@/components/shared/stat-card';
import { Panel } from '@/components/shared/panel';
import { EmptyState } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { moderationAbilities, moderationOverviewScope, moderationSections } from '@/server/moderation';
import { ModerationSectionNav } from '@/modules/moderation/components/section-nav';
import { ModerationDialog } from '@/modules/moderation/components/moderation-dialog';
import { ActionTypeBadge } from '@/modules/moderation/components/action-type-badge';

export const metadata: Metadata = { title: 'Moderation' };
export const dynamic = 'force-dynamic';

/**
 * Die Uebersicht des Moderation Center.
 *
 * Jede Karte und jedes Panel haengt an seiner Berechtigung: wer die
 * Jail-Zahlen nicht sehen darf, bekommt keine Karte mit einer Null, sondern
 * gar keine Karte. Eine Null waere eine Auskunft.
 */
export default async function ModerationPage(): Promise<React.JSX.Element> {
  const p = moderation.MODERATION_PERMISSIONS;
  // Wer bannen darf, aber die Historie nicht sehen: der landet in der
  // Bannliste statt auf einer 403-Seite. Der Seitenleisten-Eintrag führt für
  // beide Berechtigungen hierher.
  const context = await requirePagePermission([p.view, p.ban, p.unban]);
  if (!can(context, p.view)) {
    redirect('/moderation/banns');
  }

  const scope = moderationOverviewScope(context);
  const abilities = moderationAbilities(context);
  const darfHistorie = can(context, p.historyView);

  const [kennzahlen, letzte, timeouts, auffaellig, moderatoren] = await Promise.all([
    moderation.moderationOverview(scope),
    moderation.recentActions(12),
    moderation.aktiveTimeouts(10),
    darfHistorie ? moderation.haeufigModeriert(30, 5) : Promise.resolve([]),
    darfHistorie ? moderation.moderatorAktivitaet(30, 5) : Promise.resolve([]),
  ]);

  const csrfToken = csrfTokenFor(context);

  return (
    <>
      <ModerationSectionNav sections={moderationSections(context)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Massnahmen des Servers - Jail, Bann, Kick und Timeout in einer Akte.
        </p>
        {abilities.any ? <ModerationDialog csrfToken={csrfToken} abilities={abilities} /> : null}
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
        {kennzahlen.heute === undefined ? null : (
          <StatCard
            label="Aktionen heute"
            value={kennzahlen.heute}
            icon={<Gavel aria-hidden="true" />}
            hint={kennzahlen.siebenTage === undefined ? undefined : `${kennzahlen.siebenTage} in 7 Tagen`}
          />
        )}
        {kennzahlen.aktiveTimeouts === undefined ? null : (
          <StatCard
            label="Laufende Timeouts"
            value={kennzahlen.aktiveTimeouts}
            tone={kennzahlen.aktiveTimeouts > 0 ? 'warning' : 'default'}
            icon={<AlarmClock aria-hidden="true" />}
            hint="Über dieses System gesetzt"
          />
        )}
        {kennzahlen.aktiveJails === undefined ? null : (
          <StatCard
            label="Aktive Jails"
            value={kennzahlen.aktiveJails}
            tone={kennzahlen.aktiveJails > 0 ? 'warning' : 'default'}
            icon={<Lock aria-hidden="true" />}
          />
        )}
        {kennzahlen.banns === undefined ? null : (
          <StatCard
            label="Banns"
            value={kennzahlen.banns ?? '—'}
            tone={kennzahlen.banns ? 'destructive' : 'default'}
            icon={<ShieldBan aria-hidden="true" />}
            hint={kennzahlen.banns === null ? 'Discord hat nicht geantwortet' : 'Laut Discord'}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Letzte Massnahmen"
          icon={<ShieldAlert aria-hidden="true" />}
          action={{ label: 'Verlauf', href: '/moderation/verlauf' }}
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          {letzte.length === 0 ? (
            <EmptyState
              title="Noch keine Massnahmen"
              description="Sobald jemand moderiert, erscheint es hier."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {letzte.map((eintrag) => (
                <li key={eintrag.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                  <ActionTypeBadge type={eintrag.type} />
                  <Link
                    href={`/members/${eintrag.targetDiscordId}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {eintrag.targetUsername}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {eintrag.reason ?? '—'}
                  </span>
                  {eintrag.status === 'COMPLETED' ? null : <StatusBadge status={eintrag.status} />}
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDayTime(eintrag.createdAt)} · {eintrag.actorUsername}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {kennzahlen.aktiveTimeouts === undefined ? null : (
          <Panel title="Laufende Timeouts" icon={<AlarmClock aria-hidden="true" />} bodyClassName="p-0">
            {timeouts.length === 0 ? (
              <EmptyState
                title="Kein laufender Timeout"
                description="Weder über das Dashboard noch direkt in Discord läuft gerade ein Timeout."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {timeouts.map((eintrag) => (
                  <li key={eintrag.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                    <Link
                      href={`/members/${eintrag.targetDiscordId}`}
                      className="min-w-0 flex-1 truncate font-medium hover:underline"
                    >
                      {eintrag.targetUsername}
                    </Link>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      bis {eintrag.expiresAt ? formatDateTime(eintrag.expiresAt) : 'unbekannt'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {darfHistorie ? (
          <Panel title="Häufig moderiert" description="Letzte 30 Tage" bodyClassName="p-0">
            {auffaellig.length === 0 ? (
              <EmptyState title="Nichts Auffälliges" description="In den letzten 30 Tagen keine Häufungen." />
            ) : (
              <ul className="divide-y divide-border/60">
                {auffaellig.map((eintrag) => (
                  <li
                    key={eintrag.targetDiscordId}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <Link
                      href={`/members/${eintrag.targetDiscordId}`}
                      className="min-w-0 truncate hover:underline"
                    >
                      {eintrag.targetUsername}
                    </Link>
                    <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                      {eintrag.anzahl}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}

        {darfHistorie ? (
          <Panel title="Moderatoren" description="Letzte 30 Tage" bodyClassName="p-0">
            {moderatoren.length === 0 ? (
              <EmptyState
                title="Keine Aktivität"
                description="In den letzten 30 Tagen wurde nicht moderiert."
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {moderatoren.map((eintrag) => (
                  <li
                    key={eintrag.actorDiscordId}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <span className="min-w-0 truncate">{eintrag.actorUsername}</span>
                    <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                      {eintrag.anzahl}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>

      {/* Der Verweis ins Jail-Modul, statt einer zweiten Jail-Ansicht hier. */}
      {can(context, jail.JAIL_PERMISSIONS.view) ? (
        <p className="text-sm text-muted-foreground">
          Jails werden im{' '}
          <Link href="/moderation/jail" className="text-primary-bright hover:underline">
            Jail-Modul
          </Link>{' '}
          verwaltet - sie erscheinen hier im gemeinsamen Verlauf.
        </p>
      ) : null}
    </>
  );
}
