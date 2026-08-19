import Image from 'next/image';
import { memberAvatarUrl } from '@swisshub/discord/cdn';
import { cn } from '@/lib/utils';

interface DiscordAvatarProps {
  discordId: string;
  avatarHash?: string | null;
  name: string;
  size?: 24 | 32 | 40 | 64 | 96;
  className?: string;
}

/**
 * Discord-Avatar mit Fallback auf das Standardbild.
 * Es wird ausschliesslich die CDN-URL gerendert - niemals HTML aus Discord.
 */
export function DiscordAvatar({
  discordId,
  avatarHash,
  name,
  size = 40,
  className,
}: DiscordAvatarProps): React.JSX.Element {
  const source = memberAvatarUrl(discordId, avatarHash, size <= 32 ? 64 : 128);
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-border',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={source}
        alt={`Avatar von ${name}`}
        width={size}
        height={size}
        className="size-full object-cover"
        unoptimized
      />
    </span>
  );
}
