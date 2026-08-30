import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Gavel, Inbox, UserX } from 'lucide-react';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { appeals, isModuleEnabled } from '@swisshub/modules';
import type { AppealStatus } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Entbannungsanträge' };
export const dynamic = 'force-dynamic';

const P = appeals.APPEALS_PERMISSIONS;

/** Die Ansichten der Übersicht (§14). */
const ANSICHTEN = {
  offen: {
    label: 'Offen',
    status: [
      'SUBMITTED',
      'UNDER_REVIEW',
      'WAITING_FOR_STAFF',
      'ESCALATED',
      'DECISION_PENDING',
    ] as AppealStatus[],
  },
  meine: { label: 'Mir zugewiesen', status: [] as AppealStatus[] },
  unzugewiesen: { label: 'Unzugewiesen', status: [] as AppealStatus[] },
  wartet: { label: 'Wartet auf Antragsteller', status: ['WAITING_FOR_APPLICANT'] as AppealStatus[] },
  eskaliert: { label: 'Eskaliert', status: ['ESCALATED'] as AppealStatus[] },
  entschieden: { label: 'Entschieden', status: ['APPROVED', 'REJECTED'] as AppealStatus[] },
  abgeschlossen: {
    label: 'Abgeschlossen',
    status: ['CLOSED', 'WITHDRAWN', 'EXPIRED', 'RESOLVED_EXTERNALLY'] as AppealStatus[],
  },
} as const;

type AnsichtKey = keyof typeof ANSICHTEN;

const STATUS_FARBE: Record<string, string> = {
  SUBMITTED: 'text-primary',
  UNDER_REVIEW: 'text-primary',
  WAITING_FOR_APPLICANT: 'text-amber-500',
  WAITING_FOR_STAFF: 'text-amber-500',
  ESCALATED: 'text-destructive',
  DECISION_PENDING: 'text-amber-500',
  APPROVED: 'text-emerald-500',
  REJECTED: 'text-muted-foreground',
  WITHDRAWN: 'text-muted-foreground',
  EXPIRED: 'text-muted-foreground',
  RESOLVED_EXTERNALLY: 'text-muted-foreground',
  CLOSED: 'text-muted-foreground',
};

const PRIO_FARBE: Record<string, string> = {
  LOW: 'text-muted-foreground',
  NORMAL: 'text-muted-foreground',
  HIGH: 'text-amber-500',
  URGENT: 'text-destructive',
};

