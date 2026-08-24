import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { PanelManager } from '@/modules/tickets/components/panel-manager';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { ticketSections } from '@/server/tickets';

export const metadata: Metadata = { title: 'Ticket-Panels' };
export const dynamic = 'force-dynamic';

/** Panels: die Nachricht auf Discord, über die Mitglieder eröffnen. */
export default async function TicketPanelsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.panelsManage);
  const [panels, kategorien, optionen] = await Promise.all([
    tickets.listPanels(),
    tickets.listCategories(),
    loadDiscordOptions(),
  ]);

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <PanelManager
        csrfToken={csrfTokenFor(context)}
        channels={optionen.channels}
        kategorien={kategorien.map((kategorie) => ({
          id: kategorie.id,
          name: kategorie.name,
          active: kategorie.active,
        }))}
        panels={panels.map((panel) => ({
          panelId: panel.id,
          veroeffentlicht: panel.discordMessageId !== null,
          kategorieNamen: panel.categories.map((eintrag) => eintrag.category.name),
          name: panel.name,
          title: panel.title,
          description: panel.description,
          bannerUrl: panel.bannerUrl ?? '',
          thumbnailUrl: panel.thumbnailUrl ?? '',
          footerText: panel.footerText ?? '',
          discordChannelId: panel.discordChannelId,
          buttonLabel: panel.buttonLabel,
          buttonEmoji: panel.buttonEmoji ?? '',
          active: panel.active,
          categoryIds: panel.categories.map((eintrag) => eintrag.categoryId),
        }))}
      />
    </>
  );
}
