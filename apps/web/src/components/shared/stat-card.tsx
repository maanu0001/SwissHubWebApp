import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-primary bg-primary/15 ring-primary/30',
  success: 'text-success bg-success/15 ring-success/30',
  warning: 'text-warning bg-warning/15 ring-warning/30',
  destructive: 'text-destructive bg-destructive/15 ring-destructive/30',
};

export function StatCard({ label, value, hint, icon, tone = 'default' }: StatCardProps): React.JSX.Element {
  return (
    <Card className="group relative overflow-hidden transition-colors hover:border-primary/40">
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {icon ? (
          <span className={cn('rounded-lg p-2.5 ring-1 [&_svg]:size-5', TONE_CLASSES[tone])}>{icon}</span>
        ) : null}
      </CardContent>
    </Card>
  );
}
