import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Bot, Lock, ShieldAlert, UserX } from 'lucide-react';
import { can } from '@swisshub/auth';
import { getModuleSettings, isModuleEnabled, jail, members } from '@swisshub/modules';
import { formatDate, formatDateTime, snowflakeSchema } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { RoleBadge } from '@/components/shared/role-badge';
import { EmptyState } from '@/components/shared/states';
import { CreateJailDialog } from '@/modules/jail/components/create-jail-dialog';
import { ReleaseJailButton } from '@/modules/jail/components/release-jail-button';
import { NotesPanel } from '@/modules/members/components/notes-panel';
import { RoleManager } from '@/modules/members/components/role-manager';
import { XpPanel } from '@/modules/members/components/xp-panel';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { memberViewer } from '@/server/members';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mitglied' };
export const dynamic = 'force-dynamic';

/**
 * Die Mitgliederakte.
 *
 * Die Seite entscheidet nichts. Sie zeigt, was der Aggregator geliefert hat -
 * und der liefert nur, was der Betrachter sehen darf. Ein Abschnitt, der hier
 * fehlt, fehlt schon in der Antwort: es gibt nichts zu verstecken, weil nichts
 * geladen wurde.
 */

/** Die Reiter, in der Reihenfolge, in der sie erscheinen. */
const REITER = [
  { id: 'uebersicht', label: 'Übersicht' },
  { id: 'aktivitaet', label: 'Aktivität', section: 'activity' },
  { id: 'level', label: 'Level', section: 'level' },
  { id: 'spielersuche', label: 'Spielersuche', section: 'spielersuche' },
  { id: 'turniere', label: 'Turniere', section: 'tournaments' },
  { id: 'tickets', label: 'Tickets', section: 'tickets' },
  { id: 'premium', label: 'Premium', section: 'premium' },
  { id: 'rollen', label: 'Rollen', section: 'roles' },
  { id: 'moderation', label: 'Moderation', section: 'moderation' },
  { id: 'notizen', label: 'Notizen', section: 'notes' },
] as const;

