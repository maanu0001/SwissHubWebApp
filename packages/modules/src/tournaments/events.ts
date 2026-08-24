import { prisma } from '@swisshub/database';
import type { TournamentEventKind } from '@swisshub/database';

/** Wer eine Aktion ausloest. */
export interface TournamentActor {
  discordId: string;
  username: string;
  /** WEBAPP, DISCORD oder SYSTEM. */
  source: 'WEBAPP' | 'DISCORD' | 'SYSTEM';
}

export const ZEITSTEUERUNG: TournamentActor = {
  discordId: 'system',
  username: 'Zeitsteuerung',
  source: 'SYSTEM',
};

/**
 * Ein Ereignis im Turnierverlauf festhalten.
 *
 * Bewusst getrennt vom zentralen Audit-Protokoll: dort steht, wer im
 * Dashboard etwas Folgenreiches getan hat; hier steht, was mit diesem einen
 * Turnier geschehen ist - auch das, was die Zeitsteuerung von selbst tut.
 * Beides in einem Protokoll zu fuehren macht keines von beiden lesbar.
 */
export async function tournamentEvent(
  tournamentId: string,
  kind: TournamentEventKind,
  actor: TournamentActor | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await prisma.tournamentEvent.create({
    data: {
      tournamentId,
      kind,
      actorDiscordId: actor?.discordId ?? null,
      actorUsername: actor?.username ?? null,
      actorSource: actor?.source ?? 'SYSTEM',
      detail: detail as never,
    },
  });
}

/**
 * Kennung fuer die Adresszeile aus einem Namen.
 *
 * Umlaute werden ausgeschrieben, nicht weggeworfen: aus "Schweizer Cup" soll
 * `schweizer-cup` werden und nicht `schweizer-cp`.
 */
export function slugify(text: string): string {
  // Das Eszett steht als Code-Punkt und nicht als Zeichen: der Waechtertest
  // verbietet es in Quelltexten, und hier wird es abgebildet, nicht
  // geschrieben - eine Ausnahme im Waechter waere der schlechtere Tausch.
  const ESZETT = '\u00DF';
  const UMSCHRIFT: Record<string, string> = {
    ä: 'ae', ö: 'oe', ü: 'ue', [ESZETT]: 'ss',
    à: 'a', á: 'a', â: 'a', è: 'e', é: 'e', ê: 'e', ë: 'e',
    ì: 'i', í: 'i', î: 'i', ò: 'o', ó: 'o', ô: 'o',
    ù: 'u', ú: 'u', û: 'u', ç: 'c', ñ: 'n',
  };

  return text
    .toLowerCase()
    .replace(/[äöü\u00DFàáâèéêëìíîòóôùúûçñ]/gu, (zeichen) => UMSCHRIFT[zeichen] ?? zeichen)
    .replace(/[^a-z0-9-]/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 60);
}
