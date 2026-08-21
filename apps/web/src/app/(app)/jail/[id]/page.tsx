import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can } from '@swisshub/auth';
import { discord } from '@swisshub/discord';
import { jail } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { RoleBadge } from '@/components/shared/role-badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { ReleaseJailButton } from '@/modules/jail/components/release-jail-button';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Jail Details' };
export const dynamic = 'force-dynamic';

function DetailRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid gap-1 border-b border-border/50 py-3 last:border-0 sm:grid-cols-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm sm:col-span-2">{children}</dd>
    </div>
  );
}

export default async function JailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(jail.JAIL_PERMISSIONS.view);
  const { id } = await params;
  const entry = await jail.getJailDetail(id);

  if (!entry) {
    notFound();
  }

  // Rollennamen kommen zuerst aus dem Snapshot: dort steht der Name, den die
  // Rolle zum Zeitpunkt des Jails hatte. Nur wenn dort nichts steht (z.B. bei
  // übernommenen Altdaten), wird der aktuelle Discord-Name verwendet - und
  // sonst die reine ID.
  const roles = await discord.roles.list().catch(() => []);
  const snapshotByRoleId = new Map(entry.roleSnapshotEntries.map((row) => [row.roleId, row]));
  const roleName = (roleId: string): { name: string; color: number } => {
    const live = roles.find((entry_) => entry_.id === roleId);
    const snapshot = snapshotByRoleId.get(roleId);
    return { name: live?.name ?? snapshot?.roleNameAtTime ?? roleId, color: live?.color ?? 0 };
  };

  const active = entry.releasedAt === null && entry.status !== 'FAILED';
  const lifecycle = jail.jailLifecycleLabel(entry.lifecycle);

  return (
    <>
      <PageHeader
        title={`${entry.targetDisplayName ?? entry.targetUsername}`}
        description={`Erstellt am ${formatDateTime(entry.startedAt)} durch ${entry.moderatorUsername}.`}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/jail" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              <ArrowLeft aria-hidden="true" />
              Zurück
            </Link>
            {active && can(context, jail.JAIL_PERMISSIONS.release) ? (
              <ReleaseJailButton
                csrfToken={csrfTokenFor(context)}
                jailId={entry.id}
                memberLabel={entry.targetDisplayName ?? entry.targetUsername}
                variant="default"
                size="default"
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Alle Angaben zu diesem Jail-Vorgang.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow label="Benutzer">
                <Link href={`/members/${entry.targetDiscordId}`} className="inline-flex min-h-6 items-center font-medium hover:underline">
                  {entry.targetDisplayName ?? entry.targetUsername}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{entry.targetDiscordId}</span>
              </DetailRow>
              <DetailRow label="Moderator">{entry.moderatorUsername}</DetailRow>
              <DetailRow label="Grund">
                <span className="whitespace-pre-wrap break-words">{entry.reason}</span>
              </DetailRow>
              <DetailRow label="Dauer">
                {jail.isPermanentJail(entry) ? (
                  <Badge variant="warning">{jail.PERMANENT_LABEL}</Badge>
                ) : (
                  jail.jailDurationLabel(entry)
                )}
              </DetailRow>
              <DetailRow label="Start">{formatDateTime(entry.startedAt)}</DetailRow>
              <DetailRow label="Geplantes Ende">
                {entry.endsAt
                  ? formatDateTime(entry.endsAt)
                  : 'Kein automatisches Ende - nur manuelle Freilassung.'}
              </DetailRow>
              <DetailRow label="Status">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={entry.status} />
                  <Badge
                    variant={
                      lifecycle.tone === 'problem'
                        ? 'destructive'
                        : lifecycle.tone === 'active'
                          ? 'warning'
                          : 'outline'
                    }
                  >
                    {lifecycle.label}
                  </Badge>
                </span>
              </DetailRow>
              <DetailRow label="Herkunft">
                <span className="flex flex-wrap items-center gap-2">
                  {jail.jailSourceLabel(entry.source)}
                  {entry.silent ? <Badge variant="outline">Still</Badge> : null}
                </span>
              </DetailRow>
              {entry.voiceDisconnected ? (
                <DetailRow label="Sprachkanal">Mitglied wurde beim Jail getrennt.</DetailRow>
              ) : null}
              {entry.reappliedCount > 0 ? (
                <DetailRow label="Wiedereintritte">
                  {entry.reappliedCount}× nach erneutem Beitritt wieder angewendet
                  {entry.leftGuildAt ? ` · zuletzt verlassen am ${formatDateTime(entry.leftGuildAt)}` : ''}
                </DetailRow>
              ) : null}
              {entry.releasedAt ? (
                <>
                  <DetailRow label="Freigelassen am">{formatDateTime(entry.releasedAt)}</DetailRow>
                  <DetailRow label="Freilassung">
                    {entry.releaseType === 'MANUAL'
                      ? `Manuell durch ${entry.releasedByUsername ?? 'Unbekannt'}`
                      : entry.releaseType === 'AUTOMATIC'
                        ? 'Automatisch nach Ablauf'
                        : 'Automatischer Abgleich (Reconciliation)'}
                  </DetailRow>
                </>
              ) : null}
              {entry.errorMessage ? (
                <DetailRow label="Fehler">
                  <span className="text-destructive">{entry.errorCode}</span>
                </DetailRow>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rollen</CardTitle>
            <CardDescription>Snapshot vor dem Jail und Wiederherstellung.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Vor dem Jail ({entry.roleSnapshot.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {entry.roleSnapshot.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Rollen gespeichert.</p>
                ) : (
                  entry.roleSnapshot.map((roleId) => {
                    const role = roleName(roleId);
                    return <RoleBadge key={roleId} name={role.name} color={role.color} />;
                  })
                )}
              </div>
              {entry.roleSnapshotEntries.some((row) => row.roleNameAtTime === null) ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Für einzelne Rollen ist kein Name aus der Zeit des Jails bekannt - sie stammen aus der
                  Übernahme der alten Datenbank und werden als ID angezeigt, falls es sie heute nicht mehr
                  gibt.
                </p>
              ) : null}
            </section>

            {entry.keptRoleIds.length > 0 ? (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Während des Jails behalten ({entry.keptRoleIds.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {entry.keptRoleIds.map((roleId) => {
                    const role = roleName(roleId);
                    return <RoleBadge key={roleId} name={role.name} color={role.color} />;
                  })}
                </div>
              </section>
            ) : null}

            {entry.releasedAt ? (
              <>
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Wiederhergestellt ({entry.restoredRoleIds.length})
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.restoredRoleIds.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Keine Rollen wiederhergestellt.</p>
                    ) : (
                      entry.restoredRoleIds.map((roleId) => {
                        const role = roleName(roleId);
                        return <RoleBadge key={roleId} name={role.name} color={role.color} />;
                      })
                    )}
                  </div>
                </section>

                {entry.failedRoleIds.length > 0 ? (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">
                      Nicht wiederherstellbar ({entry.failedRoleIds.length})
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {entry.failedRoleIds.map((roleId) => {
                        const role = roleName(roleId);
                        return <RoleBadge key={roleId} name={role.name} color={role.color} />;
                      })}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Rollen können gelöscht worden sein oder liegen über der Rolle des Bots.
                    </p>
                  </section>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
