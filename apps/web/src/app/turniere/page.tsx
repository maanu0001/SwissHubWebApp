import Link from 'next/link';
import { CalendarDays, Gamepad2, Trophy, Users } from 'lucide-react';
import { isModuleEnabled, tournaments } from '@swisshub/modules';
import { formatDayTime } from '@swisshub/shared';
import { EmptyState } from '@/components/shared/states';
import {
  FORMAT_LABEL,
  TournamentStatusBadge,
} from '@/modules/tournaments/components/tournament-badges';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Die öffentliche Turnierübersicht.
 *
 * Zeigt nur, was veröffentlicht ist - Entwürfe bleiben aussen vor. Wer
 * angemeldet ist, sieht dieselbe Seite; die Anmeldung braucht es erst auf der
 * Turnierseite selbst.
 */
export default async function TurniereIndexPage(): Promise<React.JSX.Element> {
  const aktiv = await isModuleEnabled(tournaments.TOURNAMENTS_MODULE_ID);
  if (!aktiv) {
    return (
      <EmptyState
        title="Turniere sind derzeit nicht verfügbar."
        description="Schau bitte später noch einmal vorbei."
      />
    );
  }

  const [laufend, vergangen] = await Promise.all([
    tournaments.listPublicTournaments({ limit: 50 }),
    tournaments.listPublicTournaments({ archiv: true, limit: 12 }),
  ]);

  return (
    <div className="space-y-12">
      <section className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Turniere</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Anmeldung, Brackets und Resultate der SwissHub-Community – an einem Ort.
        </p>
      </section>

      {laufend.length === 0 ? (
        <EmptyState
          title="Gerade läuft kein Turnier"
          description="Sobald das nächste Turnier ausgeschrieben ist, steht es hier."
        />
      ) : (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Aktuell</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {laufend.map((turnier) => (
              <li key={turnier.id}>
                <TurnierKarte turnier={turnier} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {vergangen.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Vorbei</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {vergangen.map((turnier) => (
              <li key={turnier.id}>
                <TurnierKarte turnier={turnier} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

type ListenTurnier = Awaited<ReturnType<typeof tournaments.listPublicTournaments>>[number];

function TurnierKarte({ turnier }: { turnier: ListenTurnier }): React.JSX.Element {
  return (
    <Link
      href={`/turniere/${turnier.slug}`}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card/40',
        'transition-colors hover:border-primary/50 hover:bg-card/70',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="relative h-28 w-full overflow-hidden bg-surface-gradient">
        {turnier.bannerUrl ? (
          // Ein fremd gehostetes Banner - bewusst ohne next/image, damit die
          // Seite nicht an einer Domainliste scheitert, die niemand pflegt.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={turnier.bannerUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Trophy className="size-8 text-muted-foreground/40" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-tight">{turnier.name}</h3>
          <TournamentStatusBadge status={turnier.status} />
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Gamepad2 className="size-3.5 shrink-0" aria-hidden="true" />
          {turnier.game?.name ?? turnier.gameName}
          <span aria-hidden="true">·</span>
          {FORMAT_LABEL[turnier.format] ?? turnier.format}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
          {turnier.startsAt ? (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
              {formatDayTime(turnier.startsAt)}
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 shrink-0" aria-hidden="true" />
            {turnier.maxParticipants > 0
              ? `${turnier._count.registrations}/${turnier.maxParticipants}`
              : `${turnier._count.registrations}`}
          </span>
        </div>
      </div>
    </Link>
  );
}
