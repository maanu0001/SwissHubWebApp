import Image from 'next/image';
import { branding } from '@swisshub/config/client';
import { cn } from '@/lib/utils';

export interface ServerCardData {
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
  botOnline: boolean;
}

/**
 * Serverkarte am Kopf der Seitenleiste.
 *
 * Zeigt den konfigurierten Discord-Server mit echter Mitgliederzahl. Die
 * Anwendung ist bewusst auf genau eine Guild ausgelegt - deshalb ist dies eine
 * Anzeige und kein Auswahlmenü.
 */
export function ServerCard({
  data,
  collapsed = false,
}: {
  data: ServerCardData;
  collapsed?: boolean;
}): React.JSX.Element {
  const formattedCount =
    data.memberCount !== null ? new Intl.NumberFormat(branding.locale).format(data.memberCount) : null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card/70 px-3 py-2.5',
        collapsed && 'justify-center px-2',
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-gradient ring-1 ring-primary/30">
        {data.iconUrl ? (
          <Image
            src={data.iconUrl}
            alt=""
            width={32}
            height={32}
            className="size-full object-cover"
            unoptimized
          />
        ) : (
          <span className="text-xs font-bold text-primary-foreground">{branding.logo.monogram}</span>
        )}
      </span>

      {collapsed ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold">{data.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className={cn(
                'size-1.5 rounded-full',
                data.botOnline ? 'bg-success' : 'bg-muted-foreground/50',
              )}
              aria-hidden="true"
            />
            {formattedCount ? `${formattedCount} Mitglieder` : 'Mitgliederzahl unbekannt'}
          </span>
        </span>
      )}
    </div>
  );
}
