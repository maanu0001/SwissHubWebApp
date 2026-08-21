import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CommunicationDraft } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { COMMUNICATION_MODULE_ID } from './config';
import type { CommunicationActor } from './service';
import type { DraftInput } from './schemas';

/**
 * Entwürfe.
 *
 * Ein Entwurf ist bewusst nicht dasselbe wie ein Verlaufseintrag: er hat
 * weder Discord-Nachricht noch Zeitpunkt und wird beliebig oft überschrieben,
 * während ein gesendeter Eintrag unveränderlich festhält, was tatsächlich
 * rausging. Sie in einer Tabelle zu führen hiesse, beides zu verwässern.
 *
 * Entwürfe berühren Discord nicht. Sie lassen sich deshalb auch dann
 * schreiben, wenn Discord gerade nicht erreichbar ist.
 */

const mentionType = (value: string): CommunicationDraft['mentionType'] => {
  switch (value) {
    case 'everyone':
      return 'EVERYONE';
    case 'here':
      return 'HERE';
    case 'role':
      return 'ROLE';
    case 'user':
      return 'USER';
    default:
      return 'NONE';
  }
};

export async function saveDraft(actor: CommunicationActor, input: DraftInput): Promise<CommunicationDraft> {
  const data = {
    type: input.type,
    title: input.title,
    content: input.content,
    bannerUrl: input.bannerUrl ?? null,
    discordChannelId: input.channelId ?? null,
    mentionType: mentionType(input.mention),
    mentionTarget: input.mentionTarget ?? null,
    eventLocation: input.location ?? null,
    eventStartsAt: input.startsAt ?? null,
    eventResponsibleId: input.responsibleDiscordId ?? null,
    registrationType: input.registrationType,
    registrationValue: input.registrationValue ?? null,
  };

  const draft = input.id
    ? await updateOwn(actor, input.id, data)
    : await prisma.communicationDraft.create({
        data: {
          ...data,
          createdByDiscordId: actor.discordId,
          createdByUsername: actor.username,
        },
      });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.COMMUNICATION_DRAFT_SAVED,
    module: COMMUNICATION_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: draft.title,
    success: true,
    metadata: { draftId: draft.id, type: draft.type, updated: Boolean(input.id) },
  });

  return draft;
}

/**
 * Ändert einen Entwurf.
 *
 * Nur eigene: ein Entwurf ist eine Notiz, keine Freigabe. Wer fremde Entwürfe
 * überschreiben können soll, braucht dafür eine bewusste Entscheidung - die
 * gibt es hier nicht.
 */
async function updateOwn(
  actor: CommunicationActor,
  id: string,
  data: Record<string, unknown>,
): Promise<CommunicationDraft> {
  const existing = await prisma.communicationDraft.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Entwurf gibt es nicht (mehr).' });
  }
  if (existing.createdByDiscordId !== actor.discordId && !actor.isOwner) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Dieser Entwurf gehört jemand anderem.',
    });
  }
  return prisma.communicationDraft.update({ where: { id }, data });
}

export async function listDrafts(discordId: string, limit = 25): Promise<CommunicationDraft[]> {
  return prisma.communicationDraft.findMany({
    where: { createdByDiscordId: discordId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
}

export async function getDraft(id: string): Promise<CommunicationDraft | null> {
  return prisma.communicationDraft.findUnique({ where: { id } });
}

export async function deleteDraft(actor: CommunicationActor, id: string): Promise<void> {
  const existing = await prisma.communicationDraft.findUnique({ where: { id } });
  if (!existing) {
    return;
  }
  if (existing.createdByDiscordId !== actor.discordId && !actor.isOwner) {
    throw new AppError('FORBIDDEN', { userMessage: 'Dieser Entwurf gehört jemand anderem.' });
  }
  await prisma.communicationDraft.delete({ where: { id } });
}
