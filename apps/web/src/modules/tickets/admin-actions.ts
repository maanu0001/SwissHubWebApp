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
