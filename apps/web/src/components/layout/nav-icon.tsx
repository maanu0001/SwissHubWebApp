import {
  Bell,
  Blocks,
  Bot,
  Crown,
  Database,
  Gavel,
  Gift,
  Hash,
  House,
  KeyRound,
  LayoutDashboard,
  Lock,
  Megaphone,
  MessageSquare,
  Mic,
  Music,
  Palette,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Ticket,
  TrendingUp,
  Trophy,
  Users,
  UserSearch,
  Volume2,
  type LucideIcon,
} from 'lucide-react';

/**
 * Erlaubte Navigations- und Modulsymbole.
 *
 * Bewusst als feste Zuordnung statt dynamischem Import: dadurch landet nur ein
 * kleiner Teil der Icon-Bibliothek im Bundle und Module können keine
 * beliebigen Komponenten einschleusen.
 */
const ICONS: Record<string, LucideIcon> = {
  Bell,
  Blocks,
  Bot,
  Crown,
  Database,
  Gavel,
  Gift,
  Hash,
  House,
  KeyRound,
  LayoutDashboard,
  Lock,
  Megaphone,
  MessageSquare,
  Mic,
  Music,
  Palette,
  RefreshCw,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Ticket,
  TrendingUp,
  Trophy,
  Users,
  UserSearch,
  Volume2,
};

export function NavIcon({ name, className }: { name: string; className?: string }): React.JSX.Element {
  const Icon = ICONS[name] ?? Blocks;
  return <Icon className={className} aria-hidden="true" />;
}
