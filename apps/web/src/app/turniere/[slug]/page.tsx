import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CalendarClock, CalendarDays, Gamepad2, Radio, Shield, Trophy, Users } from 'lucide-react';
import { isModuleEnabled, tournaments } from '@swisshub/modules';
import { formatDayTime, formatRemaining } from '@swisshub/shared';
import { Markdown } from '@/components/shared/markdown';
import { EmptyState } from '@/components/shared/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { BracketView } from '@/modules/tournaments/components/bracket-view';
import { RegistrationPanel } from '@/modules/tournaments/components/registration-panel';
import { InviteInbox, TeamPanel } from '@/modules/tournaments/components/team-panel';
import {
  CheckinStatusBadge,
  FORMAT_LABEL,
  RegistrationStatusBadge,
  TournamentStatusBadge,
} from '@/modules/tournaments/components/tournament-badges';
import { csrfTokenFor, getOptionalAuthContext } from '@/server/auth';
import { tournamentViewer } from '@/server/tournaments';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const turnier = await tournaments.getPublicTournament(slug).catch(() => null);
  if (!turnier) {
    return { title: 'Turnier' };
  }
  return {
    title: turnier.name,
    description:
      turnier.description?.slice(0, 200) ??
      `${turnier.gameName} · ${FORMAT_LABEL[turnier.format] ?? turnier.format}`,
  };
}

/**
 * Die öffentliche Turnierseite.
 *
 * Eine Seite für alle: wer nicht angemeldet ist, sieht Ausschreibung, Bracket
 * und Resultate; wer angemeldet ist, sieht zusätzlich den eigenen Stand und
 * genau den Knopf, der gerade dran ist. Es gibt keine zweite Ansicht für
 * Teilnehmer - dieselbe Seite, mehr Inhalt.
 *
 * Alles Dargestellte ist eine Bequemlichkeit. Ob jemand anmelden, einchecken
 * oder ein Team ändern darf, entscheidet bei jedem Klick erneut der Server.
 */
