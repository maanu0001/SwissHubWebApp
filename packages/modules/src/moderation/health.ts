import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';

const log = createLogger('moderation:health');

/**
 * Kann SwissHub Discords Audit Log lesen?
 *
 * Ohne das Recht «Audit-Log anzeigen» bleibt der Bot vollstaendig
 * funktionsfaehig - er erfaehrt nur nicht mehr, **wer** direkt in Discord
 * gebannt oder gekickt hat. Banns und Timeouts landen weiterhin in der Akte,
 * aber ohne Handelnden und ohne Grund; Kicks gar nicht, weil sie sich ohne
 * Audit-Eintrag nicht von einem freiwilligen Austritt unterscheiden lassen.
 *
 * Das ist ein stiller Ausfall - nichts bricht, es fehlt nur etwas. Genau
 * solche Ausfaelle bemerkt niemand, bis jemand eine Akte liest und sich
 * wundert. Deshalb wird es geprueft und angezeigt, statt darauf zu warten.
 *
 * ## Warum eine Probe und keine Rechteabfrage
 *
 * Weil sie die richtige Frage stellt. Die berechnete Rechtemaske sagt, was
 * Discord uns zuschreibt; die Probe sagt, ob der Abruf tatsaechlich
 * funktioniert. Am Ende zaehlt nur das zweite.
 */

export type AuditZugang = 'ok' | 'kein-recht' | 'unerreichbar';

export interface AuditZugangsBefund {
  zugang: AuditZugang;
  geprueftAm: Date;
}

/**
 * Probiert einen minimalen Abruf.
 *
 * Ein einziger Eintrag, nicht mehr - die Antwort auf «geht es?» braucht keine
 * Daten. Faellt der Abruf mit einem Rechtefehler aus, ist die Antwort
 * eindeutig; bei allem anderen ist Discord gerade nicht erreichbar, und das
 * ist etwas anderes als ein fehlendes Recht.
 */
export async function pruefeAuditZugang(
  options: { gateway?: DiscordGateway } = {},
): Promise<AuditZugangsBefund> {
  const gateway = options.gateway ?? defaultDiscord;
  const geprueftAm = new Date();

  try {
    await gateway.guild.auditLog({ limit: 1 });
    return { zugang: 'ok', geprueftAm };
  } catch (error) {
    const zugang = istRechteFehler(error) ? 'kein-recht' : 'unerreichbar';
    if (zugang === 'kein-recht') {
      log.warn(
        'Moderationsaktionen direkt aus Discord können nicht erkannt werden - dem Bot fehlt die Berechtigung «Audit-Log anzeigen».',
      );
    } else {
      log.debug('Audit Log gerade nicht erreichbar', { error });
    }
    return { zugang, geprueftAm };
  }
}

/**
 * Haelt den Befund im Bot-Status fest.
 *
 * `null` bleibt `null`, solange nichts geprueft wurde - «noch nicht geprueft»
 * ist etwas anderes als «kein Zugang», und die Anzeige soll das eine nicht
 * fuer das andere ausgeben.
 *
 * Ein voruebergehend unerreichbares Discord aendert den gespeicherten Befund
 * nicht: sonst floepte die Anzeige bei jeder Stoerung zwischen «geht» und
 * «geht nicht», und niemand traute ihr mehr.
 */
export async function schreibeAuditZugang(befund: AuditZugangsBefund): Promise<void> {
  if (befund.zugang === 'unerreichbar') {
    return;
  }
  await prisma.botStatus.updateMany({
    where: { id: 'singleton' },
    data: { auditLogAccess: befund.zugang === 'ok', auditLogCheckedAt: befund.geprueftAm },
  });
}

/** Prueft und vermerkt in einem Schritt - was der Job im Bot braucht. */
export async function pruefeUndVermerkeAuditZugang(
  options: { gateway?: DiscordGateway } = {},
): Promise<AuditZugangsBefund> {
  const befund = await pruefeAuditZugang(options);
  await schreibeAuditZugang(befund);
  return befund;
}

/** Discord antwortet auf ein fehlendes Recht mit 403 bzw. Code 50001/50013. */
function istRechteFehler(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const kandidat = error as { status?: unknown; discordCode?: unknown };
  if (kandidat.status === 403) {
    return true;
  }
  return kandidat.discordCode === 50_001 || kandidat.discordCode === 50_013;
}
