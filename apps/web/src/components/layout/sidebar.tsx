'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { BrandMark } from '@/components/shared/brand-mark';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SidebarNav, type NavigationGroup } from './sidebar-nav';
import { ServerCard, type ServerCardData } from './server-card';
import { PromoCard } from './promo-card';

export interface SidebarProps {
  groups: NavigationGroup[];
  server: ServerCardData;
  bot: { online: boolean; wsPingMs: number | null };
  discordUrl: string;
  logoUrl: string;
}

/**
 * Seitenleiste im SwissHub-Design: Marke, Server, gruppierte Navigation,
 * Hinweiskarte und eine Leiste mit Statusanzeige und Werkzeugen.
 * Der eingeklappte Zustand bleibt für die Sitzung erhalten.
 */
export function Sidebar({ groups, server, bot, discordUrl, logoUrl }: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 border-r border-border bg-sidebar px-3 py-4 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[74px]' : 'w-[264px]',
      )}
      data-collapsed={collapsed}
    >
      <Link
        href="/dashboard"
        className="rounded-lg px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${branding.name} Dashboard`}
      >
        <BrandMark size={collapsed ? 34 : 38} withWordmark={!collapsed} logoUrl={logoUrl} />
      </Link>

      <ServerCard data={server} collapsed={collapsed} />

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim">
        <SidebarNav groups={groups} collapsed={collapsed} />
      </div>

      {collapsed ? null : <PromoCard href={discordUrl} />}

      <TooltipProvider delayDuration={200}>
        <div className={cn('flex items-center gap-2 border-t border-border pt-3', collapsed && 'flex-col')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card/60 px-2 text-xs font-medium',
                  collapsed && 'w-9 flex-none px-0',
                )}
                aria-label={bot.online ? 'Bot online' : 'Bot offline'}
              >
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    bot.online ? 'bg-success shadow-[0_0_8px_hsl(var(--success))]' : 'bg-destructive',
                  )}
                  aria-hidden="true"
                />
                {collapsed ? null : (
                  <span className={bot.online ? 'text-success' : 'text-muted-foreground'}>
                    {bot.online ? 'Online' : 'Offline'}
                  </span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {bot.online
                ? `Bot online${bot.wsPingMs !== null ? ` · Ping ${bot.wsPingMs} ms` : ''}`
                : 'Bot derzeit nicht erreichbar'}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={discordUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(
                  'grid size-9 flex-1 place-items-center rounded-lg border border-border bg-card/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground',
                  collapsed && 'w-9 flex-none',
                )}
                aria-label="Discord öffnen"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">Discord öffnen</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                className={cn(
                  'grid size-9 flex-1 place-items-center rounded-lg border border-border bg-card/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground',
                  collapsed && 'w-9 flex-none',
                )}
                aria-label={collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
                aria-pressed={collapsed}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                ) : (
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </aside>
  );
}
