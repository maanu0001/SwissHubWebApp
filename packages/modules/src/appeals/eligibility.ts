import { prisma } from '@swisshub/database';
import type { ModerationAction } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { APPEALS_MODULE_ID, type AppealsSettings } from './config';
import { OFFENE_STATUS } from './status';

const logger = createLogger('appeals:eligibility');

/**
 * Darf diese Person jetzt einen Antrag stellen? (§5, §6)
 *
 * Die heikelste Auskunft des ganzen Moduls - nicht weil die Prüfung schwer
 * wäre, sondern weil ihr **Ergebnis** nach draussen geht. Ein Antragsteller
 * erfährt hier, ob er darf und ab wann; er erfährt nicht, warum nicht.
 *
 * Der Unterschied ist keine Feinheit:
 *
 *     «Du kannst ab dem 15.09.2026 einen neuen Antrag stellen.»      ✓
 *     «Gesperrt, weil Moderator X dich als Wiederholungstäter
 *      eingestuft hat.»                                              ✗
 *
 * Deshalb trägt der Befund zwei getrennte Felder: `grund` geht an den
 * Antragsteller, `internerGrund` bleibt im Protokoll. Wer die beiden je
 * zusammenlegt, hat ein Leck gebaut.
 */

export type Unzulaessigkeit =
  | 'KEIN_BANN'
  | 'MODUL_AUS'
  | 'WARTEFRIST'
  | 'BEREITS_OFFEN'
  | 'COOLDOWN'
  | 'ENDGUELTIG_ABGELEHNT'
  | 'NICHT_PRUEFBAR';

export interface Zulaessigkeit {
  erlaubt: boolean;
  /** Was der Antragsteller liest. Nie ein interner Sperrgrund. */
  grund?: string;
  /** Maschinenlesbar - für Oberfläche und Tests, nicht für die Anzeige. */
  code?: Unzulaessigkeit;
  /** Ab wann wieder. Wird dem Antragsteller als Datum genannt. */
  naechsteMoeglichkeitAm?: Date;
  /** Der bestehende Antrag, falls es einen gibt. */
  offenerAppealId?: string;
  /** Der Bann, auf den sich ein Antrag beziehen würde. Nur intern. */
  bann?: { discordId: string; reason: string | null };
  /** Der Moderationseintrag, sofern SwissHub den Bann gesetzt hat. Nur intern. */
  moderationsEintrag?: ModerationAction | null;
}

function inTagen(von: Date, tage: number): Date {
  return new Date(von.getTime() + tage * 24 * 3600_000);
}

/**
 * Den zugehörigen Moderationseintrag finden.
 *
 * Der jüngste Bann, der nicht bereits aufgehoben wurde. Findet sich keiner,
 * wurde der Bann ausserhalb von SwissHub gesetzt - das ist kein Fehler,
 * sondern der Normalfall bei einem alten Bann oder einem Bann direkt auf
 * Discord.
 */
