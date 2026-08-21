import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import type { ModuleHealthCheck } from '@swisshub/modules';

/**
 * Zustand des Kommunikationsmoduls.
 *
 * Wichtig: Eine Warnung blockiert die Seite nicht. Fehlt etwa der
 * Ticket-Channel, lässt sich alles andere weiterhin senden - nur diese eine
 * Möglichkeit steht dann nicht zur Verfügung. Ein Modul, das sich wegen einer
 * fehlenden Einstellung gar nicht öffnen lässt, ist genau das Gegenteil von
 * hilfreich.
 */
const ICON = {
  ok: <CheckCircle2 className="size-4 text-success" aria-hidden="true" />,
  warning: <AlertTriangle className="size-4 text-warning" aria-hidden="true" />,
  error: <XCircle className="size-4 text-destructive" aria-hidden="true" />,
} as const;

export function CommunicationHealth({
  checks,
  discordReachable,
}: {
  checks: ModuleHealthCheck[];
  discordReachable: boolean;
}): React.JSX.Element | null {
  if (discordReachable && checks.every((check) => check.status === 'ok')) {
    return null;
  }

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">Systemstatus</h3>

      {!discordReachable ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Discord ist aktuell nicht erreichbar. Senden ist vorübergehend nicht möglich; der Verlauf und alle
            gespeicherten Daten stehen weiterhin zur Verfügung.
          </span>
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0">{ICON[check.status]}</span>
            <span className="min-w-0">
              <span className="font-medium">{check.label}</span>
              {check.detail ? <span className="text-muted-foreground"> – {check.detail}</span> : null}
              {check.fixHref ? (
                <>
                  {' '}
                  <Link href={check.fixHref} className="text-primary underline">
                    Jetzt beheben
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
