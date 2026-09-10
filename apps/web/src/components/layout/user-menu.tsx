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
          {/*
            Der Ring gehoert an den Avatar, nicht um ihn herum.

            Hier stand ein `<span>` mit `rounded-full ring-2` um den Avatar.
            Ein `<span>` ist von sich aus inline: seine Hoehe kam nicht vom
            Kind, sondern aus der Zeilenhoehe, und seine Breite aus dem
            Inline-Fluss. Der Ring - in Tailwind ein Schlagschatten entlang
            des Randradius dieses Kastens - lag damit um einen anderen Kasten
            als das Bild: leicht verschoben, oben und unten anders als links
            und rechts, und bei `rounded-full` auf einem nicht quadratischen
            Kasten ein Oval statt eines Kreises. Dazu kam der eigene graue
            Ring des Avatars - die dunkle Linie zwischen Bild und Rand.

            Jetzt traegt derselbe Kasten Bild und Ring: `DiscordAvatar` setzt
            Breite, Hoehe, `rounded-full` und `overflow-hidden`, und der Ring
            ist eine Klasse an genau diesem Element. Ein Ring statt zweier,
            eine Geometrie statt zweier.
          */}
          <DiscordAvatar
            discordId={discordId}
            avatarHash={avatarHash}
            name={displayName}
            size={36}
            className="ring-2 ring-primary/60"
          />
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
