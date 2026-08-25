'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { members, searchMembers } from '@swisshub/modules';
import { AppError, sanitizeText, snowflakeSchema } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { memberActor, memberViewer } from '@/server/members';

/**
 * Die Aktionen des Member Center.
 *
 * Jede ist ein duenner Adapter auf einen Dienst, der die Zugriffspruefung
 * selbst vornimmt. Hier steht kein zweites Regelwerk - eine Regel, die es
 * zweimal gibt, gilt bald unterschiedlich.
 *
 * `selfService` steht dort, wo der Dienst aus Betrachter und Ziel entscheidet:
 * eine feste Berechtigung waere an dieser Stelle falsch, weil sie nicht
 * zwischen dem eigenen Profil und einem fremden unterscheidet.
 */

const searchSchema = z.object({
  query: z
    .string()
    .max(100)
    .transform((value) => sanitizeText(value, 100)),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * Mitgliedersuche.
 *
 * Die Suche läuft serverseitig gegen Discord - es wird niemals die komplette
 * Mitgliederliste an den Browser gesendet.
 */
export const searchMembersAction = defineAction(
  {
    name: 'members.search',
    module: 'members',
    permission: 'members.view',
    schema: searchSchema,
    rateLimit: 'memberSearch',
    freshness: 'cached',
  },
  async ({ input }) => {
    const members = await searchMembers(input.query, { limit: input.limit ?? 20 });
    return members.map((member) => ({
      discordId: member.discordId,
      username: member.username,
      displayName: member.displayName,
      avatarHash: member.avatarHash,
      isBot: member.isBot,
      roles: member.roles.slice(0, 5).map((role) => ({ id: role.id, name: role.name, color: role.color })),
      jailed: member.activeJail !== null,
    }));
  },
);

// --- Rollen ---------------------------------------------------------------

const rollenSchema = z.object({
  discordId: snowflakeSchema,
  roleId: snowflakeSchema,
});

export const grantMemberRoleAction = defineAction(
  {
    name: 'members.roles.grant',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.rolesManage,
    schema: rollenSchema,
    rateLimit: 'memberCenter',
    // Rollen sind Rechte. Wer seine Rolle gerade verloren hat, soll damit
    // nicht noch eine letzte Aenderung durchbekommen.
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.grantMemberRole({
      viewer: memberViewer(ctx),
      actor: memberActor(ctx),
      targetDiscordId: input.discordId,
      roleId: input.roleId,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

export const revokeMemberRoleAction = defineAction(
  {
    name: 'members.roles.revoke',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.rolesManage,
    schema: rollenSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.revokeMemberRole({
      viewer: memberViewer(ctx),
      actor: memberActor(ctx),
      targetDiscordId: input.discordId,
      roleId: input.roleId,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

// --- Interne Notizen ------------------------------------------------------

const notizSchema = z.object({
  discordId: snowflakeSchema,
  content: z.string().min(1).max(members.NOTIZ_MAX),
  category: z.string().max(40).nullish(),
  pinned: z.boolean().optional(),
});

export const createMemberNoteAction = defineAction(
  {
    name: 'members.notes.create',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.notesCreate,
    schema: notizSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const notiz = await members.createMemberNote(memberViewer(ctx), memberActor(ctx), {
      targetDiscordId: input.discordId,
      content: input.content,
      category: input.category ?? null,
      pinned: input.pinned ?? false,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { id: notiz.id };
  },
);

const notizAendernSchema = z.object({
  discordId: snowflakeSchema,
  id: z.string().cuid(),
  content: z.string().min(1).max(members.NOTIZ_MAX),
  category: z.string().max(40).nullish(),
  pinned: z.boolean().optional(),
});

export const updateMemberNoteAction = defineAction(
  {
    name: 'members.notes.update',
    module: 'members',
    // Die eigene Notiz darf aendern, wer Notizen schreiben darf; fremde nur
    // mit der eigenen Berechtigung dafuer. Welcher Fall vorliegt, weiss erst
    // der Dienst - er kennt den Autor.
    selfService: true,
    schema: notizAendernSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.updateMemberNote(memberViewer(ctx), memberActor(ctx), {
      id: input.id,
      content: input.content,
      category: input.category ?? null,
      pinned: input.pinned,
    });
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

export const deleteMemberNoteAction = defineAction(
  {
    name: 'members.notes.delete',
    module: 'members',
    permission: members.MEMBER_PERMISSIONS.notesDelete,
    schema: z.object({ discordId: snowflakeSchema, id: z.string().cuid() }),
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await members.deleteMemberNote(memberViewer(ctx), memberActor(ctx), input.id);
    revalidatePath(`/members/${input.discordId}`);
    return { ok: true };
  },
);

// --- XP -------------------------------------------------------------------

const xpSchema = z.object({
  discordId: snowflakeSchema,
  delta: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.string().max(200).optional(),
});

/**
 * XP aendern.
 *
 * Ueber den bestehenden Level-Dienst und die bestehende Level-Berechtigung -
 * ein eigener Member-Center-Schluessel dafuer waere ein zweiter Schalter fuer
 * dieselbe Tuer.
 */
export const adjustMemberXpAction = defineAction(
  {
    name: 'members.xp.adjust',
    module: 'members',
    permission: 'level.members.manage',
    schema: xpSchema,
    rateLimit: 'memberCenter',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    if (input.delta === 0) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Ohne Änderung gibt es nichts zu tun.' });
    }
    const { level } = await import('@swisshub/modules');
    const ergebnis = await level.adjustXp(memberActor(ctx), {
      target: { discordId: input.discordId },
      amount: input.delta,
      reason: input.reason ?? 'Member Center',
    });
    revalidatePath(`/members/${input.discordId}`);
    return { xp: ergebnis.xpAfter, level: ergebnis.levelAfter };
  },
);
