import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NavIcon } from '@/components/layout/nav-icon';

interface ModuleCardProps {
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  href?: string | null;
  badge?: string;
}

export function ModuleCard({
  name,
  description,
  icon,
  enabled,
  href,
  badge,
}: ModuleCardProps): React.JSX.Element {
  const content = (
    <Card className="h-full transition-colors hover:border-primary/40">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary/15 p-2 text-primary ring-1 ring-primary/30">
            <NavIcon name={icon} className="size-5" />
          </span>
          <div>
            <CardTitle>{name}</CardTitle>
            {badge ? <p className="mt-1 text-xs text-muted-foreground">{badge}</p> : null}
          </div>
        </div>
        <Badge variant={enabled ? 'success' : 'outline'}>{enabled ? 'Aktiv' : 'Inaktiv'}</Badge>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-3">
        <CardDescription>{description}</CardDescription>
        {href ? <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
