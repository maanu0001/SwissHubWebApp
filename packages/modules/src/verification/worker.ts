import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { VERIFICATION_MODULE_ID } from './config';
import { entscheide, verificationSettings } from './service';

const logger = createLogger('verification:worker');

/**
 * Zeitsteuerung der Verifikation.
 *
 * Zwei Aufgaben, beide idempotent und beide gegen die Datenbank statt gegen
 * Zeitgeber im Arbeitsspeicher: Vorgaenge ablaufen lassen und alte
 * Nachrichtentexte loeschen.
 *
 * Ablaufen heisst nicht bannen. Wer nichts geschrieben hat, hat nichts getan -
 * vielleicht war er im Urlaub. Der Kick ist abschaltbar und als Vorgabe aus.
 */

export interface VerificationTickResult {
  abgelaufen: number;
  gekickt: number;
  bereinigt: number;
}

export async function runVerificationTick(
  now = new Date(),
  gateway: DiscordGateway = defaultDiscord,
): Promise<VerificationTickResult> {
  const settings = await verificationSettings();
  let abgelaufen = 0;
  let gekickt = 0;

  if (settings.expireEnabled) {
    const grenze = new Date(now.getTime() - settings.expireAfterHours * 3600_000);
    const faellig = await prisma.verificationRequest.findMany({
      // Nur wer nie geschrieben hat. Wer geschrieben hat, wartet auf uns -
      // nicht umgekehrt, und den lassen wir nicht ablaufen.
      where: { status: 'WAITING_FOR_MESSAGE', joinedAt: { lt: grenze } },
      select: { id: true, discordId: true, displayName: true },
      take: 100,
    });

    for (const eintrag of faellig) {
      const entschieden = await entscheide(
        eintrag.id,
        { status: 'EXPIRED', by: 'SYSTEM', reason: 'Keine Nachricht innerhalb der Frist.' },
        now,
      );
      if (!entschieden) {
        continue;
      }
      abgelaufen += 1;

      await safeRecordAudit({
        action: AUDIT_ACTIONS.VERIFICATION_EXPIRED,
        module: VERIFICATION_MODULE_ID,
        actorDiscordId: 'system',
        actorUsername: 'Zeitsteuerung',
        targetDiscordId: eintrag.discordId,
        targetLabel: eintrag.displayName ?? eintrag.discordId,
        success: true,
        metadata: { requestId: eintrag.id, stunden: settings.expireAfterHours },
      });

      if (settings.kickOnExpire) {
        try {
          await gateway.members.kick(
            eintrag.discordId,
            'Verifikation nicht innerhalb der Frist abgeschlossen',
          );
          gekickt += 1;
        } catch (error) {
          // Ein gescheiterter Kick ist kein Grund, den Ablauf zurueckzunehmen.
          logger.warn('Kick nach Ablauf fehlgeschlagen', { discordId: eintrag.discordId, error });
        }
      }
    }
  }

  // Aufbewahrung: der Nachrichtentext verschwindet, der Vorgang bleibt.
  // Ohne den Vorgang waere nicht mehr nachvollziehbar, wer wann wie
  // entschieden hat - und genau das ist der Zweck der Aufbewahrung.
  const textGrenze = new Date(now.getTime() - settings.retentionDays * 24 * 3600_000);
  const [nachrichten, vorgaenge] = await Promise.all([
    prisma.verificationMessage.deleteMany({ where: { createdAt: { lt: textGrenze } } }),
    prisma.verificationRequest.updateMany({
      where: { latestMessage: { not: null }, decidedAt: { lt: textGrenze } },
      data: { latestMessage: null },
    }),
  ]);
  const bereinigt = nachrichten.count + vorgaenge.count;

  if (abgelaufen > 0 || bereinigt > 0) {
    logger.info('Verifikation fortgeschrieben', { abgelaufen, gekickt, bereinigt });
  }
  return { abgelaufen, gekickt, bereinigt };
}
