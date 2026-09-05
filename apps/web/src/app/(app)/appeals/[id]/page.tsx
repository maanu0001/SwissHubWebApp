import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, Lock, ShieldAlert } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { appeals, isModuleEnabled, moderation } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { FallAktionen } from '@/modules/appeals/components/fall-aktionen';
import { InterneNotizen } from '@/modules/appeals/components/interne-notizen';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Entbannungsantrag' };
export const dynamic = 'force-dynamic';

const P = appeals.APPEALS_PERMISSIONS;

interface BanSnapshotAnsicht {
  quelle?: string;
  discordGrund?: string | null;
  verhaengtAm?: string | null;
  internerGrund?: string | null;
  moderatorUsername?: string | null;
}

/**
 * Der Fall in voller Tiefe - für das Team (§15).
 *
 * Hier steht alles: der Antrag, der Ban-Kontext samt interner Notiz, das
 * Gespräch, die internen Kommentare, die vollständige Zeitleiste und die
 * früheren Anträge. Wer diese Seite öffnet, hat die Berechtigung dafür
 * nachgewiesen - und ohne `view.all` sieht er nur Fälle, die ihm zugewiesen
 * oder unzugewiesen sind.
 */
export default async function AppealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.viewAll, P.review]);
  const { id } = await params;

  if (!(await isModuleEnabled(appeals.APPEALS_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Entbannungsanträge sind ausgeschaltet." />;
  }

  const guildId = await resolveGuildId();
  const appeal = await appeals.holeStaffSicht(guildId, id);
  if (!appeal) {
    notFound();
  }

  // Ohne `view.all` nur die eigenen und die unzugewiesenen. `notFound()` statt
  // 403: ein anderer Ausgang verriete, dass es diesen Fall gibt.
  if (
    !can(context, P.viewAll) &&
    appeal.assignedToDiscordId !== null &&
    appeal.assignedToDiscordId !== context.user.discordId
  ) {
    notFound();
  }

  const [fruehere, moderationsAkte] = await Promise.all([
    appeals.frühereAppeals(guildId, appeal.applicantDiscordId, appeal.id),
    // Die Moderationsakte wird verwiesen, nicht kopiert (§50) - und nur, wenn
    // der Betrachter sie ohnehin sehen dürfte.
    can(context, 'moderation.history.view')
      ? moderation.memberHistory(appeal.applicantDiscordId, 5).catch(() => [])
      : Promise.resolve([]),
  ]);

  const snapshot = (appeal.banSnapshot ?? {}) as BanSnapshotAnsicht;
  const antworten = { ...(appeal.answers as Record<string, string>) };
  delete antworten.__idempotencyKey;

  const fallnummer = appeals.formatFallnummer(appeal.caseYear, appeal.caseNumber);
  const csrfToken = csrfTokenFor(context);
  const datum = (wert: Date | string | null | undefined): string =>
    wert ? new Date(wert).toLocaleString('de-CH') : '—';

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="font-mono text-sm text-muted-foreground">{fallnummer}</span>
            {appeal.applicantUsername}
            {appeal.priority !== 'NORMAL' ? (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
                {appeal.priority}
              </span>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            {appeals.STATUS_LABEL[appeal.status]}
            {appeal.assignedToUsername ? ` · ${appeal.assignedToUsername}` : ' · nicht zugewiesen'}
            {appeal.submittedAt ? ` · eingereicht ${datum(appeal.submittedAt)}` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/appeals">Zurück</Link>
        </Button>
      </div>

      {appeal.unbanStatus === 'PARTIAL' || appeal.unbanStatus === 'FAILED' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Entscheidung genehmigt, Entbannung ausstehend</p>
            <p className="text-muted-foreground">
              {appeal.unbanError ?? 'Die Entbannung auf Discord ist nicht durchgelaufen.'}
            </p>
          </div>
        </div>
      ) : null}

      {appeal.status === 'RESOLVED_EXTERNALLY' ? (
        <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm">
          <ShieldAlert className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          Der zugrundeliegende Bann besteht nicht mehr. Der Antrag wurde deshalb geschlossen.
        </div>
      ) : null}

      <FallAktionen
        csrfToken={csrfToken}
        appealId={appeal.id}
        status={appeal.status}
        istZugewiesenAnMich={appeal.assignedToDiscordId === context.user.discordId}
        istZugewiesen={appeal.assignedToDiscordId !== null}
        prioritaet={appeal.priority}
        unbanStatus={appeal.unbanStatus}
        vorschlagVon={appeal.proposedByUsername}
        vorschlagVonMir={appeal.proposedByDiscordId === context.user.discordId}
        rechte={{
          review: can(context, P.review),
          assign: can(context, P.assign),
          message: can(context, P.message),
          priority: can(context, P.priority),
          approve: can(context, P.approve),
          reject: can(context, P.reject),
          unban: can(context, P.unban),
        }}
        nachrichten={appeal.messages.map((nachricht) => ({
          id: nachricht.id,
          vonTeam: nachricht.author !== 'APPLICANT',
          autor: nachricht.authorUsername ?? 'Unbekannt',
          inhalt: nachricht.content,
          am: nachricht.createdAt.toISOString(),
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Antrag" description="Unverändert seit der Einreichung.">
          <div className="space-y-4">
            {/*
              Ältere Anträge tragen die Schlüssel der damaligen fünf Fragen.
              `appealAntwortFelder` liest beide Fassungen - sonst stünde die
              Akte eines alten Falls leer da.
            */}
            {appeals.appealAntwortFelder(antworten).map((feld) => (
              <div key={feld.key} className="space-y-1">
                <p className="text-sm font-medium">{feld.label}</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{feld.wert}</p>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Ban-Kontext"
            description="Momentaufnahme vom Zeitpunkt der Einreichung - sie ändert sich nicht mehr."
          >
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Quelle</dt>
                <dd>{snapshot.quelle === 'swisshub' ? 'Von SwissHub gesetzt' : 'Direkt auf Discord'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Verhängt am</dt>
                <dd>{datum(snapshot.verhaengtAm)}</dd>
              </div>
              <div>
                <dt className="mb-1 text-muted-foreground">Grund bei Discord</dt>
                <dd className="whitespace-pre-wrap">{snapshot.discordGrund ?? '—'}</dd>
              </div>
              {snapshot.internerGrund ? (
                <div>
                  <dt className="mb-1 flex items-center gap-1.5 text-muted-foreground">
                    <Lock className="size-3.5" aria-hidden="true" />
                    Interner Grund
                  </dt>
                  <dd className="whitespace-pre-wrap">{snapshot.internerGrund}</dd>
                </div>
              ) : null}
              {snapshot.moderatorUsername ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Moderator</dt>
                  <dd>{snapshot.moderatorUsername}</dd>
                </div>
              ) : null}
            </dl>
          </Panel>

          <Panel
            title="Moderationskontext"
            description="Verwiesen, nicht kopiert - die Akte bleibt an ihrem Ort."
            action={{ label: 'Member Center', href: `/members/${appeal.applicantDiscordId}` }}
          >
            {moderationsAkte.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {can(context, 'moderation.history.view')
                  ? 'Keine früheren Moderationsaktionen.'
                  : 'Für die Moderationsakte fehlt dir die Berechtigung.'}
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {moderationsAkte.map((eintrag) => (
                  <li key={eintrag.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{eintrag.type}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {eintrag.reason ?? '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {eintrag.createdAt.toLocaleDateString('de-CH')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {fruehere.length > 0 ? (
            <Panel title="Frühere Anträge" description="Derselbe Mensch, andere Anträge.">
              <ul className="space-y-1.5 text-sm">
                {fruehere.map((eintrag) => (
                  <li key={eintrag.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/appeals/${eintrag.id}`}
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {eintrag.fallnummer}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {appeals.STATUS_LABEL[eintrag.status]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {eintrag.entschiedenAm?.toLocaleDateString('de-CH') ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <InterneNotizen
          csrfToken={csrfToken}
          appealId={appeal.id}
          darfSchreiben={can(context, P.commentInternal)}
          notizen={appeal.comments.map((kommentar) => ({
            id: kommentar.id,
            autor: kommentar.authorUsername,
            inhalt: kommentar.content,
            am: kommentar.createdAt.toISOString(),
          }))}
        />

        <Panel title="Zeitleiste" description="Alles - auch das, was der Antragsteller nicht sieht.">
          {appeal.events.length === 0 ? (
            <EmptyState title="Noch nichts geschehen" className="border-0" />
          ) : (
            <ol className="space-y-2">
              {appeal.events.map((ereignis) => (
                <li key={ereignis.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  {ereignis.visibility === 'INTERNAL' ? (
                    <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="intern" />
                  ) : (
                    <ExternalLink
                      className="size-3 shrink-0 text-emerald-500"
                      aria-label="sieht der Antragsteller"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    {ereignis.publicLabel ?? ereignis.kind}
                    {ereignis.actorUsername ? (
                      <span className="text-muted-foreground"> · {ereignis.actorUsername}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ereignis.createdAt.toLocaleString('de-CH')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      {appeal.publicDecision ? (
        <Panel title="Entscheidung">
          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 font-medium">
                {appeal.decisionKind === 'APPROVE' ? 'Genehmigt' : 'Abgelehnt'}
                {appeal.decidedByUsername ? ` · ${appeal.decidedByUsername}` : ''}
                {appeal.decidedAt ? ` · ${datum(appeal.decidedAt)}` : ''}
              </p>
              <p className="mb-1 text-xs text-muted-foreground">Öffentliche Begründung</p>
              <p className="whitespace-pre-wrap">{appeal.publicDecision}</p>
            </div>
            {appeal.internalDecision ? (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden="true" />
                  Interne Begründung
                </p>
                <p className="whitespace-pre-wrap">{appeal.internalDecision}</p>
              </div>
            ) : null}
            {appeal.nextEligibleAt ? (
              <p className="text-muted-foreground">Erneuter Antrag ab {datum(appeal.nextEligibleAt)}</p>
            ) : null}
            {appeal.finalRejection ? (
              <p className="text-destructive">Endgültig abgelehnt - kein weiterer Antrag möglich.</p>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