export default async function TurnierSeite({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;

  if (!(await isModuleEnabled(tournaments.TOURNAMENTS_MODULE_ID))) {
    notFound();
  }

  const turnier = await tournaments.getPublicTournament(slug);
  if (!turnier) {
    notFound();
  }

  const context = await getOptionalAuthContext();

  // Ein Entwurf ist keine öffentliche Seite. Für die Leitung soll die Vorschau
  // trotzdem erreichbar sein - deshalb wird hier nicht am Status, sondern am
  // Zugriff entschieden.
  if (!tournaments.OEFFENTLICHE_STATUS.includes(turnier.status)) {
    const zugriff = context
      ? await tournaments.getTournamentAccess(tournamentViewer(context), turnier)
      : null;
    if (!zugriff?.view) {
      notFound();
    }
  }

  const [teilnehmer, bracket, eigenerStand, eigeneTeams, einladungen] = await Promise.all([
    tournaments.getPublicParticipants(turnier.id),
    tournaments.getBracket(turnier.id),
    context ? tournaments.getEigenerStand(turnier.id, context.user.discordId) : Promise.resolve(null),
    context ? tournaments.listEigeneTeams(turnier.id, context.user.discordId) : Promise.resolve([]),
    context ? tournaments.listInvitesFor(context.user.discordId, turnier.id) : Promise.resolve([]),
  ]);

  // Die Eignung nur prüfen, wenn sie jemanden betrifft: sie fragt Discord und
  // das Level-System, und für eine reine Zuschauerin ist das umsonst.
  const eignung =
    context && !eigenerStand?.angemeldet
      ? await tournaments
          .checkEligibility(turnier, context.user.discordId)
          .catch(() => ({ eligible: true, reasons: [] as string[] }))
      : { eligible: true, reasons: [] as string[] };

  const eigenesTeam =
    context && eigenerStand?.teamId && eigenerStand.istCaptain
      ? await tournaments.getTeamMitEinladungen(eigenerStand.teamId)
      : null;

  const bestaetigte = teilnehmer.filter((eintrag) => eintrag.status === 'CONFIRMED');
  const warteliste = teilnehmer.filter((eintrag) => eintrag.status === 'WAITLISTED');
  const csrfToken = context ? csrfTokenFor(context) : '';
  const streamUrl = turnier.streamUrl ?? turnier.twitchUrl ?? turnier.youtubeUrl;

  return (
    <div className="space-y-8">
      <Hero turnier={turnier} bestaetigte={bestaetigte.length} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* --- Inhalt ------------------------------------------------- */}
        <div className="min-w-0">
          <Tabs defaultValue={turnier.status === 'RUNNING' ? 'bracket' : 'info'}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="info">Übersicht</TabsTrigger>
              {turnier.rules ? <TabsTrigger value="regeln">Regeln</TabsTrigger> : null}
              <TabsTrigger value="teilnehmer">
                Teilnehmer
                <Badge variant="secondary">{bestaetigte.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="bracket">Bracket</TabsTrigger>
              {turnier.prizes.length > 0 ? <TabsTrigger value="preise">Preise</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="info" className="space-y-6">
              {turnier.description ? (
                <Markdown text={turnier.description} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Zu diesem Turnier gibt es noch keine Beschreibung.
                </p>
              )}
              <Zeitplan turnier={turnier} />
              <Leitung staff={turnier.staff} />
            </TabsContent>

            {turnier.rules ? (
              <TabsContent value="regeln" className="space-y-4">
                <div className="rounded-2xl border border-border p-5">
                  <Markdown text={turnier.rules} />
                </div>
                {turnier.rulesUrl ? (
                  <p className="text-xs text-muted-foreground">
                    Ergänzendes Regelwerk:{' '}
                    <a
                      href={turnier.rulesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      {turnier.rulesUrl}
                    </a>
                  </p>
                ) : null}
              </TabsContent>
            ) : null}

            <TabsContent value="teilnehmer">
              <Teilnehmerliste
                bestaetigte={bestaetigte}
                warteliste={warteliste}
                checkinSichtbar={turnier.status === 'CHECKIN_OPEN' || turnier.status === 'CHECKIN_CLOSED'}
              />
            </TabsContent>

            <TabsContent value="bracket">
              <BracketView
                abschnitte={bracket.map((abschnitt) => ({
                  id: abschnitt.id,
                  name: abschnitt.name,
                  kind: abschnitt.kind,
                  roundCount: abschnitt.roundCount,
                  groups: abschnitt.groups,
                  matches: abschnitt.matches,
                }))}
              />
            </TabsContent>

            {turnier.prizes.length > 0 ? (
              <TabsContent value="preise">
                <Preisliste prizes={turnier.prizes} />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>

        {/* --- Seitenspalte ------------------------------------------- */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          {einladungen.length > 0 ? (
            <InviteInbox
              csrfToken={csrfToken}
              einladungen={einladungen.map((einladung) => ({
                id: einladung.id,
                teamName: einladung.team.name,
                turnier: turnier.name,
                role: einladung.role,
              }))}
            />
          ) : null}

          <RegistrationPanel
            tournamentId={turnier.id}
            csrfToken={csrfToken}
            status={turnier.status}
            mode={turnier.mode}
            rulesVersion={turnier.rulesVersion}
            fragen={turnier.customFields.map((feld) => ({
              id: feld.id,
              kind: feld.kind,
              label: feld.label,
              description: feld.description,
              placeholder: feld.placeholder,
              required: feld.required,
              options: feld.options,
              maxLength: feld.maxLength,
            }))}
            eigenerStand={
              eigenerStand ?? {
                angemeldet: false,
                registrationId: null,
                status: null,
                waitlistPosition: null,
                checkinStatus: null,
                teamId: null,
                teamName: null,
                istCaptain: false,
              }
            }
            eigeneTeams={eigeneTeams
              .filter((team) => !team.angemeldet)
              .map((team) => ({
                id: team.id,
                name: team.name,
                spieler: team.spieler,
                mindestens: turnier.minTeamSize,
              }))}
            angemeldet={context !== null}
            eignung={eignung.reasons}
          />

          {eigenesTeam ? (
            <TeamPanel
              teamId={eigenesTeam.id}
              csrfToken={csrfToken}
              mitglieder={eigenesTeam.members.map((mitglied) => ({
                id: mitglied.id,
                discordId: mitglied.discordId,
                username: mitglied.username,
                role: mitglied.role,
              }))}
              einladungen={eigenesTeam.invites.map((einladung) => ({
                id: einladung.id,
                discordId: einladung.discordId,
                username: einladung.username,
                role: einladung.role,
                expiresAt: einladung.expiresAt,
              }))}
              istCaptain
              rosterOffen={tournaments.rosterOffen(turnier, eigenesTeam)}
              maxSpieler={turnier.maxTeamSize}
              maxErsatz={turnier.maxSubstitutes}
            />
          ) : null}

          <Eckdaten turnier={turnier} bestaetigte={bestaetigte.length} />

          {streamUrl ? (
            <a
              href={streamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
            >
              <Radio aria-hidden="true" />
              Zum Livestream
            </a>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

type PublicTurnier = NonNullable<Awaited<ReturnType<typeof tournaments.getPublicTournament>>>;

function Hero({ turnier, bestaetigte }: { turnier: PublicTurnier; bestaetigte: number }): React.JSX.Element {
  const naechsteFrist = naechsterTermin(turnier);

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card/40">
      <div className="relative h-40 w-full bg-surface-gradient sm:h-56">
        {turnier.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={turnier.bannerUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Trophy className="size-12 text-muted-foreground/30" aria-hidden="true" />
          </div>
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/40 to-transparent"
          aria-hidden="true"
        />
      </div>

      <div className="space-y-3 p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <TournamentStatusBadge status={turnier.status} />
          <Badge variant="outline">{turnier.mode === 'TEAM' ? 'Team' : 'Einzel'}</Badge>
          <Badge variant="outline">{FORMAT_LABEL[turnier.format] ?? turnier.format}</Badge>
          {turnier.requiresPremium ? <Badge variant="warning">Nur mit Premium</Badge> : null}
        </div>

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{turnier.name}</h1>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Gamepad2 className="size-4 shrink-0" aria-hidden="true" />
            {turnier.game?.name ?? turnier.gameName}
          </span>
          {turnier.startsAt ? (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
              {formatDayTime(turnier.startsAt)}
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <Users className="size-4 shrink-0" aria-hidden="true" />
            {turnier.maxParticipants > 0
              ? `${bestaetigte} von ${turnier.maxParticipants}`
              : `${bestaetigte} angemeldet`}
          </span>
          {naechsteFrist ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
              {naechsteFrist}
            </span>
          ) : null}
        </div>

        {turnier.status === 'CANCELLED' && turnier.cancelReason ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm">
            Dieses Turnier wurde abgesagt: {turnier.cancelReason}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Welche Frist als nächste läuft - eine Zeile statt eines ganzen Zeitplans.
 *
 * Nur solange das Turnier noch vor sich hat, worauf gezählt wird. Ein
 * abgeschlossenes Turnier mit «Start in 3 Tagen» im Kopf ist kein Detail: es
 * lässt jemanden glauben, er könne noch mitspielen.
 */
function naechsterTermin(turnier: PublicTurnier): string | null {
  const VORHER: string[] = [
    'REGISTRATION_OPEN',
    'REGISTRATION_CLOSED',
    'CHECKIN_OPEN',
    'CHECKIN_CLOSED',
    'READY',
  ];
  if (!VORHER.includes(turnier.status)) {
    return null;
  }

  const jetzt = new Date();
  const kandidaten: Array<[Date | null, string]> = [
    [turnier.registrationClosesAt, 'Anmeldeschluss'],
    [turnier.checkinOpensAt, 'Check-in öffnet'],
    [turnier.checkinClosesAt, 'Check-in schliesst'],
    [turnier.startsAt, 'Start'],
  ];

  for (const [zeitpunkt, was] of kandidaten) {
    if (zeitpunkt && zeitpunkt.getTime() > jetzt.getTime()) {
      const rest = formatRemaining(zeitpunkt, jetzt);
      return rest ? `${was} in ${rest}` : null;
    }
  }
  return null;
}

function Zeitplan({ turnier }: { turnier: PublicTurnier }): React.JSX.Element | null {
  const punkte: Array<[Date | null, string]> = [
    [turnier.registrationOpensAt, 'Anmeldung öffnet'],
    [turnier.registrationClosesAt, 'Anmeldeschluss'],
    [turnier.checkinOpensAt, 'Check-in öffnet'],
    [turnier.checkinClosesAt, 'Check-in schliesst'],
    [turnier.startsAt, 'Turnierstart'],
    [turnier.estimatedEndAt, 'Voraussichtliches Ende'],
  ];
  const gesetzt = punkte.filter((punkt): punkt is [Date, string] => punkt[0] !== null);

  if (gesetzt.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Zeitplan</h2>
      <ol className="space-y-0">
        {gesetzt.map(([zeitpunkt, was], index) => (
          <li key={was} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  zeitpunkt.getTime() < Date.now() ? 'bg-primary' : 'bg-border',
                )}
                aria-hidden="true"
              />
              {index < gesetzt.length - 1 ? (
                <span className="w-px flex-1 bg-border" aria-hidden="true" />
              ) : null}
            </div>
            <div className="pb-4">
              <p className="text-sm font-medium">{was}</p>
              <p className="text-xs text-muted-foreground">{formatDayTime(zeitpunkt)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Leitung({ staff }: { staff: PublicTurnier['staff'] }): React.JSX.Element | null {
  if (staff.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Turnierleitung</h2>
      <ul className="flex flex-wrap gap-2">
        {staff.map((person) => (
          <li
            key={person.discordId}
            className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm"
          >
            <Shield className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {person.username}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Eckdaten({
  turnier,
  bestaetigte,
}: {
  turnier: PublicTurnier;
  bestaetigte: number;
}): React.JSX.Element {
  const zeilen: Array<[string, string]> = [
    ['Format', FORMAT_LABEL[turnier.format] ?? turnier.format],
    ['Modus', turnier.mode === 'TEAM' ? `Team (${turnier.minTeamSize}–${turnier.maxTeamSize})` : 'Einzel'],
    ['Match-Format', turnier.defaultBestOf > 1 ? `Best of ${turnier.defaultBestOf}` : 'Ein Spiel'],
    [
      'Teilnehmer',
      turnier.maxParticipants > 0 ? `${bestaetigte} von ${turnier.maxParticipants}` : `${bestaetigte}`,
    ],
  ];
  if (turnier.serverRegion) {
    zeilen.push(['Region', turnier.serverRegion]);
  }
  if (turnier.minLevel > 0) {
    zeilen.push(['Mindest-Level', `${turnier.minLevel}`]);
  }

  return (
    <dl className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border text-sm">
      {zeilen.map(([bezeichnung, wert]) => (
        <div key={bezeichnung} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <dt className="text-muted-foreground">{bezeichnung}</dt>
          <dd className="text-right font-medium">{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

type Teilnehmer = Awaited<ReturnType<typeof tournaments.getPublicParticipants>>[number];

function Teilnehmerliste({
  bestaetigte,
  warteliste,
  checkinSichtbar,
}: {
  bestaetigte: Teilnehmer[];
  warteliste: Teilnehmer[];
  checkinSichtbar: boolean;
}): React.JSX.Element {
  if (bestaetigte.length === 0 && warteliste.length === 0) {
    return (
      <EmptyState
        title="Noch keine Teilnehmer"
        description="Sobald sich die ersten anmelden, stehen sie hier."
      />
    );
  }

  return (
    <div className="space-y-6">
      {bestaetigte.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {bestaetigte.map((eintrag) => (
            <li key={eintrag.registrationId} className="rounded-xl border border-border px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium">
                  {eintrag.team?.name ?? eintrag.username}
                  {eintrag.team?.tag ? (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">{eintrag.team.tag}</span>
                  ) : null}
                </span>
                {eintrag.participant?.seed ? (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    Seed {eintrag.participant.seed}
                  </span>
                ) : null}
              </div>

              {eintrag.team && eintrag.team.members.length > 0 ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {eintrag.team.members.map((mitglied) => mitglied.username).join(', ')}
                </p>
              ) : null}

              {checkinSichtbar ? (
                <div className="mt-2">
                  <CheckinStatusBadge status={eintrag.checkinStatus} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {warteliste.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Warteliste</h3>
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {warteliste.map((eintrag) => (
              <li key={eintrag.registrationId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">
                  {eintrag.waitlistPosition ?? '–'}
                </span>
                <span className="min-w-0 flex-1 truncate">{eintrag.team?.name ?? eintrag.username}</span>
                <RegistrationStatusBadge status={eintrag.status} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Preisliste({ prizes }: { prizes: PublicTurnier['prizes'] }): React.JSX.Element {
  const PLATZ: Record<number, string> = { 1: '1. Platz', 2: '2. Platz', 3: '3. Platz' };

  return (
    <ul className="space-y-3">
      {prizes.map((preis) => (
        <li key={preis.id} className="flex gap-4 rounded-xl border border-border p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border font-mono text-sm">
            {preis.placement}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-muted-foreground">
              {PLATZ[preis.placement] ?? `${preis.placement}. Platz`}
            </p>
            <p className="font-medium">{preis.title}</p>
            {preis.value ? <p className="text-sm text-primary">{preis.value}</p> : null}
            {preis.description ? <p className="text-sm text-muted-foreground">{preis.description}</p> : null}
            {preis.sponsorName ? (
              <p className="text-xs text-muted-foreground">
                Gestiftet von{' '}
                {preis.sponsorUrl ? (
                  <a
                    href={preis.sponsorUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-primary underline underline-offset-2"
                  >
                    {preis.sponsorName}
                  </a>
                ) : (
                  preis.sponsorName
                )}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
