import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Bot, Lock, ShieldAlert } from 'lucide-react';
import { can } from '@swisshub/auth';
import { getModuleSettings, getMemberProfile, isModuleEnabled, jail } from '@swisshub/modules';
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
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mitglied' };
export const dynamic = 'force-dynamic';

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ discordId: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission('members.view');
  const raw = await params;
  const parsed = snowflakeSchema.safeParse(raw.discordId);
  if (!parsed.success) {
    notFound();
  }

  const profile = await getMemberProfile(parsed.data);
  if (!profile) {
    notFound();
  }

  const [jailSettings, jailEnabled] = await Promise.all([
    getModuleSettings<jail.JailSettings>(jail.JAIL_MODULE_ID),
    isModuleEnabled(jail.JAIL_MODULE_ID),
  ]);

  const csrfToken = csrfTokenFor(context);
  const canJail = can(context, jail.JAIL_PERMISSIONS.create) && jailEnabled && !profile.isBot;
  const canRelease = can(context, jail.JAIL_PERMISSIONS.release);

  return (
    <>
      <PageHeader
        title={profile.displayName}
        description={`@${profile.username} · ${profile.discordId}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/members" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              <ArrowLeft aria-hidden="true" />
              Zurück
            </Link>
            {profile.activeJail && canRelease ? (
              <ReleaseJailButton
                csrfToken={csrfToken}
                jailId={profile.activeJail.id}
                memberLabel={profile.displayName}
              />
            ) : null}
            {!profile.activeJail && canJail ? (
              <CreateJailDialog
                csrfToken={csrfToken}
                durationPresets={jail.JAIL_DURATION_PRESETS}
                maxDurationSeconds={jailSettings.maxDurationSeconds}
                announceByDefault={!jailSettings.silentByDefault}
                presetMember={{
                  discordId: profile.discordId,
                  username: profile.username,
                  displayName: profile.displayName,
                  avatarHash: profile.avatarHash,
                  jailed: false,
                }}
                triggerLabel="Mitglied jailen"
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
            <CardDescription>Live von Discord geladen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <DiscordAvatar
                discordId={profile.discordId}
                avatarHash={profile.avatarHash}
                name={profile.displayName}
                size={64}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{profile.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">@{profile.username}</p>
                <p className="truncate font-mono text-xs text-muted-foreground/80">{profile.discordId}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {profile.isBot ? (
                <Badge variant="secondary">
                  <Bot className="size-3" aria-hidden="true" />
                  Bot
                </Badge>
              ) : null}
              {profile.activeJail ? (
                <Badge variant="warning">
                  <Lock className="size-3" aria-hidden="true" />
                  {profile.activeJail.endsAt
                    ? `Gejailt bis ${formatDateTime(profile.activeJail.endsAt)}`
                    : 'Permanent gejailt'}
                </Badge>
              ) : (
                <Badge variant="success">Nicht gejailt</Badge>
              )}
              {profile.timedOut ? (
                <Badge variant="destructive">
                  <ShieldAlert className="size-3" aria-hidden="true" />
                  Discord Timeout
                </Badge>
              ) : null}
              {profile.boosting ? <Badge variant="default">Server Booster</Badge> : null}
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Server-Beitritt</dt>
                <dd>{profile.joinedAt ? formatDate(profile.joinedAt) : 'unbekannt'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Account erstellt</dt>
                <dd>{profile.accountCreatedAt ? formatDate(profile.accountCreatedAt) : 'unbekannt'}</dd>
              </div>
            </dl>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Rollen ({profile.roles.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {profile.roles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Rollen.</p>
                ) : (
                  profile.roles.map((role) => <RoleBadge key={role.id} name={role.name} color={role.color} />)
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Jail-Historie</CardTitle>
            <CardDescription>Alle Jail-Vorgänge dieses Mitglieds.</CardDescription>
          </CardHeader>
          <CardContent>
            {profile.jailHistory.length === 0 ? (
              <EmptyState title="Keine Jail-Historie" description="Dieses Mitglied wurde noch nie gejailt." />
            ) : (
              <ol className="divide-y divide-border/60">
                {profile.jailHistory.map((entry) => (
                  <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/jail/${entry.id}`} className="inline-flex min-h-6 items-center font-medium hover:underline">
                        {formatDateTime(entry.startedAt)}
                      </Link>
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{jail.jailDurationLabel(entry)}</Badge>
                        {entry.releasedAt ? (
                          <Badge variant="secondary">
                            {entry.releaseType === 'MANUAL' ? 'Manuell beendet' : 'Automatisch beendet'}
                          </Badge>
                        ) : (
                          <Badge variant="warning">Aktiv</Badge>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {entry.reason} &middot; Moderator: {entry.moderatorUsername}
                      {entry.releasedAt ? ` · Freigelassen: ${formatDateTime(entry.releasedAt)}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
