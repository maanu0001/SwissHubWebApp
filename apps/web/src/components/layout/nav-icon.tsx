import {
  Blocks,
  LayoutDashboard,
  Lock,
  ScrollText,
  Settings,
  ShieldAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * Erlaubte Navigationssymbole.
 *
 * Bewusst als feste Zuordnung statt dynamischem Import: dadurch landet nur ein
 * kleiner Teil der Icon-Bibliothek im Bundle und Module koennen keine
 * beliebigen Komponenten einschleusen.
 */
const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Lock,
  ShieldAlert,
  ScrollText,
  Blocks,
  Settings,
};

export function NavIcon({ name, className }: { name: string; className?: string }): React.JSX.Element {
  const Icon = ICONS[name] ?? Blocks;
  return <Icon className={className} aria-hidden="true" />;
}
