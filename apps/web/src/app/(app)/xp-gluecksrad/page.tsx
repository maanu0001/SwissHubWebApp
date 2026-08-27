import type { Metadata } from 'next';
import { Clock, Coins, Gift, Scale, Users } from 'lucide-react';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { RaffleStage } from '@/modules/level/components/raffle-stage';
import {
  RaffleStatusBadge,
  describeEntryModel,
  fairnessNote,
  formatChance,
  formatDateTime,
  formatNumber,
  formatXp,
} from '@/modules/level/components/raffle-shared';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = {
  title: 'SwissHub XP-Glücksrad',
  description: 'Setz deine XP als Einsatz und nimm an der Verlosung teil.',
};
export const dynamic = 'force-dynamic';

/**
 * Die öffentliche Seite des XP-Glücksrads.
 *
 * Sichtbar für angemeldete SwissHub-Mitglieder. Bewusst kein Verwaltungs-
 * Layout: hier geht es um Teilnehmen und Zuschauen, nicht um Einstellungen.
 */
export default async function PublicRafflePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.raffleView);
  const csrfToken = csrfTokenFor(context);

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return <ErrorState title="Nicht verfügbar" description="Das Level-System ist derzeit deaktiviert." />;
  }

  const featured = await level.raffle.getFeaturedRaffle();
  const [past, myEntries] = await Promise.all([
    level.raffle.getPastRaffles(8),
    level.raffle.getMyEntries(context.user.discordId, 10),
  ]);

  const canParticipate = can(context, level.LEVEL_PERMISSIONS.raffleParticipate);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10">
      {featured ? (
        <FeaturedRaffle
          raffleId={featured.id}
          csrfToken={csrfToken}
          discordId={context.user.discordId}
          canParticipate={canParticipate}
        />
      ) : (
        <EmptyState
          title="🎡 Aktuell läuft keine XP-Verlosung."
          description="Sobald die nächste startet, findest du sie hier."
        />
      )}

      {myEntries.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Meine Teilnahmen</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {myEntries.map((entry) => (
              <li key={entry.raffleId} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatXp(entry.entryXp)} eingesetzt · {formatDateTime(entry.createdAt)}
                  </p>
                </div>
                {entry.won ? (
                  <Badge>Gewonnen 🎉</Badge>
                ) : entry.entryStatus === 'REFUNDED' ? (
                  <Badge variant="outline">Zurückgezahlt</Badge>
                ) : entry.entryStatus === 'DISQUALIFIED' ? (
                  <Badge variant="outline">Ausgeschlossen</Badge>
                ) : entry.status === 'COMPLETED' ? (
                  <Badge variant="outline">Nicht gewonnen</Badge>
                ) : (
                  <Badge variant="secondary">Läuft noch</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Vergangene Verlosungen</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {past.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{entry.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(entry.completedAt ?? entry.createdAt)} · {formatNumber(entry.entryCount)}{' '}
                    Teilnehmer · {entry.entryModel === 'FIXED' ? 'Festbetrag' : 'Anteil'}
                  </p>
                </div>
                {entry.winnerDisplayName ? (
                  <span className="text-sm">
                    🏆 <strong>{entry.winnerDisplayName}</strong>
                  </span>
                ) : (
                  <RaffleStatusBadge status={entry.status} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Die hervorgehobene Verlosung mit Rad, Kennzahlen und Teilnahme. */
async function FeaturedRaffle({
  raffleId,
  csrfToken,
  discordId,
  canParticipate,
}: {
  raffleId: string;
  csrfToken: string;
  discordId: string;
  canParticipate: boolean;
}): Promise<React.JSX.Element> {
  const detail = await level.raffle.getRaffleDetail(raffleId);
  if (!detail) {
    return <EmptyState title="Verlosung nicht gefunden" />;
  }

  const { raffle, participants, draw, winner, potXp, activeCount } = detail;
  const preview = await level.raffle.previewEntry(discordId, raffleId);
  const mine = participants.find((entry) => entry.discordId === discordId) ?? null;

  const active = participants.filter((entry) => entry.status === 'ACTIVE' || entry.status === 'WINNER');

  /**
   * Woraus das Rad gebaut wird.
   *
   * Sobald gezogen wurde, aus dem Auszug der Ziehung - nicht aus den heutigen
   * Teilnahmen. Eine spätere Rückzahlung oder Disqualifikation änderte sonst
   * die Segmente, und das Rad zeigte eine Verteilung, auf der die Ziehung gar
   * nicht beruhte. Der Auszug ist die historische Grundlage; er trägt Gewicht
   * und Namen bereits mit sich.
   */
  const segmente = draw
    ? level.raffle.snapshotTickets(draw).map((ticket) => ({
        entryId: ticket.entryId,
        discordId: ticket.discordId,
        label: ticket.displayName ?? ticket.username ?? 'Mitglied',
        weight: ticket.weight,
      }))
    : active.map((entry) => ({
        entryId: entry.entryId,
        discordId: entry.discordId,
        label: entry.displayName ?? entry.username ?? 'Mitglied',
        weight: entry.weight,
      }));

  /**
   * Soll sich das Rad beim Öffnen noch einmal drehen?
   *
   * Nur im Nachlauffenster nach der Bestätigung, und die Grenze zieht der
   * Server: `completedAt` steht in der Datenbank, nicht im Browser. Danach
   * zeigt die Seite das Ergebnis ohne Drehung.
   */
  const revealOnOpen =
    raffle.status === 'COMPLETED' &&
    Boolean(raffle.completedAt) &&
    Date.now() - (raffle.completedAt as Date).getTime() < level.raffle.RAFFLE_NACHLAUF_MS;

  return (
    <section className="space-y-6">
      {raffle.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- freie Adresse aus den Einstellungen.
        <img src={raffle.bannerUrl} alt="" className="h-40 w-full rounded-2xl object-cover sm:h-56" />
      ) : null}

      <div className="space-y-2 text-center">
        <div className="flex flex-wrap justify-center gap-2">
          <RaffleStatusBadge status={raffle.status} />
          <Badge variant="outline">{raffle.entryModel === 'FIXED' ? 'Festbetrag' : 'Anteilsmodell'}</Badge>
        </div>
        <h2 className="text-2xl font-semibold">{raffle.title}</h2>
        {raffle.description ? (
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground">{raffle.description}</p>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kennzahl icon={<Gift aria-hidden="true" />} label="Gewinn" value={raffle.prizeDescription} />
        <Kennzahl icon={<Coins aria-hidden="true" />} label="Einsatz" value={describeEntryModel(raffle)} />
        <Kennzahl
          icon={<Users aria-hidden="true" />}
          label="Teilnehmende"
          value={formatNumber(activeCount)}
        />
        <Kennzahl icon={<Coins aria-hidden="true" />} label="XP im Topf" value={formatXp(potXp)} />
      </dl>

      {raffle.entryEndsAt && raffle.status === 'ENTRY_OPEN' ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Clock className="size-4" aria-hidden="true" />
          Teilnahme bis {formatDateTime(raffle.entryEndsAt)}
        </p>
      ) : null}

      <RaffleStage
        csrfToken={csrfToken}
        raffleId={raffle.id}
        status={raffle.status}
        title={raffle.title}
        entryModelLabel={describeEntryModel(raffle)}
        canParticipate={canParticipate}
        animationSeed={draw?.animationSeed ?? null}
        revealOnOpen={revealOnOpen}
        viewerDiscordId={discordId}
        segments={segmente}
        winner={
          winner && draw
            ? {
                entryId: winner.entryId,
                discordId: winner.discordId,
                name: winner.displayName ?? winner.username ?? winner.discordId,
                avatarHash: null,
                entryXp: winner.entryXp,
              }
            : null
        }
        preview={{
          currentXp: preview.currentXp,
          // Wer schon teilnimmt, sieht den tatsächlich bezahlten Einsatz. Der
          // steht seit der Teilnahme fest; eine Neuberechnung würde ihn an den
          // inzwischen veränderten Punktestand anpassen und damit etwas
          // anderes anzeigen, als abgebucht wurde.
          entryXp: preview.existingEntry?.entryXp ?? preview.cost.entryXp,
          xpAfter: preview.xpAfter,
          affordable: preview.affordable,
          estimatedChance: preview.estimatedChance,
          alreadyEntered: preview.existingEntry !== null,
          myChance: mine?.chance ?? null,
          raisedToMinimum: preview.cost.raisedToMinimum,
          cappedToMaximum: preview.cost.cappedToMaximum,
        }}
      />

      <section className="rounded-xl border border-border bg-muted/30 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="size-4" aria-hidden="true" />
          Wie die Gewinnchance zustande kommt
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">{fairnessNote(raffle.entryModel)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {raffle.status === 'ENTRY_OPEN'
            ? 'Deine Gewinnchance kann sich bis zum Ende der Teilnahmephase noch verändern, weil weitere Personen dazukommen können.'
            : 'Die Teilnahme ist geschlossen – die Chancen sind damit endgültig.'}{' '}
          Der Gewinner wird auf dem Server bestimmt, nicht im Browser.
        </p>
      </section>

      {raffle.participantsPublic && active.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Teilnehmende ({formatNumber(active.length)})</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {active.slice(0, 50).map((entry) => (
              <li key={entry.entryId} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <DiscordAvatar
                  discordId={entry.discordId}
                  name={entry.displayName ?? entry.username ?? 'Mitglied'}
                  size={32}
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {entry.displayName ?? entry.username ?? 'Mitglied'}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatXp(entry.entryXp)} · {formatChance(entry.chance)}
                </span>
              </li>
            ))}
          </ul>
          {active.length > 50 ? (
            <p className="text-xs text-muted-foreground">
              Zeigt die ersten 50 von {formatNumber(active.length)} Teilnehmenden.
            </p>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function Kennzahl({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 line-clamp-2 text-sm font-semibold">{value}</dd>
    </div>
  );
}
