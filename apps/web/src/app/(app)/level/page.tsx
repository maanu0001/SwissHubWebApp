import type { Metadata } from 'next';
import Link from 'next/link';
import { Dice5, Moon, Shield, Ticket, TrendingUp, Trophy, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { RAFFLE_STATUS_LABEL } from '@/modules/level/components/raffle-shared';
import { requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Level-System' };
export const dynamic = 'force-dynamic';

/** Übersicht des Moduls: Kennzahlen und Schnellzugriffe. */
export default async function LevelPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.view);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState
          title="Modul deaktiviert"
          description="Das Level-System ist derzeit deaktiviert. Es wird keine XP vergeben."
        />
      </>
    );
  }

  const settings = await level.readLevelSettings();
  const overview = await level.getLevelOverview({ decayRules: level.decayRulesFrom(settings) });
  const raffles = can(context, level.LEVEL_PERMISSIONS.raffleView)
    ? await level.raffle.getRaffleOverview()
    : null;

  return (
    <>
      <PageHeader
        title="Level-System"
        description="XP für Nachrichten und Voice, Level, Meilenstein-Rollen und XP-Spiele."
      />
      {sections}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Mitglieder mit XP"
          value={level.formatXp(overview.activeMembers)}
          hint={`${level.formatXp(overview.members)} Profile insgesamt`}
          icon={<Users />}
        />
        <StatCard
          label="XP insgesamt"
          value={level.formatXp(overview.totalXp)}
          hint={`Ø Level ${overview.averageLevel} · höchstes Level ${overview.highestLevel}`}
          icon={<TrendingUp />}
        />
        <StatCard
          label="XP heute"
          value={`+${level.formatXp(overview.xpGainedToday)}`}
          hint={
            overview.xpLostToday > 0
              ? `${level.formatXp(overview.xpLostToday)} XP abgezogen · ${overview.transactionsToday} Buchungen`
              : `${overview.transactionsToday} Buchungen`
          }
          icon={<TrendingUp />}
          tone={overview.xpGainedToday > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Im Inaktivitäts-Abzug"
          value={level.formatXp(overview.inDecay)}
          hint={
            settings.decayEnabled ? `Schonfrist ${settings.decayGraceDays} Tage` : 'Abzug ist abgeschaltet'
          }
          icon={<Moon />}
          tone={overview.inDecay > 0 && settings.decayEnabled ? 'warning' : 'default'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Level-Rollen"
          value={overview.milestoneRoles}
          hint={overview.milestoneRoles === 0 ? 'Noch keine eingerichtet' : 'Aktiv vergeben'}
          icon={<Shield />}
        />
        <StatCard
          label="Laufende Partien"
          value={overview.runningGames}
          hint={`${overview.gamesToday} in den letzten 24 Stunden`}
          icon={<Dice5 />}
        />
        <StatCard
          label="XP pro Nachricht"
          value={
            settings.messageXpEnabled
              ? level.formatXp(Math.trunc(settings.xpPerMessage * settings.xpBoost))
              : 'aus'
          }
          hint={
            settings.messageXpEnabled
              ? `Cooldown ${settings.messageCooldownSeconds}s · Boost ${settings.xpBoost}×`
              : 'XP für Nachrichten ist abgeschaltet'
          }
          icon={<Trophy />}
          tone={settings.messageXpEnabled ? 'default' : 'warning'}
        />
      </div>

      {raffles ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Aktive Verlosung"
            value={raffles.active ? raffles.active.title : '—'}
            hint={raffles.active ? RAFFLE_STATUS_LABEL[raffles.active.status] : 'Zurzeit läuft keine'}
            icon={<Ticket />}
          />
          <StatCard
            label="Teilnehmende"
            value={(raffles.active?.entryCount ?? 0).toString()}
            hint="In der aktiven Verlosung"
            icon={<Ticket />}
          />
          <StatCard
            label="XP im aktuellen Topf"
            value={level.formatXp(raffles.active?.potXp ?? 0)}
            hint="Summe aller Einsätze"
            icon={<Ticket />}
          />
          <StatCard
            label="Verlosungen gesamt"
            value={raffles.totalRaffles.toString()}
            hint={
              raffles.nextDrawAt
                ? `Nächste Ziehung ${raffles.nextDrawAt.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich' })}`
                : `${raffles.completedCount} abgeschlossen`
            }
            icon={<Ticket />}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {can(context, level.LEVEL_PERMISSIONS.leaderboardView) ? (
          <Link href="/level/rangliste" className={cn(buttonVariants())}>
            <Trophy aria-hidden="true" />
            Rangliste
          </Link>
        ) : null}
        {can(context, level.LEVEL_PERMISSIONS.membersView) ? (
          <Link href="/level/mitglieder" className={cn(buttonVariants({ variant: 'outline' }))}>
            <Users aria-hidden="true" />
            Mitglieder
          </Link>
        ) : null}
        {can(context, level.LEVEL_PERMISSIONS.rolesView) ? (
          <Link href="/level/rollen" className={cn(buttonVariants({ variant: 'outline' }))}>
            <Shield aria-hidden="true" />
            Level & Rollen
          </Link>
        ) : null}
      </div>

      {overview.lastImportAt ? (
        <p className="text-xs text-muted-foreground">
          Letzte Übernahme aus der alten <code className="font-mono">levels.db</code>:{' '}
          {overview.lastImportAt.toLocaleString('de-CH')}
        </p>
      ) : null}
    </>
  );
}
