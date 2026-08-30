import type { ModerationAction } from '@swisshub/database';
import { meldeEreignis } from '../automation/emit';

/**
 * Die Meldung einer Massnahme an die Automation Engine.
 *
 * Ein Ereignis fuer alle Quellen, nicht eines je Quelle. Eine Automation, die
 * auf Banns reagieren soll, interessiert sich fuer den Bann - nicht dafuer,
 * ob er ueber das Dashboard oder direkt in Discord verhaengt wurde. Wer den
 * Unterschied doch braucht, findet ihn im Feld `quelle`.
 *
 * Ein eigenes `discord.externerBann` haette bedeutet, dass jede kuenftige
 * Automation zwei Ereignisse abonnieren muss, um vollstaendig zu sein - und
 * dass die zweite Haelfte irgendwann vergessen wird.
 */
export async function meldeMassnahme(massnahme: ModerationAction): Promise<void> {
  await meldeEreignis(
    'moderation.action_created',
    {
      art: massnahme.type,
      quelle: massnahme.source,
      handelnderArt: massnahme.actorType,
      targetDiscordId: massnahme.targetDiscordId,
      targetUsername: massnahme.targetUsername,
      actorUsername: massnahme.actorUsername,
      grund: massnahme.reason,
    },
    {
      actorId: massnahme.actorDiscordId,
      subjectId: massnahme.targetDiscordId,
      entityId: massnahme.id,
      occurredAt: massnahme.createdAt,
    },
  );
}
