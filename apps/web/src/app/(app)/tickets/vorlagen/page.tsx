import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { TemplateManager } from '@/modules/tickets/components/template-manager';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ticketSections } from '@/server/tickets';

export const metadata: Metadata = { title: 'Antwortvorlagen' };
export const dynamic = 'force-dynamic';

/** Antwortvorlagen für wiederkehrende Fragen. */
export default async function TicketVorlagenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.templatesManage);
  const [vorlagen, kategorien] = await Promise.all([
    tickets.listTemplates(),
    tickets.listOpenableCategories(),
  ]);
  const namen = new Map(kategorien.map((kategorie) => [kategorie.id, kategorie.name]));

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <TemplateManager
        csrfToken={csrfTokenFor(context)}
        kategorien={kategorien.map((kategorie) => ({ id: kategorie.id, name: kategorie.name }))}
        vorlagen={vorlagen.map((vorlage) => ({
          templateId: vorlage.id,
          title: vorlage.title,
          content: vorlage.content,
          categoryId: vorlage.categoryId,
          kategorieName: vorlage.categoryId ? (namen.get(vorlage.categoryId) ?? null) : null,
        }))}
      />
    </>
  );
}
