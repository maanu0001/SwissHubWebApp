import { publish } from '@swisshub/automation';
import { resolveGuildId } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { isModuleEnabled } from '../module-state';
import { AUTOMATION_MODULE_ID } from './config';

const logger = createLogger('automation:emit');

/**
 * Der eine Weg, auf dem ein Modul ein Ereignis meldet.
 *
 * Warum nicht direkt `publish()`? Drei Gründe, und alle drei würden sonst an
 * jeder Aufrufstelle einzeln stehen:
 *
 * 1. **Die Gilde.** Ein Modul hat sie selten zur Hand; hier wird sie einmal
 *    aufgelöst.
 * 2. **Der Schalter.** Ist das Automation-Modul aus, wird nichts geschrieben.
 *    Ohne diese Prüfung füllte sich die Ereignistabelle auf jedem Server, der
 *    die Engine nie eingeschaltet hat.
 * 3. **Es wirft nie.** Eine Freischaltung soll nicht scheitern, weil die
 *    Meldung darüber scheitert. Das Melden ist die Nebensache; was das Modul
 *    getan hat, ist die Hauptsache und bereits getan.
 *
 * Deshalb gilt an jeder Aufrufstelle: `void meldeEreignis(...)` oder
 * `await` - beides ist richtig, und keines kann den Ablauf umwerfen.
 */
export async function meldeEreignis(
  type: string,
  payload: Record<string, unknown>,
  kopf: {
    guildId?: string;
    actorId?: string | null;
    subjectId?: string | null;
    entityId?: string | null;
    occurredAt?: Date;
  } = {},
): Promise<void> {
  try {
    if (!(await isModuleEnabled(AUTOMATION_MODULE_ID))) {
      return;
    }
    const guildId = kopf.guildId ?? (await resolveGuildId());
    await publish({
      type,
      guildId,
      payload,
      actorId: kopf.actorId ?? null,
      subjectId: kopf.subjectId ?? null,
      entityId: kopf.entityId ?? null,
      ...(kopf.occurredAt ? { occurredAt: kopf.occurredAt } : {}),
    });
  } catch (error) {
    // Auch hier nicht werfen: `publish` wirft schon nicht, aber das Auflösen
    // der Gilde und die Modulabfrage könnten es.
    logger.warn('Ereignis konnte nicht gemeldet werden', { type, error });
  }
}
