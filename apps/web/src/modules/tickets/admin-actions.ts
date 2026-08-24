'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { tickets } from '@swisshub/modules';
import { defineAction } from '@/server/action';

/**
 * Verwaltung des Ticket-Moduls: Kategorien und Panels.
 *
 * Getrennt von den Ticket-Aktionen, weil hier etwas anderes geschieht. Eine
 * Antwort betrifft ein Ticket; eine Kategorie betrifft alle kuenftigen. Die
 * Berechtigungen sind entsprechend eigene.
 */

const formFieldSchema = z.object({
  kind: z.enum(['SHORT_TEXT', 'LONG_TEXT']),
  label: z.string().min(1).max(45),
  placeholder: z.string().max(100).nullable().default(null),
  required: z.boolean().default(false),
  minLength: z.number().int().min(0).max(4000).nullable().default(null),
  maxLength: z.number().int().min(1).max(4000).nullable().default(null),
});

const categorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().default(null),
  emoji: z.string().max(8).nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
  discordCategoryId: z.string().nullable().default(null),
  overflowCategoryId: z.string().nullable().default(null),
  supportRoleIds: z.array(z.string()).max(25).default([]),
  pingSupport: z.boolean().default(false),
  defaultPriority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  channelNameTemplate: z.string().min(1).max(64).default('ticket-{number}-{username}'),
  welcomeMessage: z.string().max(2000).nullable().default(null),
  closeMessage: z.string().max(2000).nullable().default(null),
  maxOpenPerUser: z.number().int().min(0).max(50).default(0),
  userCanClose: z.boolean().default(true),
  reminderAfterDays: z.number().int().min(0).max(365).default(0),
  autoCloseAfterDays: z.number().int().min(0).max(365).default(0),
  responseTargetHours: z.number().int().min(0).max(720).default(0),
  resolutionTargetHours: z.number().int().min(0).max(8760).default(0),
  sensitive: z.boolean().default(false),
  formFields: z.array(formFieldSchema).max(tickets.MAX_FORM_FIELDS).default([]),
});

export const createCategoryAction = defineAction(
  {
    name: 'tickets.categories.create',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.categoriesManage,
    schema: categorySchema,
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const kategorie = await tickets.createCategory(input);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_CATEGORY_CREATED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: kategorie.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/kategorien');
    return { categoryId: kategorie.id };
  },
);