export async function findeBannEintrag(discordId: string): Promise<ModerationAction | null> {
  const eintraege = await prisma.moderationAction.findMany({
    where: { targetDiscordId: discordId, type: { in: ['BAN', 'UNBAN'] }, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  // Der jüngste Eintrag entscheidet: steht dort UNBAN, ist der Bann von
  // damals aufgehoben und ein älterer BAN gehört nicht mehr zur Sache.
  const juengster = eintraege[0];
  return juengster?.type === 'BAN' ? juengster : null;
}

export async function pruefeZulaessigkeit(
  discordId: string,
  optionen: { gateway?: DiscordGateway; jetzt?: Date; guildId: string },
): Promise<Zulaessigkeit> {
  const gateway = optionen.gateway ?? defaultDiscord;
  const jetzt = optionen.jetzt ?? new Date();
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);

  // --- Gibt es überhaupt einen Bann? (§6) ---------------------------------
  //
  // Live bei Discord, nicht aus der eigenen Akte: die Akte sagt, was SwissHub
  // getan hat; Discord sagt, was gilt. Ein Bann, den jemand von Hand entfernt
  // hat, steht noch in der Akte - ein Antrag darauf wäre gegenstandslos.
  let bann: { discordId: string; reason: string | null } | null;
  try {
    bann = await gateway.bans.get(discordId);
  } catch (error) {
    // Discord antwortet nicht. Kein «du darfst nicht» - das wäre eine
    // Behauptung, die niemand geprüft hat. Stattdessen: bitte später.
    logger.warn('Bann konnte nicht geprüft werden', { discordId, error });
    return {
      erlaubt: false,
      code: 'NICHT_PRUEFBAR',
      grund: 'Dein Status lässt sich gerade nicht prüfen. Bitte versuche es in einigen Minuten erneut.',
    };
  }

  if (!bann) {
    return {
      erlaubt: false,
      code: 'KEIN_BANN',
      grund: 'Für dein Discord-Konto besteht aktuell kein aktiver SwissHub-Bann.',
    };
  }

  const moderationsEintrag = await findeBannEintrag(discordId).catch(() => null);

  // --- Läuft bereits ein Antrag? ------------------------------------------
  const offene = await prisma.appeal.findMany({
    where: {
      guildId: optionen.guildId,
      applicantDiscordId: discordId,
      status: { in: [...OFFENE_STATUS, 'DRAFT'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });

  const offenerEntwurf = offene.find((eintrag) => eintrag.status === 'DRAFT');
  const eingereichte = offene.filter((eintrag) => eintrag.status !== 'DRAFT');

  if (eingereichte.length >= settings.maxAktiveProPerson) {
    return {
      erlaubt: false,
      code: 'BEREITS_OFFEN',
      grund: 'Für dich läuft bereits ein Antrag. Wir melden uns, sobald es etwas Neues gibt.',
      ...(eingereichte[0] ? { offenerAppealId: eingereichte[0].id } : {}),
      bann,
      moderationsEintrag,
    };
  }

  // --- Endgültig abgelehnt? -----------------------------------------------
  const letzteAblehnung = await prisma.appeal.findFirst({
    where: {
      guildId: optionen.guildId,
      applicantDiscordId: discordId,
      decisionKind: 'REJECT',
    },
    orderBy: { decidedAt: 'desc' },
    select: { finalRejection: true, nextEligibleAt: true, decidedAt: true },
  });

  if (letzteAblehnung?.finalRejection) {
    return {
      erlaubt: false,
      code: 'ENDGUELTIG_ABGELEHNT',
      grund: 'Über deinen Fall wurde abschliessend entschieden. Ein weiterer Antrag ist nicht möglich.',
      bann,
      moderationsEintrag,
    };
  }

  // --- Sperrfrist nach einer Ablehnung (§31) ------------------------------
  if (letzteAblehnung?.nextEligibleAt && letzteAblehnung.nextEligibleAt > jetzt) {
    return {
      erlaubt: false,
      code: 'COOLDOWN',
      grund: 'Du kannst aktuell keinen weiteren Antrag stellen.',
      naechsteMoeglichkeitAm: letzteAblehnung.nextEligibleAt,
      bann,
      moderationsEintrag,
    };
  }

  // --- Wartefrist nach dem Bann -------------------------------------------
  //
  // Nur, wenn SwissHub den Bann gesetzt hat und damit ein Zeitpunkt bekannt
  // ist. Bei einem Bann von ausserhalb gibt es keinen - eine Frist auf ein
  // erfundenes Datum wäre schlechter als keine Frist.
  if (settings.wartefristTage > 0 && moderationsEintrag) {
    const frei = inTagen(moderationsEintrag.createdAt, settings.wartefristTage);
    if (frei > jetzt) {
      return {
        erlaubt: false,
        code: 'WARTEFRIST',
        grund: 'Ein Antrag ist erst nach einer kurzen Frist möglich.',
        naechsteMoeglichkeitAm: frei,
        bann,
        moderationsEintrag,
      };
    }
  }

  return {
    erlaubt: true,
    ...(offenerEntwurf ? { offenerAppealId: offenerEntwurf.id } : {}),
    bann,
    moderationsEintrag,
  };
}

/**
 * Was der Antragsteller von einem Befund zu sehen bekommt.
 *
 * Die eine Stelle, an der aus dem internen Befund die äussere Auskunft wird.
 * Sie ist bewusst schmal: was hier nicht ausdrücklich weitergereicht wird,
 * geht nicht hinaus - und ein neues Feld am Befund landet nicht versehentlich
 * im Browser.
 */
export interface ZulaessigkeitFuerAntragsteller {
  erlaubt: boolean;
  grund?: string;
  naechsteMoeglichkeitAm?: string;
  offenerAppealId?: string;
}

export function fuerAntragsteller(befund: Zulaessigkeit): ZulaessigkeitFuerAntragsteller {
  return {
    erlaubt: befund.erlaubt,
    ...(befund.grund ? { grund: befund.grund } : {}),
    ...(befund.naechsteMoeglichkeitAm
      ? { naechsteMoeglichkeitAm: befund.naechsteMoeglichkeitAm.toISOString() }
      : {}),
    ...(befund.offenerAppealId ? { offenerAppealId: befund.offenerAppealId } : {}),
  };
}

/**
 * Die Momentaufnahme der Sanktion (§8).
 *
 * Eine Kopie und keine Verknüpfung: die Moderationsakte darf sich ändern,
 * ohne dass sich rückwirkend ändert, worüber entschieden wurde.
 *
 * **Nicht alles wird kopiert.** Die interne Notiz des Moderators bleibt in
 * der Akte. In die Momentaufnahme geht, was der Entscheidung zugrunde liegen
 * darf - und der Grund geht getrennt: `reason` steht auch bei Discord und ist
 * damit ohnehin bekannt; was SwissHub intern vermerkt hat, ist es nicht.
 */
export interface BanSnapshot {
  /** `discord` oder `swisshub` - wo der Bann herkommt. */
  quelle: 'discord' | 'swisshub';
  /** Der Grund, wie er bei Discord steht. Der Antragsteller kennt ihn. */
  discordGrund: string | null;
  /** Zeitpunkt aus der Akte. `null` bei einem Bann von ausserhalb. */
  verhaengtAm: string | null;
  moderationActionId: string | null;
  /** Der in der Akte hinterlegte Grund - nur für das Team. */
  internerGrund: string | null;
  /** Wer den Bann gesetzt hat - nur für das Team. */
  moderatorDiscordId: string | null;
  moderatorUsername: string | null;
  /** Wann die Momentaufnahme entstand. */
  erfasstAm: string;
}

export function baueSnapshot(
  bann: { discordId: string; reason: string | null },
  eintrag: ModerationAction | null,
  jetzt = new Date(),
): BanSnapshot {
  return {
    quelle: eintrag ? 'swisshub' : 'discord',
    discordGrund: bann.reason,
    verhaengtAm: eintrag?.createdAt.toISOString() ?? null,
    moderationActionId: eintrag?.id ?? null,
    internerGrund: eintrag?.reason ?? null,
    moderatorDiscordId: eintrag?.actorDiscordId ?? null,
    moderatorUsername: eintrag?.actorUsername ?? null,
    erfasstAm: jetzt.toISOString(),
  };
}

/**
 * Was der Antragsteller von der Momentaufnahme sieht.
 *
 * Der Grund bei Discord und das Datum - mehr nicht. Wer den Bann gesetzt hat
 * und was intern dazu vermerkt wurde, bleibt beim Team (§13, §22).
 */
export function snapshotFuerAntragsteller(snapshot: BanSnapshot): {
  discordGrund: string | null;
  verhaengtAm: string | null;
} {
  return { discordGrund: snapshot.discordGrund, verhaengtAm: snapshot.verhaengtAm };
}