export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ discordId: string }>;
  searchParams: Promise<{ tab?: string }>;
}): Promise<React.JSX.Element> {
  // Bewusst nicht `requirePagePermission('members.view')`: wer nur sein
  // eigenes Profil sehen darf, braucht die Mitgliedersuche nicht. Wer gar
  // nichts sehen darf, bekommt unten dieselbe Antwort wie bei einem
  // unbekannten Mitglied.
  const context = await requireMember();
  const raw = await params;
  const parsed = snowflakeSchema.safeParse(raw.discordId);
  if (!parsed.success) {
    notFound();
  }

  const viewer = memberViewer(context);
  const profil = await members.getMemberCenterProfile({
    viewer,
    targetDiscordId: parsed.data,
  });
  if (!profil) {
    notFound();
  }

  const { basic, capabilities } = profil;
  const sichtbar = new Set(profil.sichtbar);
  const fehler = new Set(profil.fehler.map((eintrag) => eintrag.section));
  const gewaehlt = (await searchParams).tab ?? 'uebersicht';

  const reiter = REITER.filter(
    (eintrag) => !('section' in eintrag) || sichtbar.has(eintrag.section),
  );
  const aktiv = reiter.some((eintrag) => eintrag.id === gewaehlt) ? gewaehlt : 'uebersicht';

  const csrfToken = csrfTokenFor(context);
  const [jailSettings, jailEnabled] = await Promise.all([
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    isModuleEnabled(jail.JAIL_MODULE_ID),
  ]);
  const canJail = capabilities.canJail && jailEnabled;

  // Die Rollenliste braucht Discord und ist nur fuer die Verwaltung da.
  const rollenAngebot = capabilities.canManageRoles
    ? await members
        .rollenAngebot(viewer, { discordId: basic.discordId, roleIds: basic.roles.map((r) => r.id) })
        .catch(() => [])
    : [];

  const nichtVerfuegbar = (
    <p className="text-sm text-muted-foreground">Daten momentan nicht verfügbar.</p>
  );

  return (
    <>
      <PageHeader
        title={basic.displayName}
        description={`@${basic.username}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {can(context, 'members.view') ? (
              <Link href="/members" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                <ArrowLeft aria-hidden="true" />
                Zurück
              </Link>
            ) : null}
            {basic.activeJail && capabilities.canReleaseJail ? (
              <ReleaseJailButton
                csrfToken={csrfToken}
                jailId={basic.activeJail.id}
                memberLabel={basic.displayName}
              />
            ) : null}
            {!basic.activeJail && canJail ? (
              <CreateJailDialog
                csrfToken={csrfToken}
                durationPresets={jail.JAIL_DURATION_PRESETS}
                maxDurationSeconds={jailSettings.maxDurationSeconds}
                announceByDefault={!jailSettings.silentByDefault}
                presetMember={{
                  discordId: basic.discordId,
                  username: basic.username,
                  displayName: basic.displayName,
                  avatarHash: basic.avatarHash,
                  jailed: false,
                }}
                triggerLabel="Mitglied jailen"
              />
            ) : null}
          </div>
        }
      />

      {!profil.discordVerfuegbar ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          Discord-Daten momentan nicht verfügbar. Der Verlauf unten stammt aus der Datenbank und ist
          vollständig.
        </p>
      ) : !profil.imServer ? (
        <p className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">
          <UserX className="size-4" aria-hidden="true" />
          Nicht mehr auf dem Server. Historische Daten bleiben erhalten.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Kopf ------------------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>
              {profil.discordVerfuegbar ? 'Live von Discord geladen.' : 'Aus der Datenbank.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <DiscordAvatar
                discordId={basic.discordId}
                avatarHash={basic.avatarHash}
                name={basic.displayName}
                size={64}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{basic.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">@{basic.username}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {basic.isBot ? (
                <Badge variant="secondary">
                  <Bot className="size-3" aria-hidden="true" />
                  Bot
                </Badge>
              ) : null}
              {basic.activeJail ? (
                <Badge variant="warning">
                  <Lock className="size-3" aria-hidden="true" />
                  {basic.activeJail.endsAt
                    ? `Gejailt bis ${formatDateTime(basic.activeJail.endsAt)}`
                    : 'Permanent gejailt'}
                </Badge>
              ) : null}
              {basic.timedOut ? (
                <Badge variant="destructive">
                  <ShieldAlert className="size-3" aria-hidden="true" />
                  Discord Timeout
                </Badge>
              ) : null}
              {basic.boosting ? <Badge variant="default">Server Booster</Badge> : null}
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Server-Beitritt</dt>
                <dd>{basic.joinedAt ? formatDate(basic.joinedAt) : 'unbekannt'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Account erstellt</dt>
                <dd>{basic.accountCreatedAt ? formatDate(basic.accountCreatedAt) : 'unbekannt'}</dd>
              </div>
            </dl>

            {profil.roles ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Rollen ({profil.roles.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {profil.roles.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Keine Rollen.</p>
                  ) : (
                    profil.roles.map((role) => (
                      <RoleBadge key={role.id} name={role.name} color={role.color} />
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* --- Reiter ----------------------------------------------------- */}
        <div className="space-y-4 lg:col-span-2">
          <nav
            aria-label="Bereiche"
            className="-mx-1 flex gap-1 overflow-x-auto scrollbar-slim px-1 pb-1"
          >
            {reiter.map((eintrag) => (
              <Link
                key={eintrag.id}
                href={`/members/${basic.discordId}?tab=${eintrag.id}`}
                aria-current={eintrag.id === aktiv ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  eintrag.id === aktiv
                    ? 'bg-primary/15 text-foreground ring-1 ring-primary/45'
                    : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                )}
              >
                {eintrag.label}
              </Link>
            ))}
          </nav>

          <Card>
            <CardContent className="space-y-4 pt-6">
              {aktiv === 'uebersicht' ? (
                <Uebersicht profil={profil} />
              ) : aktiv === 'aktivitaet' ? (
                fehler.has('activity') ? (
                  nichtVerfuegbar
                ) : (
                  <Aktivitaet activity={profil.activity} />
                )
              ) : aktiv === 'level' ? (
                fehler.has('level') ? (
                  nichtVerfuegbar
                ) : (
                  <>
                    <LevelAnsicht level={profil.level} />
                    {capabilities.canManageXp ? (
                      <XpPanel discordId={basic.discordId} csrfToken={csrfToken} />
                    ) : null}
                  </>
                )
              ) : aktiv === 'spielersuche' ? (
                fehler.has('spielersuche') ? (
                  nichtVerfuegbar
                ) : (
                  <Spielersuche daten={profil.spielersuche} />
                )
              ) : aktiv === 'turniere' ? (
                fehler.has('tournaments') ? (
                  nichtVerfuegbar
                ) : (
                  <Turniere daten={profil.tournaments} />
                )
              ) : aktiv === 'tickets' ? (
                fehler.has('tickets') ? (
                  nichtVerfuegbar
                ) : (
                  <Tickets zeilen={profil.tickets ?? []} />
                )
              ) : aktiv === 'premium' ? (
                fehler.has('premium') ? (
                  nichtVerfuegbar
                ) : (
                  <PremiumAnsicht daten={profil.premium ?? null} />
                )
              ) : aktiv === 'rollen' ? (
                capabilities.canManageRoles ? (
                  <RoleManager
                    discordId={basic.discordId}
                    csrfToken={csrfToken}
                    rollen={rollenAngebot.map((rolle) => ({
                      id: rolle.id,
                      name: rolle.name,
                      color: rolle.color,
                      vergeben: rolle.vergeben,
                      verwaltbar: rolle.verwaltbar,
                      grund: rolle.grund,
                    }))}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {(profil.roles ?? []).map((role) => (
                      <RoleBadge key={role.id} name={role.name} color={role.color} />
                    ))}
                  </div>
                )
              ) : aktiv === 'moderation' ? (
                fehler.has('moderation') ? (
                  nichtVerfuegbar
                ) : (
                  <Moderation daten={profil.moderation} />
                )
              ) : aktiv === 'notizen' ? (
                fehler.has('notes') ? (
                  nichtVerfuegbar
                ) : (
                  <NotesPanel
                    discordId={basic.discordId}
                    csrfToken={csrfToken}
                    canCreate={capabilities.canCreateNote}
                    notizen={(profil.notes ?? []).map((notiz) => ({
                      id: notiz.id,
                      content: notiz.content,
                      category: notiz.category,
                      pinned: notiz.pinned,
                      author: notiz.author,
                      createdAt: notiz.createdAt.toISOString(),
                      editedAt: notiz.editedAt?.toISOString() ?? null,
                      canEdit: notiz.canEdit,
                      canDelete: notiz.canDelete,
                    }))}
                  />
                )
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * Die Übersicht.
 *
 * Zeigt nur Kacheln zu Abschnitten, die dieser Betrachter ohnehin sehen darf.
 * Eine Kachel «0 Jails» waere bereits eine Auskunft aus der Moderationsakte -
 * auch eine Null sagt etwas.
 */
function Uebersicht({
  profil,
}: {
  profil: members.MemberCenterProfile;
}): React.JSX.Element {
  const kacheln: Array<{ label: string; wert: string }> = [];

  if (profil.level) {
    kacheln.push({ label: 'Level', wert: `${profil.level.level} · ${profil.level.xp} XP` });
  }
  if (profil.spielersuche) {
    kacheln.push({ label: 'Spielersuchen', wert: String(profil.spielersuche.erstellt) });
  }
  if (profil.tournaments) {
    kacheln.push({ label: 'Turniere', wert: String(profil.tournaments.gesamt) });
  }
  if (profil.tickets) {
    kacheln.push({ label: 'Tickets', wert: String(profil.tickets.length) });
  }
  if (profil.premium !== undefined) {
    kacheln.push({ label: 'Premium', wert: profil.premium?.aktiv ? 'Aktiv' : 'Kein Abo' });
  }
  if (profil.moderation) {
    kacheln.push({ label: 'Jails', wert: String(profil.moderation.jailsGesamt) });
  }

  if (kacheln.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Nichts freigegeben"
        description="Für dieses Mitglied sind dir keine weiteren Bereiche freigegeben."
      />
    );
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {kacheln.map((kachel) => (
        <div key={kachel.label} className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{kachel.label}</dt>
          <dd className="mt-1 text-lg font-semibold">{kachel.wert}</dd>
        </div>
      ))}
    </dl>
  );
}

function Aktivitaet({ activity }: { activity?: members.MemberActivity }): React.JSX.Element {
  if (!activity) {
    return <EmptyState className="border-0" title="Keine Aktivität" description="Nichts erfasst." />;
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Nachrichten</dt>
          <dd className="mt-1 text-lg font-semibold">{activity.messagesGesamt}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Voice-Minuten</dt>
          <dd className="mt-1 text-lg font-semibold">{activity.voiceMinutenGesamt}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Zeitraum</th>
              <th className="pb-2 pr-4 font-medium">XP</th>
              <th className="pb-2 pr-4 font-medium">Spielersuchen</th>
              <th className="pb-2 pr-4 font-medium">Talks</th>
              <th className="pb-2 font-medium">Turniere</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {activity.fenster.map((fenster) => (
              <tr key={fenster.tage}>
                <td className="py-2 pr-4">{fenster.tage} Tage</td>
                <td className="py-2 pr-4">{fenster.xpSumme}</td>
                <td className="py-2 pr-4">{fenster.spielersuchen}</td>
                <td className="py-2 pr-4">{fenster.talks}</td>
                <td className="py-2">{fenster.turniere}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Nachrichten und Voice-Zeit führt das Level-System als Gesamtzahlen - für sie gibt es keine
        Zeiträume, und dafür eine Erfassung einzuführen wäre neue Überwachung für eine Anzeige.
      </p>
    </div>
  );
}

function LevelAnsicht({ level }: { level?: members.MemberLevelView }): React.JSX.Element {
  if (!level) {
    return (
      <EmptyState className="border-0" title="Kein Level" description="Noch keine XP gesammelt." />
    );
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Level</dt>
          <dd className="mt-1 text-lg font-semibold">{level.level}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">XP</dt>
          <dd className="mt-1 text-lg font-semibold">{level.xp}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Rang</dt>
          <dd className="mt-1 text-lg font-semibold">{level.rang ?? '–'}</dd>
        </div>
      </dl>
      {level.hoechstlevel ? (
        <p className="text-sm text-muted-foreground">Höchstlevel erreicht.</p>
      ) : (
        <div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent-gradient"
              style={{ width: `${Math.round(level.fortschritt * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Noch {level.fehlendeXp} XP bis Level {level.level + 1}.
          </p>
        </div>
      )}
    </div>
  );
}

function Spielersuche({
  daten,
}: {
  daten?: members.MemberSpielersucheView;
}): React.JSX.Element {
  if (!daten) {
    return <EmptyState className="border-0" title="Keine Spielersuchen" description="Nichts erfasst." />;
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Erstellt</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.erstellt}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Beigetreten</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.beigetreten}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Aktiv</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.aktive}</dd>
        </div>
      </dl>
      {daten.letzte.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Spielersuchen.</p>
      ) : (
        <ul className="divide-y divide-border">
          {daten.letzte.map((suche) => (
            <li key={suche.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="truncate">{suche.gameName}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                <Badge variant="outline">{suche.status}</Badge>
                {formatDate(suche.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Turniere({ daten }: { daten?: members.MemberTournamentView }): React.JSX.Element {
  if (!daten || daten.teilnahmen.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Noch keine Turnierteilnahmen"
        description="Dieses Mitglied hat noch an keinem Turnier teilgenommen."
      />
    );
  }
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Teilnahmen</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.gesamt}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Siege</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.siege}</dd>
        </div>
        <div className="rounded-xl border border-border px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Podeste</dt>
          <dd className="mt-1 text-lg font-semibold">{daten.podeste}</dd>
        </div>
      </dl>
      <ul className="divide-y divide-border">
        {daten.teilnahmen.map((eintrag) => (
          <li key={eintrag.turnier.id} className="py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/turniere/${eintrag.turnier.slug}`}
                className="min-w-0 truncate font-medium hover:underline"
              >
                {eintrag.turnier.name}
              </Link>
              <span className="flex items-center gap-2">
                {eintrag.platzierung !== null ? (
                  <Badge variant="secondary">Platz {eintrag.platzierung}</Badge>
                ) : null}
                <Badge variant="outline">{eintrag.turnier.status}</Badge>
              </span>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {eintrag.turnier.gameName}
              {eintrag.team ? ` · Team ${eintrag.team}` : ''}
              {eintrag.turnier.startsAt ? ` · ${formatDate(eintrag.turnier.startsAt)}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tickets({ zeilen }: { zeilen: members.MemberTicketRow[] }): React.JSX.Element {
  if (zeilen.length === 0) {
    return (
      <EmptyState
        className="border-0"
        title="Keine Tickets vorhanden"
        description="Für dieses Mitglied sind dir keine Tickets sichtbar."
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {zeilen.map((ticket) => (
        <li key={ticket.id} className="py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/tickets/${ticket.id}`} className="min-w-0 truncate font-medium hover:underline">
              #{ticket.nummer} · {ticket.betreff}
            </Link>
            <span className="flex items-center gap-2">
              <Badge variant="outline">{ticket.status}</Badge>
              <Badge variant="secondary">{ticket.prioritaet}</Badge>
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {ticket.kategorie ?? 'Ohne Kategorie'} · erstellt {formatDate(ticket.erstelltAm)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PremiumAnsicht({ daten }: { daten: members.MemberPremiumView | null }): React.JSX.Element {
  if (!daten) {
    return (
      <EmptyState className="border-0" title="Kein Premium" description="Kein Abonnement vorhanden." />
    );
  }
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Status</dt>
        <dd>{daten.aktiv ? 'Aktiv' : (daten.status ?? 'Kein Abo')}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Plan</dt>
        <dd>{daten.plan ?? '–'}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Laufend seit</dt>
        <dd>{daten.beginn ? formatDate(daten.beginn) : '–'}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Läuft bis</dt>
        <dd>{daten.ende ? formatDate(daten.ende) : '–'}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Stübli</dt>
        <dd>{daten.discordRolleGesetzt ? 'Vorhanden' : '–'}</dd>
      </div>
    </dl>
  );
}

function Moderation({ daten }: { daten?: members.MemberModerationView }): React.JSX.Element {
  if (!daten || (daten.jailHistory.length === 0 && daten.moderationHistory.length === 0)) {
    return (
      <EmptyState
        className="border-0"
        title="Keine Moderationseinträge"
        description="Gegen dieses Mitglied wurde noch keine Massnahme ergriffen."
      />
    );
  }
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Jail-Verlauf ({daten.jailsGesamt})</h3>
        {daten.jailHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch nie gejailt.</p>
        ) : (
          <ol className="divide-y divide-border">
            {daten.jailHistory.map((eintrag) => (
              <li key={eintrag.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/jail/${eintrag.id}`} className="font-medium hover:underline">
                    {formatDateTime(eintrag.startedAt)}
                  </Link>
                  {eintrag.releasedAt ? (
                    <Badge variant="secondary">Beendet</Badge>
                  ) : (
                    <Badge variant="warning">Aktiv</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {eintrag.reason} · Moderator: {eintrag.moderatorUsername}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {daten.moderationHistory.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Massnahmen</h3>
          <ol className="divide-y divide-border">
            {daten.moderationHistory.map((eintrag) => (
              <li key={eintrag.id} className="py-2 text-sm">
                <span className="font-medium">{eintrag.type}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatDateTime(eintrag.createdAt)} · {eintrag.actorUsername}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
