import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SetupStepView {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href: string;
  required: boolean;
}

/**
 * Fortschritt der Einrichtung.
 *
 * Zeigt den Fertigstellungsgrad und - wichtiger - was konkret noch fehlt.
 * Offene Punkte verlinken direkt auf die Stelle, an der sie sich beheben lassen.
 */
export function SetupProgress({
  completeness,
  steps,
}: {
  completeness: number;
  steps: SetupStepView[];
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Einrichtung abgeschlossen</span>
          <span className="text-2xl font-semibold tabular-nums">{completeness}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              completeness === 100 ? 'bg-success' : 'bg-primary',
            )}
            style={{ width: `${completeness}%` }}
          />
        </div>
      </div>

      <ul className="space-y-1.5">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              'flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm',
              step.done
                ? 'border-border bg-muted/20'
                : step.required
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'border-warning/40 bg-warning/5',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                step.done
                  ? 'border-success bg-success/20 text-success'
                  : 'border-border text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {step.done ? <Check className="size-3" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', step.done && 'text-muted-foreground')}>
                {step.label}
                {step.required && !step.done ? (
                  <span className="ml-2 text-xs font-normal text-destructive">erforderlich</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
            {step.done ? null : (
              <Link
                href={step.href}
                className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Erledigen
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
