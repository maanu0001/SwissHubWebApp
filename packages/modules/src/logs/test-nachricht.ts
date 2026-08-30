import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import type { DiscordLogCategory } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';
import { pruefeKanal, zielFuer } from './config';
import { formatiereTest } from './formatters';
import { kategorie } from './registry';

/**
 * Die Probe auf einen eingerichteten Kanal.
 *
 * Ausdruecklich **kein** Logeintrag: sie erzeugt keine Zeile in der
 * Zustelltabelle, keinen Akteneintrag und kein Statistikereignis. Wer eine
 * Verbindung prueft, soll damit keine Zahlen verschieben - eine Statistik,
 * die Testnachrichten mitzaehlt, ist ab dem ersten Test falsch.
 *
 * Gesendet wird unmittelbar, nicht ueber den Zusteller: die Person am
 * Dashboard wartet auf genau diese Antwort, und «wurde eingereiht» ist keine.
 */
export async function sendeTestnachricht(
  category: DiscordLogCategory,
  actor: { discordId: string; username: string },
  options: { gateway?: DiscordGateway } = {},
): Promise<void> {
  const gateway = options.gateway ?? defaultDiscord;
  const ziel = await zielFuer(category);
  if (!ziel) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Für diese Kategorie ist kein Kanal eingerichtet.',
    });
  }

  // Vor dem Senden pruefen, damit ein misslungener Test eine verstaendliche
  // Antwort gibt statt einer Discord-Fehlernummer.
  const befund = await pruefeKanal(ziel.channelId, { gateway });
  if (!befund.ok) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: befund.grund ?? 'Der Kanal ist nicht erreichbar.',
    });
  }

  await gateway.channels.send(ziel.channelId, {
    embeds: [formatiereTest(kategorie(category).label)],
    allowedMentions: { parse: [] },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LOG_CHANNEL_TEST_SENT,
    module: 'logs',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    metadata: { category, channelId: ziel.channelId },
  });
}
