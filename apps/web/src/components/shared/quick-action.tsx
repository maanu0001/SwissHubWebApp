import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickActionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  href?: string;
  className?: string;
  /** Alternative zu `href`: eigenes interaktives Element (z.B. Dialog-Trigger). */
  children?: React.ReactNode;
}

const CONTENT_CLASSES =
  'flex w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Body({
  title,
  description,
  icon,
}: Pick<QuickActionProps, 'title' | 'description' | 'icon'>): React.JSX.Element {
  return (
    <>
      <span className="icon-chip size-9 shrink-0 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>
  );
}

/** Eintrag der Schnellaktionen. Entweder Link oder eigener Trigger. */
export function QuickAction({
  title,
  description,
  icon,
  href,
  className,
  children,
}: QuickActionProps): React.JSX.Element {
  if (children) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link href={href ?? '#'} className={cn(CONTENT_CLASSES, className)}>
      <Body title={title} description={description} icon={icon} />
    </Link>
  );
}

/** Gleiche Optik für Aktionen, die einen Dialog öffnen statt zu navigieren. */
export function QuickActionButton({
  title,
  description,
  icon,
  onClick,
  className,
}: Omit<QuickActionProps, 'href' | 'children'> & { onClick?: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn(CONTENT_CLASSES, className)}>
      <Body title={title} description={description} icon={icon} />
    </button>
  );
}
