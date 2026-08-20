'use client';

import { useEffect, useRef, useState } from 'react';
import { avatarSizeFor, defaultAvatarUrl, getDiscordAvatarUrl } from '@swisshub/discord/cdn';
import { cn } from '@/lib/utils';

/**
 * Discord-Avatar.
 *
 * Einzige Avatar-Darstellung der Anwendung. Sie liefert immer ein Bild:
 * fehlt der Hash, kommt Discords Standardbild; scheitert auch das Laden,
 * übernimmt ein Monogramm. Ein Broken-Image-Icon kann dadurch nicht auftreten.
 *
 * Die URL entsteht über `getDiscordAvatarUrl` - es gibt keine zweite Stelle,
 * die Avatar-URLs zusammensetzt.
 */
export type AvatarStatus = 'online' | 'offline' | 'jailed';

interface DiscordAvatarProps {
  discordId: string;
  avatarHash?: string | null;
  name: string;
  size?: 20 | 24 | 28 | 32 | 36 | 40 | 48 | 64 | 96;
  /** Kleiner Punkt unten rechts. */
  status?: AvatarStatus | null;
  className?: string;
}

const STATUS_CLASS: Record<AvatarStatus, string> = {
  online: 'bg-success',
  offline: 'bg-muted-foreground',
  jailed: 'bg-destructive',
};

const STATUS_LABEL: Record<AvatarStatus, string> = {
  online: 'online',
  offline: 'offline',
  jailed: 'gejailt',
};

export function DiscordAvatar({
  discordId,
  avatarHash,
  name,
  size = 40,
  status = null,
  className,
}: DiscordAvatarProps): React.JSX.Element {
  // 0 = eigenes Bild, 1 = Discord-Standardbild, 2 = Monogramm.
  const [fallbackLevel, setFallbackLevel] = useState(0);
  const hasCustomAvatar = Boolean(avatarHash);
  const imageRef = useRef<HTMLImageElement>(null);

  const nextLevel = (): void => setFallbackLevel(hasCustomAvatar ? 1 : 2);

  const source =
    fallbackLevel === 0
      ? getDiscordAvatarUrl(discordId, avatarHash, avatarSizeFor(size))
      : defaultAvatarUrl(discordId);

  /**
   * Bilder werden bereits während des Ladens der Seite abgerufen - also bevor
   * React die Ereignisse übernimmt. Scheitert der Abruf in diesem Fenster,
   * ginge `onError` verloren und es bliebe ein kaputtes Bild stehen. Nach dem
   * Einhängen wird deshalb einmal nachgesehen, ob das Bild wirklich geladen
   * ist (`complete`, aber keine Bildbreite = fehlgeschlagen).
   */
  useEffect(() => {
    const image = imageRef.current;
    if (image && image.complete && image.naturalWidth === 0) {
      nextLevel();
    }
    // Bewusst nur beim Wechsel der Quelle prüfen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const initials = name.trim().slice(0, 2).toUpperCase() || '?';

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary ring-1 ring-border',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {fallbackLevel < 2 ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={source}
          alt={`Avatar von ${name}`}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          // Ohne eigenen Avatar ist Stufe 0 bereits das Standardbild - dann
          // direkt auf das Monogramm wechseln, statt dieselbe URL erneut zu
          // laden (das würde nur eine zweite fehlschlagende Anfrage erzeugen).
          onError={nextLevel}
        />
      ) : (
        <span
          aria-label={`Avatar von ${name}`}
          role="img"
          className="select-none font-semibold text-muted-foreground"
          style={{ fontSize: Math.max(9, Math.round(size * 0.36)) }}
        >
          {initials}
        </span>
      )}

      {status ? (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-2 ring-background',
            STATUS_CLASS[status],
          )}
          style={{
            width: Math.max(6, Math.round(size * 0.28)),
            height: Math.max(6, Math.round(size * 0.28)),
          }}
          title={STATUS_LABEL[status]}
        >
          <span className="sr-only">{STATUS_LABEL[status]}</span>
        </span>
      ) : null}
    </span>
  );
}
