import Link from 'next/link';
import { Bot, Lock, ShieldAlert } from 'lucide-react';
import { formatDate } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DiscordAvatar } from './discord-avatar';
import { RoleBadge } from './role-badge';

export interface MemberCardData {
  discordId: string;
  username: string;
  displayName: string;
  avatarHash: string | null;
  isBot: boolean;
  roles: Array<{ id: string; name: string; color: number }>;
  joinedAt: Date | null;
  accountCreatedAt: Date | null;
  jailed: boolean;
  timedOut: boolean;
  showDiscordId?: boolean;
}

/** Kompakte Mitgliederkarte fuer Such- und Listenansichten. */
export function MemberCard({ member }: { member: MemberCardData }): React.JSX.Element {
  return (
    <Link
      href={`/members/${member.discordId}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <DiscordAvatar
              discordId={member.discordId}
              avatarHash={member.avatarHash}
              name={member.displayName}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{member.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
              {member.showDiscordId !== false ? (
                <p className="truncate font-mono text-[0.7rem] text-muted-foreground/80">
                  {member.discordId}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {member.isBot ? (
                <Badge variant="secondary">
                  <Bot className="size-3" aria-hidden="true" />
                  Bot
                </Badge>
              ) : null}
              {member.jailed ? (
                <Badge variant="warning">
                  <Lock className="size-3" aria-hidden="true" />
                  Gejailt
                </Badge>
              ) : null}
              {member.timedOut ? (
                <Badge variant="destructive">
                  <ShieldAlert className="size-3" aria-hidden="true" />
                  Timeout
                </Badge>
              ) : null}
            </div>
          </div>

          {member.roles.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {member.roles.slice(0, 4).map((role) => (
                <RoleBadge key={role.id} name={role.name} color={role.color} />
              ))}
              {member.roles.length > 4 ? (
                <span className="text-xs text-muted-foreground">+{member.roles.length - 4}</span>
              ) : null}
            </div>
          ) : null}

          <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              <dt className="font-medium text-foreground/70">Beigetreten</dt>
              <dd>{member.joinedAt ? formatDate(member.joinedAt) : 'unbekannt'}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground/70">Account erstellt</dt>
              <dd>{member.accountCreatedAt ? formatDate(member.accountCreatedAt) : 'unbekannt'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