export const updateCategoryAction = defineAction(
  {
    name: 'tickets.categories.update',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.categoriesManage,
    schema: categorySchema.extend({ categoryId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { categoryId, ...rest } = input;
    const kategorie = await tickets.updateCategory(categoryId, rest);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_CATEGORY_UPDATED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: kategorie.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/kategorien');
    return { ok: true };
  },
);

export const deleteCategoryAction = defineAction(
  {
    name: 'tickets.categories.delete',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.categoriesManage,
    schema: z.object({ categoryId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const kategorie = await tickets.getCategory(input.categoryId);
    await tickets.deleteCategory(input.categoryId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_CATEGORY_DELETED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: kategorie?.name ?? input.categoryId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/kategorien');
    return { ok: true };
  },
);

const panelSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4000),
  bannerUrl: z.string().url().max(500).nullable().default(null),
  thumbnailUrl: z.string().url().max(500).nullable().default(null),
  footerText: z.string().max(2048).nullable().default(null),
  color: z.number().int().min(0).max(0xffffff).nullable().default(null),
  discordChannelId: z.string().regex(/^\d{17,20}$/u),
  buttonLabel: z.string().min(1).max(80).default('Ticket erstellen'),
  buttonEmoji: z.string().max(8).nullable().default(null),
  active: z.boolean().default(true),
  categoryIds: z.array(z.string().cuid()).min(1).max(tickets.MAX_PANEL_KATEGORIEN),
});

export const createPanelAction = defineAction(
  {
    name: 'tickets.panels.create',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.panelsManage,
    schema: panelSchema,
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const panel = await tickets.createPanel(input);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_PANEL_CREATED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: panel.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/panels');
    return { panelId: panel.id };
  },
);

export const updatePanelAction = defineAction(
  {
    name: 'tickets.panels.update',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.panelsManage,
    schema: panelSchema.extend({ panelId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { panelId, ...rest } = input;
    const panel = await tickets.updatePanel(panelId, rest);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_PANEL_UPDATED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: panel.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/panels');
    return { ok: true };
  },
);

export const deletePanelAction = defineAction(
  {
    name: 'tickets.panels.delete',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.panelsManage,
    schema: z.object({ panelId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await tickets.deletePanel(input.panelId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_PANEL_DELETED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: input.panelId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/panels');
    return { ok: true };
  },
);

export const publishPanelAction = defineAction(
  {
    name: 'tickets.panels.publish',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.panelsManage,
    schema: z.object({ panelId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const panel = await tickets.publishPanel(input.panelId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_PANEL_PUBLISHED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: panel.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/panels');
    return { ok: true };
  },
);

// --- Schlagwörter --------------------------------------------------------

export const createTagAction = defineAction(
  {
    name: 'tickets.tags.create',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportManageTags,
    schema: z.object({
      name: z.string().min(1).max(40),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/u)
        .nullable()
        .default(null),
    }),
    rateLimit: 'ticketAdmin',
  },
  async ({ input }) => {
    const tag = await tickets.createTag(input.name, input.color);
    revalidatePath('/tickets/schlagwoerter');
    return { tagId: tag.id };
  },
);

export const deleteTagAction = defineAction(
  {
    name: 'tickets.tags.delete',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.supportManageTags,
    schema: z.object({ tagId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
  },
  async ({ input }) => {
    await tickets.deleteTag(input.tagId);
    revalidatePath('/tickets/schlagwoerter');
    return { ok: true };
  },
);

// --- Antwortvorlagen -----------------------------------------------------

const templateSchema = z.object({
  title: z.string().min(1).max(100),
  // Dieselbe Grenze wie eine Antwort: eine Vorlage, die nicht abschickbar
  // wäre, ist keine Vorlage.
  content: z.string().min(1).max(1800),
  categoryId: z.string().cuid().nullable().default(null),
});

export const createTemplateAction = defineAction(
  {
    name: 'tickets.templates.create',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.templatesManage,
    schema: templateSchema,
    rateLimit: 'ticketAdmin',
  },
  async ({ input }) => {
    const vorlage = await tickets.createTemplate(input);
    revalidatePath('/tickets/vorlagen');
    return { templateId: vorlage.id };
  },
);

export const updateTemplateAction = defineAction(
  {
    name: 'tickets.templates.update',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.templatesManage,
    schema: templateSchema.extend({ templateId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
  },
  async ({ input }) => {
    const { templateId, ...rest } = input;
    await tickets.updateTemplate(templateId, rest);
    revalidatePath('/tickets/vorlagen');
    return { ok: true };
  },
);

export const deleteTemplateAction = defineAction(
  {
    name: 'tickets.templates.delete',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.templatesManage,
    schema: z.object({ templateId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
  },
  async ({ input }) => {
    await tickets.deleteTemplate(input.templateId);
    revalidatePath('/tickets/vorlagen');
    return { ok: true };
  },
);

// --- Sperren -------------------------------------------------------------

export const blockMemberAction = defineAction(
  {
    name: 'tickets.blocks.create',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.blockManage,
    schema: z.object({
      discordId: z.string().regex(/^\d{17,20}$/u),
      username: z.string().min(1).max(64).nullable().default(null),
      reason: z.string().min(3).max(500),
      /** Tage; 0 bedeutet unbefristet. */
      days: z.number().int().min(0).max(3650).default(0),
    }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const eintrag = await tickets.blockMember(
      {
        discordId: input.discordId,
        username: input.username,
        reason: input.reason,
        expiresAt: input.days > 0 ? new Date(Date.now() + input.days * 24 * 3600_000) : null,
      },
      { discordId: ctx.user.discordId, username: ctx.user.username, source: 'WEBAPP' },
    );
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_BLOCKED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: input.discordId,
      targetLabel: input.username ?? input.discordId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { grund: input.reason, tage: input.days },
    });
    revalidatePath('/tickets/sperren');
    return { blockId: eintrag.id };
  },
);

export const liftBlockAction = defineAction(
  {
    name: 'tickets.blocks.lift',
    module: 'tickets',
    permission: tickets.TICKET_PERMISSIONS.blockManage,
    schema: z.object({ blockId: z.string().cuid() }),
    rateLimit: 'ticketAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await tickets.liftBlock(input.blockId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.TICKET_UNBLOCKED,
      module: 'tickets',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: input.blockId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });
    revalidatePath('/tickets/sperren');
    return { ok: true };
  },
);
