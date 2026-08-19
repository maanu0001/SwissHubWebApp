'use client';

import Link from 'next/link';
import { ChevronDown, ExternalLink, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { LogoutButton } from './logout-button';

export interface UserMenuProps {
  discordId: string;
  displayName: string;
  username: string;
  avatarHash: string | null;
  primaryRole: string;
  csrfToken: string;
  guildId: string;
}

/** Benutzerprofil oben rechts inklusive Abmeldung. */
export function UserMenu({
  discordId,
  displayName,
  username,
  avatarHash,
  primaryRole,
  csrfToken,
  guildId,
}: UserMenuProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Benutzermenü öffnen"
        >
          <span className="rounded-full ring-2 ring-primary/40">
            <DiscordAvatar discordId={discordId} avatarHash={avatarHash} name={displayName} size={36} />
          </span>
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-sm font-semibold">{displayName}</span>
            <span className="text-xs font-medium text-primary-bright">{primaryRole}</span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Angemeldet als</DropdownMenuLabel>
        <div className="px-2 pb-2">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">@{username}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/members/${discordId}`}>
            <UserRound aria-hidden="true" />
            Profil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={`https://discord.com/channels/${guildId}`} target="_blank" rel="noreferrer noopener">
            <ExternalLink aria-hidden="true" />
            Discord öffnen
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="p-1">
          <LogoutButton csrfToken={csrfToken} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
