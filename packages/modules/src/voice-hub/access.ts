import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel, VoicePreset } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { VOICE_HUB_PERMISSIONS } from './config';

/**
 * Wer einen Talk verwalten darf.
 *
 * Zwei Wege fuehren hierher, und beide gehen durch dieselbe Pruefung: der
 * Knopf auf Discord und der Knopf im Dashboard. Deshalb steht sie hier und
 * nicht in einem der beiden - eine Regel, die es zweimal gibt, gilt bald
 * unterschiedlich.
 *
 * Und sie prueft bei *jedem* Klick neu. Wer das Bedienfeld urspruenglich
 * bekommen hat, sagt nichts darueber aus, wem der Talk jetzt gehoert: er kann
 * inzwischen uebergeben worden sein, und die alte Nachricht steht trotzdem
 * noch im Kanal.
 */

export interface VoiceViewer {
  discordId: string;
  can(permission: string): boolean;
}

export interface VoiceZugriff {
  /** Talk ueberhaupt sehen. */
  view: boolean;
  /** Name, Limit, Sperre, Sichtbarkeit. */
  manage: boolean;
  /** Einzelne Mitglieder zulassen, sperren, entfernen. */
  members: boolean;
  /** Uebergeben. */
  transfer: boolean;
  /** Schliessen. */
  destroy: boolean;
  /** Ist der Betrachter der Besitzer? */
  istBesitzer: boolean;
  /** Handelt er als Verwaltung statt als Besitzer? */
  alsVerwaltung: boolean;
}

const KEIN_ZUGRIFF: VoiceZugriff = {
  view: false,
  manage: false,
  members: false,
  transfer: false,
  destroy: false,
  istBesitzer: false,
  alsVerwaltung: false,
};

/**
 * Was dieser Betrachter mit diesem Talk tun darf.
 *
 * Der Besitzer braucht die Rechte fuer den eigenen Talk, die Verwaltung die
 * fuer fremde. Wer beides hat, bekommt die Vereinigung - ein Administrator
 * soll seinen eigenen Talk nicht schlechter verwalten koennen als einen
 * fremden.
 */
export function getVoiceAccess(viewer: VoiceViewer, kanal: TemporaryVoiceChannel): VoiceZugriff {
  const istBesitzer = kanal.ownerDiscordId === viewer.discordId;
  const p = VOICE_HUB_PERMISSIONS;

  const alsVerwaltung = viewer.can(p.adminManage) || viewer.can(p.adminView);

  if (!istBesitzer && !alsVerwaltung) {
    return KEIN_ZUGRIFF;
  }

  const eigen = (recht: string): boolean => istBesitzer && viewer.can(recht);
  const fremd = viewer.can(p.adminManage);

  return {
    view: true,
    manage: eigen(p.manageOwn) || fremd,
    members: eigen(p.manageUsers) || fremd,
    transfer: eigen(p.transferOwnership) || fremd,
    destroy: eigen(p.manageOwn) || viewer.can(p.adminDelete),
    istBesitzer,
    alsVerwaltung: !istBesitzer,
  };
}

/** Wirft, wenn das benoetigte Recht fehlt. */
export function assertVoiceRecht(
  zugriff: VoiceZugriff,
  recht: keyof VoiceZugriff,
  meldung: string,
): void {
  if (!zugriff[recht]) {
    throw new AppError('FORBIDDEN', { userMessage: meldung });
  }
}

export interface KanalMitPreset extends TemporaryVoiceChannel {
  preset: VoicePreset | null;
}

/**
 * Laedt einen Talk und prueft den Zugriff.
 *
 * Jede Aktion geht hier durch - der Discord-Knopf wie die Server Action. Eine
 * Kanalkennung aus einem Knopf oder aus dem Browser sagt nichts darueber aus,
 * ob sie den Klickenden etwas angeht.
 *
 * Nicht vorhanden und nicht zugaenglich antworten gleich: sonst liesse sich an
 * der Antwort ablesen, welche Talks es gibt und wem sie gehoeren.
 */
export async function ladeKanalMitZugriff(
  viewer: VoiceViewer,
  kanalId: string,
  guildId: string,
): Promise<{ kanal: KanalMitPreset; zugriff: VoiceZugriff }> {
  const kanal = await prisma.temporaryVoiceChannel.findFirst({
    where: { id: kanalId, guildId, closedAt: null },
    include: { preset: true },
  });

  if (!kanal) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Talk gibt es nicht mehr.' });
  }

  const zugriff = getVoiceAccess(viewer, kanal);
  if (!zugriff.view) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Talk gibt es nicht mehr.' });
  }

  return { kanal, zugriff };
}
