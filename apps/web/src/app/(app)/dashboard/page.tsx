import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Blocks,
  CalendarDays,
  Gamepad2,
  Lock,
  Music,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Ticket,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { can } from '@swisshub/auth';
import {
  branding as brandingModule,
  calendar,
  enabledModuleIds,
  getModuleSettings,
  getSystemHealth,
  jail,
  listModuleStatus,
  verification,
} from '@swisshub/modules';
import { formatDateTime, formatRemaining, plural } from '@swisshub/shared';
import { StatCard, StatDelta } from '@/components/shared/stat-card';
import { Panel } from '@/components/shared/panel';
import { ActivityItem } from '@/components/shared/activity-item';
import { QuickAction } from '@/components/shared/quick-action';
import { ModuleCard } from '@/components/shared/module-card';
import { BrandBanner } from '@/components/shared/brand-banner';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { JailRowActions } from '@/modules/jail/components/jail-row-actions';
import { CreateJailDialog } from '@/modules/jail/components/create-jail-dialog';
import { SetupProgress } from '@/modules/configuration/components/setup-progress';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ordneAktionen, teileKennzahlen, type AktionId, type KennzahlId, type Lage } from './prioritaet';
import { loadDashboardData } from '@/server/dashboard';
import { moderationReasonTemplates } from '@/server/moderation';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const numberFormat = new Intl.NumberFormat(branding.locale);

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('dashboard.view');

  const canViewJails = can(context, jail.JAIL_PERMISSIONS.view);
  const canCreateJail = can(context, jail.JAIL_PERMISSIONS.create);
  const canReleaseJail = can(context, jail.JAIL_PERMISSIONS.release);
  const canViewAudit = can(context, 'audit.view');
  const canViewMembers = can(context, 'members.view');
  const canManageModules = can(context, 'modules.manage');
  const canViewSettings = can(context, 'settings.view');
  const canViewModeration = can(context, 'moderation.view');
  // Die drei Wege eines gewoehnlichen Mitglieds. Jeweils genau die
  // Berechtigung, die auch die Zielseite verlangt - und nur, solange das
  // Modul ueberhaupt eingeschaltet ist. Genau so filtert auch die
  // Seitenleiste; eine Schnellaktion in ein abgeschaltetes Modul waere ein
  // Weg, der ins Leere fuehrt.
  const darfNutzen = (permission: string, moduleId: string): boolean =>
    can(context, permission) && moduleIds.has(moduleId);

  const [data, moduleStatus, moduleIds, jailSettings, health, logoUrl, grundVorlagen] = await Promise.all([
    loadDashboardData({ canViewJails, canViewAudit, canViewModeration }),
    listModuleStatus(),
    enabledModuleIds(),
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    canViewSettings ? getSystemHealth() : Promise.resolve(null),
    brandingModule.currentLogoUrl(),
    moderationReasonTemplates('JAIL'),
  ]);

  /**
   * Die naechsten Termine aus dem Community-Kalender.
   *
   * Nur, wenn das Modul eingeschaltet ist **und** der Betrachter den Kalender
   * sehen darf - was er nicht sehen darf, wird auch nicht geladen. Faellt die
   * Abfrage aus, bleibt die Karte weg; das Dashboard soll deswegen nicht
   * scheitern.
   */
  const kommendeEvents = darfNutzen(calendar.CALENDAR_PERMISSIONS.view, calendar.CALENDAR_MODULE_ID)
    ? await calendar.listUpcoming(3, { viewerDiscordId: context.user.discordId }).catch(() => [])
    : [];

  /**
   * Wie viele Verifikationen auf eine Entscheidung warten.
   *
   * Nur fuer Staff, das Vorgaenge auch pruefen darf - ein gewoehnliches
   * Mitglied sieht die Zahl nicht. Faellt die Abfrage aus, bleibt die
   * Kennzahl weg statt eine Null zu behaupten.
   */
  const offeneVerifikationen = darfNutzen(
    verification.VERIFICATION_PERMISSIONS.review,
    verification.VERIFICATION_MODULE_ID,
  )
    ? await verification.offeneAnzahl().catch(() => null)
    : null;

  const csrfToken = csrfTokenFor(context);
  const anzeigename = context.user.displayName;

  const canCreateTicket = darfNutzen('tickets.create', 'tickets');
  const canCreateSpielersuche = darfNutzen('spielersuche.create', 'spielersuche');
  const canUseMusic = darfNutzen('music.view', 'music');

  /**
   * Jede Kennzahl einmal beschrieben.
   *
   * Beschriftung, Wert, Hinweis und Symbol stehen hier - unabhaengig davon,
   * ob die Kennzahl gleich als Karte oben oder als Angabe in der Kontextzeile
   * erscheint. Zwei Beschreibungen derselben Zahl liefen auseinander; die
   * Zeile soll nicht weniger sagen als die Karte, nur leiser.
   */
  const kennzahlen: Record<
    KennzahlId,
    {
      label: string;
      value: string | number;
      hint: React.ReactNode;
      icon: React.ReactNode;
      tone: 'default' | 'success' | 'warning' | 'destructive';
    }
  > = {
    mitglieder: {
      label: 'Mitglieder',
      value: data.memberCount !== null ? numberFormat.format(data.memberCount) : '-',
      hint: data.discordReachable ? (
        data.onlineCount !== null ? (
          <span className="flex items-center gap-1.5">
            online: {numberFormat.format(data.onlineCount)}
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          </span>
        ) : (
          'Aktuell auf Discord'
        )
      ) : (
        'Discord derzeit nicht erreichbar'
      ),
      icon: <Users />,
      tone: 'default',
    },
    jails: {
      label: 'Aktive Jails',
      value: data.jailStats?.active ?? 0,
      hint:
        data.jailStats && data.jailStats.endingSoon > 0
          ? `${data.jailStats.endingSoon} enden in der nächsten Stunde`
          : 'Keine bevorstehenden Freilassungen',
      icon: <Lock />,
      tone: (data.jailStats?.active ?? 0) > 0 ? 'warning' : 'default',
    },
    verifikationen: {
      label: 'Verifikationen offen',
      value: offeneVerifikationen ?? 0,
      hint: (offeneVerifikationen ?? 0) > 0 ? 'Warten auf eine Entscheidung' : 'Nichts zu prüfen',
      icon: <ShieldCheck />,
      tone: (offeneVerifikationen ?? 0) > 0 ? 'warning' : 'default',
    },
    bot: {
      label: 'Bot',
      value: data.bot.online ? 'Online' : 'Offline',
      hint: data.bot.online
        ? data.bot.wsPingMs !== null
          ? `Ping: ${data.bot.wsPingMs} ms`
          : 'Discord verbunden'
        : data.bot.lastHeartbeatAt
          ? `Letzter Heartbeat: ${formatDateTime(data.bot.lastHeartbeatAt)}`
          : 'Noch kein Heartbeat empfangen',
      icon: <Activity />,
      tone: data.bot.online ? 'success' : 'destructive',
    },
    aktionen: {
      label: 'Aktionen heute',
      value: data.actionsToday ?? 0,
      hint:
        data.actionsTrend !== null ? (
          <>
            <StatDelta value={data.actionsTrend} suffix="%" /> zum Vortag
          </>
        ) : data.jailStats ? (
          // Ohne Vergleichswert der Vortag - aber nur, wenn diese Person die
          // Jail-Zahlen ohnehin sehen darf.
          `${plural(data.jailStats.createdToday, 'Jail', 'Jails')} · ${plural(
            data.jailStats.releasedToday,
            'Freilassung',
            'Freilassungen',
          )}`
        ) : (
          'Kein Vergleichswert'
        ),
      icon: <TrendingUp />,
      tone: 'default',
    },
  };

  /**
   * Welche Kennzahlen dieser Betrachter ueberhaupt sieht.
   *
   * Dieselben Bedingungen wie zuvor, nur an einer Stelle statt verteilt ueber
   * fuenf Bloecke im Markup: die Mitgliederzahl und der Bot-Zustand stehen
   * jedem offen, die Jail-Zahlen und die Moderationsaktionen haengen an ihrer
   * Berechtigung, die Verifikationen an der Pruefberechtigung.
   */
  const sichtbareKennzahlen: KennzahlId[] = [
    'mitglieder',
    ...(data.jailStats ? (['jails'] as const) : []),
    ...(offeneVerifikationen !== null ? (['verifikationen'] as const) : []),
    'bot',
    ...(data.actionsToday !== undefined ? (['aktionen'] as const) : []),
  ];

  const lage: Lage = {
    jailsAktiv: data.jailStats?.active ?? null,
    verifikationenOffen: offeneVerifikationen,
    botOnline: data.bot.online,
  };

  const { wichtig, kontext } = teileKennzahlen(sichtbareKennzahlen, lage);

  /** Die Schnellaktionen dieses Betrachters, in ihrer Rangfolge. */
  const aktionen = ordneAktionen(
    [
      ...(offeneVerifikationen !== null ? (['verifikation'] as const) : []),
      ...(canCreateTicket ? (['ticket'] as const) : []),
      ...(canCreateSpielersuche ? (['spielersuche'] as const) : []),
      ...(canUseMusic ? (['musik'] as const) : []),
      ...(canCreateJail ? (['jail'] as const) : []),
      ...(canViewMembers ? (['mitglieder'] as const) : []),
      ...(canViewAudit ? (['audit'] as const) : []),
      ...(canViewSettings ? (['einstellungen'] as const) : []),
    ] satisfies AktionId[],
    lage,
  );

  /**
   * Jede Schnellaktion einmal beschrieben.
   *
   * Die Auswahl - wer welche sieht - steht weiter oben und hat sich nicht
   * geaendert: jede fuehrt auf eine Seite, die dieselbe Berechtigung
   * verlangt. Neu ist nur die Reihenfolge, und die kommt aus `ordneAktionen`.
   */
  const schnellaktionen: Record<AktionId, React.ReactNode> = {
    verifikation: (
      <QuickAction
        key="verifikation"
        title="Warteschlange"
        description={
          (offeneVerifikationen ?? 0) > 0
            ? `${plural(offeneVerifikationen ?? 0, 'Verifikation', 'Verifikationen')} offen`
            : 'Keine offenen Verifikationen'
        }
        icon={<ShieldCheck />}
        href="/verifikation/warteschlange"
      />
    ),
    ticket: (
      <QuickAction
        key="ticket"
        title="Ticket erstellen"
        description="Anliegen an das Support-Team"
        icon={<Ticket />}
        href="/tickets/neu"
      />
    ),
    spielersuche: (
      <QuickAction
        key="spielersuche"
        title="Spielersuche starten"
        description="Mitspieler finden"
        icon={<Gamepad2 />}
        href="/spielersuche/neu"
      />
    ),
    musik: (
      <QuickAction
        key="musik"
        title="Musik starten"
        description="Player und Warteschlange öffnen"
        icon={<Music />}
        href="/musik"
      />
    ),
    jail: (
      <QuickAction key="jail" title="Mitglied jailen" description="Neuen Jail erstellen" icon={<Lock />}>
        <CreateJailDialog
          csrfToken={csrfToken}
          durationPresets={jail.JAIL_DURATION_PRESETS}
          maxDurationSeconds={jailSettings.maxDurationSeconds}
          reasonPresets={grundVorlagen}
          announceByDefault={!jailSettings.silentByDefault}
          variant="quick-action"
          triggerLabel="Mitglied jailen"
        />
      </QuickAction>
    ),
    mitglieder: (
      <QuickAction
        key="mitglieder"
        title="Mitglied suchen"
        description="Nach Mitgliedern suchen"
        icon={<Search />}
        href="/members"
      />
    ),
    audit: (
      <QuickAction
        key="audit"
        title="Audit Log"
        description="Logs und Aktivitäten"
        icon={<ScrollText />}
        href="/audit"
      />
    ),
    einstellungen: (
      <QuickAction
        key="einstellungen"
        title="Einstellungen"
        description="Bot und System konfigurieren"
        icon={<Settings />}
        href="/settings"
      />
    ),
  };

  // Verfügbare Module zuerst, geplante als Ausblick dahinter.
  const visibleModules = moduleStatus
    .filter(
      (entry) =>
        !entry.definition.core &&
        entry.definition.navigation.some((item) => context.permissionKeys.includes(item.permission)),
    )
    .sort((a, b) => {
      // Eingeschaltete Module zuerst - was abgeschaltet ist, steht hinten.
      const rank = (entry: typeof a): number => (entry.enabled ? 0 : 1);
      return rank(a) - rank(b) || a.definition.name.localeCompare(b.definition.name);
    });

  return (
    <>
      {/*
        Begruessung und Einordnung.

        Eine Seite, die mit fuenf Zahlen beginnt, beantwortet die Frage «wo bin
        ich?» erst auf den zweiten Blick. Der Name kommt aus der Sitzung, nicht
        aus der Adresszeile.
      */}
      <header className="space-y-1">
        {/*
          Kein zweites `h1`: die Kopfzeile der Anwendung traegt bereits den
          Seitentitel. Zwei Ueberschriften erster Ordnung auf einer Seite sind
          fuer einen Screenreader zwei Seiten.
        */}
        <p className="text-lg font-medium">Willkommen zurück, {anzeigename}</p>
        <p className="text-sm text-muted-foreground">
          {wichtig.length > 0
            ? 'Das hier braucht gerade deine Aufmerksamkeit.'
            : 'Alles ruhig - hier ist der aktuelle Stand.'}
        </p>
      </header>

      {health && health.completeness < 100 ? (
        <section aria-label="Einrichtung" className="rounded-xl border border-warning/40 bg-warning/5 p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Einrichtung noch nicht abgeschlossen</h2>
            <Link
              href="/setup"
              className="inline-flex min-h-6 items-center text-sm text-primary hover:underline"
            >
              Zum Einrichtungsassistenten
            </Link>
          </div>
          <SetupProgress completeness={health.completeness} steps={health.steps} />
        </section>
      ) : null}

      {/*
        Wichtig zuerst, Kontext daneben.

        Vorher standen hier fuenf gleich grosse Karten: die Mitgliederzahl so
        laut wie die Zahl der Leute, die auf eine Entscheidung warten. Beides
        sind Zahlen, aber nur eine davon ist eine Aufgabe.

        Jede Kennzahl ist deshalb genau einmal beschrieben - Beschriftung,
        Wert, Hinweis, Symbol - und wird danach auf eine von zwei Arten
        gezeigt: als Karte, wenn sie gerade eine Handlung verlangt, sonst als
        Angabe in der Kontextzeile darueber. Eine Kennzahl mit zwei
        Beschreibungen liefe irgendwann auseinander; so kann die Zeile nicht
        weniger sagen als die Karte.

        Welche Kennzahl wann wichtig ist, entscheidet `teileKennzahlen` - eine
        reine Funktion, die ein Test ueber jede vorkommende Lage rechnet.
      */}
      {sichtbareKennzahlen.length > 0 ? (
        <section aria-label="Kennzahlen" className="space-y-5">
          {kontext.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {kontext.map((id, index) => (
                <span key={id} className="flex items-center gap-1.5">
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-border">
                      ·
                    </span>
                  ) : null}
                  <span className="font-medium tabular-nums text-foreground">{kennzahlen[id].value}</span>
                  <span>{kennzahlen[id].label}</span>
                  {kennzahlen[id].hint ? (
                    <span className="text-muted-foreground/70">({kennzahlen[id].hint})</span>
                  ) : null}
                </span>
              ))}
            </p>
          ) : null}

          {wichtig.length > 0 ? (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
              {wichtig.map((id) => (
                <StatCard
                  key={id}
                  label={kennzahlen[id].label}
                  value={kennzahlen[id].value}
                  hint={kennzahlen[id].hint}
                  icon={kennzahlen[id].icon}
                  tone={kennzahlen[id].tone}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {/*
        Die Schnellaktionen entstehen aus dem, was dieser Betrachter
        tatsaechlich darf. Fuer ein gewoehnliches Mitglied sind das die
        Community-Wege; fuer die Verwaltung kommen ihre eigenen dazu. Jede
        fuehrt auf eine Seite, die dieselbe Berechtigung verlangt - eine
        Schaltflaeche, die danach mit «keine Berechtigung» antwortet, gibt es
        hier nicht.

        Sie stehen jetzt oben statt in der rechten Spalte: «was kann ich als
        Naechstes tun?» ist die zweite Frage des Dashboards, nicht die letzte.
        Statt eines eigenen Rahmens traegt der Abschnitt nur seine
        Ueberschrift - die Eintraege sind bereits abgegrenzt genug.

        Bleibt nichts uebrig, verschwindet der ganze Abschnitt. Eine
        Ueberschrift ueber einer leeren Flaeche ist schlechter als keine.
      */}
      {aktionen.length > 0 ? (
        <section aria-labelledby="schnellaktionen" className="space-y-3">
          <h2 id="schnellaktionen" className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-muted-foreground" aria-hidden="true" />
            Schnellaktionen
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {aktionen.map((id) => schnellaktionen[id])}
          </div>
        </section>
      ) : null}

      {kommendeEvents.length > 0 ? (
        <Panel
          title="Nächste Events"
          icon={<CalendarDays />}
          action={{ label: 'Zum Kalender', href: '/kalender' }}
        >
          {/*
            Die Zeilen tragen keinen eigenen Rahmen mehr: ein Kasten im Kasten
            zieht zwei Linien um dieselbe Sache. Getrennt wird jetzt durch
            Abstand und eine Trennlinie, hervorgehoben durch die Farbe der
            Kategorie - die stand schon vorher links am Rand.
          */}
          <ul className="divide-y divide-border/50">
            {kommendeEvents.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/kalender/${event.slug}`}
                  className="-mx-2 flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent/40"
                >
                  <span
                    aria-hidden="true"
                    className="w-1 self-stretch rounded-full"
                    style={{ backgroundColor: event.category?.color ?? 'var(--color-primary)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{event.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat('de-CH', {
                        timeZone: event.timezone,
                        weekday: 'long',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(event.startAt)}
                    </span>
                  </span>
                  {event.registrationEnabled ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {event.capacity > 0 ? `${event.confirmed} / ${event.capacity}` : `${event.confirmed}`}{' '}
                      Teilnehmer
                    </span>
                  ) : null}
                  {event.meine ? (
                    <Badge
                      variant="outline"
                      className={
                        event.meine === 'CONFIRMED'
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                          : 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                      }
                    >
                      {event.meine === 'CONFIRMED' ? 'Angemeldet' : 'Warteliste'}
                    </Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {canViewJails ? (
            <Panel
              title="Aktive Jails"
              icon={<Lock />}
              action={{ label: 'Alle anzeigen', href: '/moderation/jail' }}
              bodyClassName="p-0"
            >
              {data.activeJails.length === 0 ? (
                <EmptyState
                  className="border-0"
                  title="Keine aktiven Jails"
                  description="Aktuell ist kein Mitglied gejailt."
                />
              ) : (
                <div className="relative overflow-x-auto scrollbar-slim">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Aktive Jail-Strafen</caption>
                    <thead>
                      <tr className="border-b border-border/70 text-left text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Mitglied
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Grund
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Moderator
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Ende
                        </th>
                        <th scope="col" className="px-5 py-3 font-semibold">
                          Verbleibend
                        </th>
                        <th scope="col" className="px-5 py-3">
                          <span className="sr-only">Aktionen</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.activeJails.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40"
                        >
                          <td className="px-5 py-3">
                            <Link
                              href={`/members/${entry.targetDiscordId}`}
                              className="flex items-center gap-3 hover:underline"
                            >
                              <DiscordAvatar
                                discordId={entry.targetDiscordId}
                                avatarHash={entry.targetAvatarHash}
                                name={entry.targetUsername}
                                size={32}
                              />
                              <span className="flex min-w-0 flex-col leading-tight">
                                <span className="truncate font-medium">
                                  {entry.targetDisplayName ?? entry.targetUsername}
                                </span>
                                <span className="truncate text-xs text-muted-foreground">
                                  @{entry.targetUsername}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="max-w-[12rem] px-5 py-3 text-muted-foreground">
                            <span className="line-clamp-1">{entry.reason}</span>
                          </td>
                          <td className="px-5 py-3">
                            <span className="flex items-center gap-2">
                              <DiscordAvatar
                                discordId={entry.moderatorDiscordId}
                                avatarHash={entry.moderatorAvatarHash}
                                name={entry.moderatorUsername}
                                size={24}
                              />
                              <span className="truncate font-medium">{entry.moderatorUsername}</span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                            {jail.jailEndLabel(entry, { short: true })}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 font-medium text-primary-bright">
                            {entry.endsAt
                              ? (formatRemaining(entry.endsAt) ?? 'Fällig')
                              : jail.PERMANENT_LABEL}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <JailRowActions
                              csrfToken={csrfToken}
                              jailId={entry.id}
                              memberLabel={entry.targetDisplayName ?? entry.targetUsername}
                              canRelease={canReleaseJail}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          ) : null}

          {/*
            Die Modulkacheln sind selbst schon Karten - ein Panel darum waere
            ein Rahmen um eine Reihe von Rahmen. Der Abschnitt traegt deshalb
            nur seine Ueberschrift und den Verweis nach rechts; die Kacheln,
            ihre Ziele und die Berechtigung dahinter sind unveraendert.
          */}
          <section aria-labelledby="module" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="module" className="flex items-center gap-2 text-sm font-semibold">
                <Blocks className="size-4 text-muted-foreground" aria-hidden="true" />
                Module
              </h2>
              {canManageModules ? (
                <Link
                  href="/modules"
                  className="inline-flex min-h-6 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Module verwalten
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>

            {visibleModules.length === 0 ? (
              // Ohne Panel darum traegt der Leerzustand seinen Rahmen wieder
              // selbst - sonst stuende der Satz frei in der Flaeche.
              <EmptyState
                title="Keine Module verfügbar"
                description="Dir sind derzeit keine Module zugewiesen."
              />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {visibleModules.map((entry) => (
                    <ModuleCard
                      key={entry.definition.id}
                      name={entry.definition.name}
                      description={entry.definition.tagline ?? entry.definition.description}
                      icon={entry.definition.icon}
                      enabled={entry.enabled && moduleIds.has(entry.definition.id)}
                      // Eingeschaltet: direkt ins Modul. Abgeschaltet: auf
                      // seine Seite unter «Module», wo es sich einschalten
                      // laesst - sonst waere die Kachel eine Sackgasse und das
                      // Modul waere zwar sichtbar, aber nicht erreichbar. Wer
                      // Module nicht verwalten darf, bekommt weiterhin keinen
                      // Verweis: die Seite stuende ihm ohnehin nicht offen.
                      href={
                        entry.enabled
                          ? (entry.definition.navigation[0]?.href ?? null)
                          : canManageModules
                            ? `/modules/${entry.definition.id}`
                            : null
                      }
                    />
                  ))}
                </div>
                <div className="accent-rule mt-5 w-40 rounded-full" aria-hidden="true" />
              </>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          {canViewAudit ? (
            <Panel
              title="Letzte Aktivitäten"
              icon={<Activity />}
              action={{ label: 'Alle', href: '/audit', ariaLabel: 'Alle Aktivitäten anzeigen' }}
              bodyClassName="px-5 py-1"
            >
              {data.recentActivity.length === 0 ? (
                <EmptyState
                  className="border-0"
                  title="Noch keine Aktivitäten"
                  description="Sobald Aktionen ausgeführt werden, erscheinen sie hier."
                />
              ) : (
                <ul className="divide-y divide-border/50">
                  {data.recentActivity.map((entry) => (
                    <ActivityItem
                      key={entry.id}
                      entry={{
                        id: entry.id,
                        action: entry.action,
                        createdAt: entry.createdAt,
                        actorUsername: entry.actorUsername,
                        actorDiscordId: entry.actorDiscordId,
                        actorAvatarHash: entry.actorAvatarHash,
                        targetLabel: entry.targetLabel ?? entry.targetDiscordId,
                        reason:
                          typeof entry.metadata === 'object' &&
                          entry.metadata !== null &&
                          'reason' in entry.metadata &&
                          typeof (entry.metadata as { reason?: unknown }).reason === 'string'
                            ? ((entry.metadata as { reason: string }).reason ?? null)
                            : null,
                        success: entry.success,
                      }}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>
      </div>

      <BrandBanner
        logoUrl={logoUrl}
        footnote={
          data.bot.online
            ? `Bot online${data.bot.wsPingMs !== null ? ` · Ping ${data.bot.wsPingMs} ms` : ''} · Zeitzone ${branding.timezone}`
            : `Bot derzeit nicht erreichbar · Zeitzone ${branding.timezone}`
        }
      />
    </>
  );
}
