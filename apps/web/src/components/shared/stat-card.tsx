import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  /** Färbt den Wert, z.B. grün für "Online". */
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}

const VALUE_TONE: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

/** Kennzahlkarte mit Icon-Chip im SwissHub-Design. */
export function StatCard({ label, value, hint, icon, tone = 'default' }: StatCardProps): React.JSX.Element {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className={cn('text-3xl font-semibold tabular-nums leading-none', VALUE_TONE[tone])}>{value}</p>
          {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        {icon ? <span className="icon-chip size-11 shrink-0 [&_svg]:size-5">{icon}</span> : null}
      </div>
    </div>
  );
}

/** Kleiner Delta-Hinweis, z.B. `+12% zum Vortag`. */
export function StatDelta({ value, suffix }: { value: number; suffix: string }): React.JSX.Element {
  const positive = value > 0;
  const neutral = value === 0;
  return (
    <span
      className={cn(
        'font-medium',
        neutral ? 'text-muted-foreground' : positive ? 'text-success' : 'text-destructive',
      )}
    >
      {neutral ? '±0' : `${positive ? '+' : ''}${value}`}
      {suffix}
    </span>
  );
}
