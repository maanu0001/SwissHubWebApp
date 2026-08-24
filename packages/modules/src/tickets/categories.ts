import { prisma } from '@swisshub/database';
import type { TicketCategory, TicketFormFieldKind, TicketPriority } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { resolveGuildId } from '@swisshub/discord';

/**
 * Ticket-Kategorien.
 *
 * Eine Kategorie ist mehr als eine Beschriftung: sie entscheidet, wer
 * zustaendig ist, wo der Kanal entsteht und was beim Eroeffnen gefragt wird.
 * Deshalb liegt sie in der Datenbank und nicht in den Moduleinstellungen -
 * eine Liste von Objekten in einem JSON-Feld liesse sich weder verknuepfen
 * noch zaehlen.
 */

export interface TicketFormFieldInput {
  kind: TicketFormFieldKind;
  label: string;
  placeholder?: string | null;
  required: boolean;
  minLength?: number | null;
  maxLength?: number | null;
}

export interface TicketCategoryInput {
  name: string;
  description?: string | null;
  emoji?: string | null;
  active: boolean;
  sortOrder: number;
  discordCategoryId?: string | null;
  overflowCategoryId?: string | null;
  supportRoleIds: string[];
  pingSupport: boolean;
  defaultPriority: TicketPriority;
  channelNameTemplate: string;
  welcomeMessage?: string | null;
  closeMessage?: string | null;
  maxOpenPerUser: number;
  userCanClose: boolean;
  reminderAfterDays: number;
  autoCloseAfterDays: number;
  responseTargetHours: number;
  resolutionTargetHours: number;
  sensitive: boolean;
  formFields: TicketFormFieldInput[];
}

/**
 * Discord erlaubt hoechstens fuenf Felder je Modal.
 *
 * Die Grenze steht hier und nicht nur im Formular: ein sechstes Feld liesse
 * das Modal zur Laufzeit scheitern, und zwar erst dann, wenn ein Mitglied
 * ein Ticket eroeffnen will.
 */
export const MAX_FORM_FIELDS = 5;

export async function listCategories(): Promise<
  Array<TicketCategory & { formFields: Array<{ id: string; label: string; kind: TicketFormFieldKind; required: boolean; placeholder: string | null; minLength: number | null; maxLength: number | null; sortOrder: number }>; ticketCount: number }>
> {
  const eintraege = await prisma.ticketCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      formFields: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { tickets: true } },
    },
  });

  return eintraege.map(({ _count, ...kategorie }) => ({ ...kategorie, ticketCount: _count.tickets }));
}

/** Kategorien, in denen ein Mitglied ueberhaupt eroeffnen kann. */
export async function listOpenableCategories(): Promise<
  Array<Pick<TicketCategory, 'id' | 'name' | 'description' | 'emoji' | 'sensitive'>>
> {
  return prisma.ticketCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, description: true, emoji: true, sensitive: true },
  });
}

export async function getCategory(categoryId: string) {
  return prisma.ticketCategory.findUnique({
    where: { id: categoryId },
    include: { formFields: { orderBy: { sortOrder: 'asc' } } },
  });
}

function pruefe(input: TicketCategoryInput): void {
  if (input.formFields.length > MAX_FORM_FIELDS) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Discord erlaubt höchstens ${MAX_FORM_FIELDS} Felder je Formular.`,
    });
  }
  for (const feld of input.formFields) {
    if (
      feld.minLength !== null &&
      feld.minLength !== undefined &&
      feld.maxLength !== null &&
      feld.maxLength !== undefined &&
      feld.minLength > feld.maxLength
    ) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Beim Feld «${feld.label}» ist die Mindestlänge grösser als die Höchstlänge.`,
      });
    }
  }
}

export async function createCategory(input: TicketCategoryInput): Promise<TicketCategory> {
  pruefe(input);
  const guildId = await resolveGuildId();

  return prisma.ticketCategory.create({
    data: {
      guildId,
      ...daten(input),
      formFields: {
        create: input.formFields.map((feld, index) => ({
          kind: feld.kind,
          label: feld.label.slice(0, 45),
          placeholder: feld.placeholder?.slice(0, 100) ?? null,
          required: feld.required,
          minLength: feld.minLength ?? null,
          maxLength: feld.maxLength ?? null,
          sortOrder: index,
        })),
      },
    },
  });
}

export async function updateCategory(
  categoryId: string,
  input: TicketCategoryInput,
): Promise<TicketCategory> {
  pruefe(input);

  // Die Felder werden ersetzt, nicht zusammengefuehrt. Ein Abgleich einzelner
  // Felder braeuchte stabile Kennungen im Formular; die Antworten haengen
  // ohnehin am Beschriftungstext und nicht an der Feld-ID.
  return prisma.$transaction(async (tx) => {
    await tx.ticketFormField.deleteMany({ where: { categoryId } });
    return tx.ticketCategory.update({
      where: { id: categoryId },
      data: {
        ...daten(input),
        formFields: {
          create: input.formFields.map((feld, index) => ({
            kind: feld.kind,
            label: feld.label.slice(0, 45),
            placeholder: feld.placeholder?.slice(0, 100) ?? null,
            required: feld.required,
            minLength: feld.minLength ?? null,
            maxLength: feld.maxLength ?? null,
            sortOrder: index,
          })),
        },
      },
    });
  });
}

/**
 * Eine Kategorie entfernen.
 *
 * Nur, solange kein Ticket daran haengt. Sonst verloere das Archiv die
 * Zuordnung - und mit ihr die Grundlage, auf der die Sichtbarkeit
 * entschieden wird. Wer eine Kategorie loswerden will, an der Tickets
 * haengen, schaltet sie inaktiv.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const anzahl = await prisma.ticket.count({ where: { categoryId } });
  if (anzahl > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `An dieser Kategorie hängen ${anzahl} Tickets. Schalte sie stattdessen inaktiv.`,
    });
  }
  await prisma.ticketCategory.delete({ where: { id: categoryId } });
}

function daten(input: TicketCategoryInput) {
  return {
    name: input.name.slice(0, 100),
    description: input.description?.slice(0, 500) ?? null,
    emoji: input.emoji?.slice(0, 8) ?? null,
    active: input.active,
    sortOrder: input.sortOrder,
    discordCategoryId: input.discordCategoryId ?? null,
    overflowCategoryId: input.overflowCategoryId ?? null,
    supportRoleIds: input.supportRoleIds,
    pingSupport: input.pingSupport,
    defaultPriority: input.defaultPriority,
    channelNameTemplate: input.channelNameTemplate.slice(0, 64),
    welcomeMessage: input.welcomeMessage?.slice(0, 2000) ?? null,
    closeMessage: input.closeMessage?.slice(0, 2000) ?? null,
    maxOpenPerUser: input.maxOpenPerUser,
    userCanClose: input.userCanClose,
    reminderAfterDays: input.reminderAfterDays,
    autoCloseAfterDays: input.autoCloseAfterDays,
    responseTargetHours: input.responseTargetHours,
    resolutionTargetHours: input.resolutionTargetHours,
    sensitive: input.sensitive,
  };
}
