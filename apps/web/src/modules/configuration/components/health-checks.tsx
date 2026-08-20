import Link from 'next/link';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ModuleHealthCheck } from '@swisshub/modules';
import { cn } from '@/lib/utils';

const ICONS = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

const STYLES = {
  ok: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
} as const;

/**
 * Ergebnis der Modulprüfungen.
 *
 * Jede Meldung nennt das konkrete Problem und - wo möglich - den direkten Weg
 * zur Lösung ("Quick Fix"), statt nur "nicht konfiguriert" zu melden.
 */
export function HealthChecks({ checks }: { checks: ModuleHealthCheck[] }): React.JSX.Element {
  return (
    <ul className="space-y-2">
      {checks.map((check, index) => {
        const Icon = ICONS[check.status];
        return (
          <li
            key={`${check.label}-${index}`}
            className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', STYLES[check.status])}
          >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{check.label}</p>
              {check.detail ? <p className="text-xs opacity-90">{check.detail}</p> : null}
            </div>
            {check.fixHref && check.status !== 'ok' ? (
              <Link href={check.fixHref} className="shrink-0 text-xs font-medium underline">
                Beheben
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
