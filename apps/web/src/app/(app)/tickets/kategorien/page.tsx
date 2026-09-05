import type { Metadata } from 'next';
import { tickets } from '@swisshub/modules';
import { CategoryManager } from '@/modules/tickets/components/category-manager';
import { TicketSectionNav } from '@/modules/tickets/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { ticketSections } from '@/server/tickets';

export const metadata: Metadata = { title: 'Ticket-Kategorien' };
export const dynamic = 'force-dynamic';

/** Kategorien: wer zuständig ist, wo der Kanal entsteht, was gefragt wird. */
export default async function TicketKategorienPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(tickets.TICKET_PERMISSIONS.categoriesManage);
  const [kategorien, optionen] = await Promise.all([tickets.listCategories(), loadDiscordOptions()]);

  return (
    <>
      <TicketSectionNav sections={ticketSections(context)} />
      <CategoryManager
        csrfToken={csrfTokenFor(context)}
        roles={optionen.roles}
        channels={optionen.channels}
        kategorien={kategorien.map((kategorie) => ({
          categoryId: kategorie.id,
          ticketCount: kategorie.ticketCount,
          name: kategorie.name,
          description: kategorie.description ?? '',
          emoji: kategorie.emoji ?? '',
          active: kategorie.active,
          sortOrder: kategorie.sortOrder,
          discordCategoryId: kategorie.discordCategoryId ?? '',
          overflowCategoryId: kategorie.overflowCategoryId ?? '',
          supportRoleIds: kategorie.supportRoleIds,
          pingSupport: kategorie.pingSupport,
          defaultPriority: kategorie.defaultPriority,
          channelNameTemplate: kategorie.channelNameTemplate,
          welcomeMessage: kategorie.welcomeMessage ?? '',
          closeMessage: kategorie.closeMessage ?? '',
          maxOpenPerUser: kategorie.maxOpenPerUser,
          userCanClose: kategorie.userCanClose,
          reminderAfterDays: kategorie.reminderAfterDays,
          autoCloseAfterDays: kategorie.autoCloseAfterDays,
          responseTargetHours: kategorie.responseTargetHours,
          resolutionTargetHours: kategorie.resolutionTargetHours,
          sensitive: kategorie.sensitive,
          formFields: kategorie.formFields.map((feld) => ({
            kind: feld.kind,
            label: feld.label,
            placeholder: feld.placeholder ?? '',
            required: feld.required,
            minLength: feld.minLength,
            maxLength: feld.maxLength,
          })),
        }))}
      />
    </>
  );
}