/** Die Übersicht für das Team. */
export default async function AppealsPage({
  searchParams,
}: {
  searchParams: Promise<{ ansicht?: string; q?: string; cursor?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.view, P.viewAll, P.review]);
  const { ansicht: ansichtRoh, q, cursor } = await searchParams;

  if (!(await isModuleEnabled(appeals.APPEALS_MODULE_ID))) {
    return (
      <ErrorState
        title="Modul deaktiviert"
        description="Die Entbannungsanträge sind ausgeschaltet. Es können keine Anträge gestellt werden."
      />
    );
  }

  const ansicht: AnsichtKey =
    ansichtRoh && ansichtRoh in ANSICHTEN ? (ansichtRoh as AnsichtKey) : 'offen';
  const guildId = await resolveGuildId();

  /**
   * Ohne `view.all` nur die eigenen und die unzugewiesenen.
   *
   * Die Einschränkung steht in der Abfrage, nicht in der Anzeige - sonst
   * stünde ein fremder Fall im ausgelieferten HTML, auch wenn er nicht
   * dargestellt wird.
   */
  const darfAlles = can(context, P.viewAll);
  const bearbeiterFilter =
    ansicht === 'meine'
      ? context.user.discordId
      : ansicht === 'unzugewiesen'
        ? null
        : darfAlles
          ? undefined
          : context.user.discordId;

  const [{ zeilen, naechsterCursor }, zahlen] = await Promise.all([
    appeals.listeAppeals({
      guildId,
      ...(ANSICHTEN[ansicht].status.length > 0 ? { status: [...ANSICHTEN[ansicht].status] } : {}),
      ...(bearbeiterFilter !== undefined ? { bearbeiter: bearbeiterFilter } : {}),
      ...(q ? { suche: q } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 25,
    }),
    appeals.kennzahlen(guildId),
  ]);

  const link = (key: AnsichtKey): string =>
    `/appeals?ansicht=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Offen"
          value={String(zahlen.offen)}
          hint={`${zahlen.ohneBearbeiter} ohne Bearbeiter`}
          icon={<Inbox aria-hidden="true" />}
        />
        <StatCard
          label="Neu diese Woche"
          value={String(zahlen.neuDieseWoche)}
          hint={`${zahlen.wartetAufAntragsteller} warten auf eine Antwort`}
          icon={<Gavel aria-hidden="true" />}
        />
        <StatCard
          label="Ø Bearbeitungszeit"
          value={zahlen.medianStunden === null ? '—' : `${zahlen.medianStunden} h`}
          hint="Median - ein einzelner Altfall verzerrt ihn nicht"
          icon={<Clock aria-hidden="true" />}
        />
        <StatCard
          label="Entschieden"
          value={`${zahlen.genehmigt} / ${zahlen.genehmigt + zahlen.abgelehnt}`}
          hint={
            zahlen.entbannungOffen > 0
              ? `${zahlen.entbannungOffen} Entbannungen ausstehend`
              : zahlen.genehmigungsQuote === null
                ? 'Noch nichts entschieden'
                : `${zahlen.genehmigungsQuote} % genehmigt`
          }
          icon={
            zahlen.entbannungOffen > 0 ? (
              <AlertTriangle aria-hidden="true" />
            ) : (
              <CheckCircle2 aria-hidden="true" />
            )
          }
        />
      </div>

      <Panel title="Anträge" description="Die neuesten zuerst, dringende oben.">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(Object.keys(ANSICHTEN) as AnsichtKey[]).map((key) => (
            <Button
              key={key}
              variant={key === ansicht ? 'default' : 'outline'}
              size="sm"
              asChild
            >
              <Link href={link(key)}>{ANSICHTEN[key].label}</Link>
            </Button>
          ))}
        </div>

        <form className="mb-4 flex flex-wrap gap-2" action="/appeals">
          <input type="hidden" name="ansicht" value={ansicht} />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Discord-ID, Benutzername oder Fallnummer …"
            className="min-w-0 flex-1 rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          <Button type="submit" variant="outline" size="sm">
            Suchen
          </Button>
        </form>

        {zeilen.length === 0 ? (
          <EmptyState title="Keine Anträge in dieser Ansicht" className="border-0" />
        ) : (
          <ul className="space-y-2">
            {zeilen.map((zeile) => (
              <li key={zeile.id}>
                <Link
                  href={`/appeals/${zeile.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <span className="font-mono text-xs text-muted-foreground">{zeile.fallnummer}</span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{zeile.applicantUsername}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {zeile.bearbeiterUsername
                        ? `Bearbeitet von ${zeile.bearbeiterUsername}`
                        : 'Nicht zugewiesen'}
                    </p>
                  </div>

                  {zeile.prioritaet !== 'NORMAL' ? (
                    <span className={`text-xs font-medium ${PRIO_FARBE[zeile.prioritaet]}`}>
                      {zeile.prioritaet}
                    </span>
                  ) : null}

                  {zeile.unbanStatus === 'PARTIAL' || zeile.unbanStatus === 'FAILED' ? (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <UserX className="size-3.5" aria-hidden="true" />
                      Entbannung offen
                    </span>
                  ) : null}

                  <span className={`text-xs ${STATUS_FARBE[zeile.status] ?? ''}`}>
                    {appeals.STATUS_LABEL[zeile.status]}
                  </span>

                  <span
                    className={`text-xs tabular-nums ${
                      zeile.alterStunden > 168
                        ? 'text-destructive'
                        : zeile.alterStunden > 48
                          ? 'text-amber-500'
                          : 'text-muted-foreground'
                    }`}
                    title="Alter des Antrags"
                  >
                    {zeile.alterStunden < 24
                      ? `${zeile.alterStunden} h`
                      : `${Math.floor(zeile.alterStunden / 24)} T`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {naechsterCursor ? (
          <div className="mt-4">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${link(ansicht)}&cursor=${naechsterCursor}`}>Ältere anzeigen</Link>
            </Button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
