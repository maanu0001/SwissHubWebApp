import { randomInt } from 'node:crypto';
import { prisma } from '@swisshub/database';
import type { Prisma, Tournament, TournamentStageKind } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { tournamentEvent, type TournamentActor } from './events';
import { reserveMatchNumbers } from './numbering';
import { listAntretende } from './checkin';
import {
  berechneTabelle,
  doubleElimination,
  gruppenphase,
  mische,
  qualifikanten,
  roundRobin,
  singleElimination,
  sortiereTabelle,
  swissPaarung,
  swissRunden,
  type BracketStage,
  type PlannedMatch,
  type SwissBilanz,
  type TabellenZeile,
} from './bracket';

const logger = createLogger('tournaments:bracket');

/** Die Abschnitte, die es je Format gibt. */
const STAGE_NAME: Record<BracketStage, string> = {
  WINNERS: 'Hauptrunde',
  LOSERS: 'Verliererrunde',
  GRAND_FINAL: 'Grosses Finale',
  GROUPS: 'Gruppenphase',
  ROUND_ROBIN: 'Jeder gegen jeden',
  SWISS: 'Schweizer System',
};

const STAGE_KIND: Record<BracketStage, TournamentStageKind> = {
  WINNERS: 'WINNERS',
  LOSERS: 'LOSERS',
  GRAND_FINAL: 'GRAND_FINAL',
  GROUPS: 'GROUPS',
  ROUND_ROBIN: 'ROUND_ROBIN',
  SWISS: 'SWISS',
};

/**
 * Die Setzliste festlegen.
 *
 * Bei zufaelliger Auslosung entsteht sie hier und wird gespeichert - danach
 * steht sie fest. Eine Auslosung, die sich beim naechsten Seitenaufruf anders
 * ergibt, ist keine.
 *
 * Gezogen wird mit `crypto.randomInt`, nicht mit `Math.random`: an einer
 * Turnierauslosung haengen Preise, und ein vorhersagbarer Zufallsgenerator
 * ist bei einem Turnier mit Preisgeld kein theoretisches Problem.
 */
export async function setzeSetzliste(
  tournamentId: string,
  actor: TournamentActor,
  manuell?: string[],
): Promise<Array<{ participantId: string; seed: number }>> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  const antretende = await listAntretende(tournamentId);

  const teilnehmerIds = antretende
    .map((eintrag) => eintrag.participant?.id)
    .filter((id): id is string => Boolean(id));

  if (teilnehmerIds.length < 2) {
    throw new AppError('CONFLICT', {
      userMessage: 'Es treten weniger als zwei Teilnehmer an - dafür lässt sich kein Bracket bauen.',
    });
  }

  let reihenfolge: string[];

  if (manuell && manuell.length > 0) {
    // Die uebergebene Reihenfolge muss genau die Antretenden enthalten -
    // sonst faellt jemand aus dem Turnier, weil eine Kennung fehlt.
    const erwartet = new Set(teilnehmerIds);
    const erhalten = new Set(manuell);
    if (erwartet.size !== erhalten.size || [...erwartet].some((id) => !erhalten.has(id))) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Die Setzliste passt nicht zu den antretenden Teilnehmern.',
      });
    }
    reihenfolge = manuell;
  } else if (tournament.seeding === 'RANDOM') {
    reihenfolge = mische(teilnehmerIds, (grenze) => randomInt(grenze));
  } else if (tournament.seeding === 'RATING') {
    reihenfolge = await nachLevelSortiert(antretende, teilnehmerIds);
  } else {
    // REGISTRATION_ORDER und MANUAL ohne Vorgabe: Reihenfolge der Anmeldung.
    reihenfolge = teilnehmerIds;
  }

  const setzliste = reihenfolge.map((participantId, index) => ({
    participantId,
    seed: index + 1,
  }));

  await prisma.$transaction(
    setzliste.map((eintrag) =>
      prisma.tournamentParticipant.update({
        where: { id: eintrag.participantId },
        data: { seed: eintrag.seed },
      }),
    ),
  );

  await tournamentEvent(tournamentId, 'BRACKET_RESEEDED', actor, {
    verfahren: manuell ? 'MANUAL' : tournament.seeding,
    anzahl: setzliste.length,
  });

  return setzliste;
}

/**
 * Nach Level-Stand sortieren.
 *
 * Bei Teams zaehlt der Durchschnitt der Stammspieler. Fehlt jemandem ein
 * Level-Profil, zaehlt er als 0 - das ist ehrlicher, als ihn wegzulassen und
 * das Team dadurch besser dastehen zu lassen.
 */
async function nachLevelSortiert(
  antretende: Awaited<ReturnType<typeof listAntretende>>,
  teilnehmerIds: string[],
): Promise<string[]> {
  const { levelFromXp } = await import('../level/curve');

  const werte = new Map<string, number>();

  for (const eintrag of antretende) {
    const participantId = eintrag.participant?.id;
    if (!participantId) {
      continue;
    }

    const discordIds = eintrag.team
      ? (
          await prisma.tournamentTeamMember.findMany({
            where: { teamId: eintrag.team.id, removedAt: null, role: { in: ['CAPTAIN', 'PLAYER'] } },
            select: { discordId: true },
          })
        ).map((mitglied) => mitglied.discordId)
      : [eintrag.discordId];

    if (discordIds.length === 0) {
      werte.set(participantId, 0);
      continue;
    }

    const profile = await prisma.levelProfile.findMany({
      where: { discordId: { in: discordIds } },
      select: { discordId: true, xp: true },
    });
    const nachId = new Map(profile.map((eintragProfil) => [eintragProfil.discordId, eintragProfil.xp]));
    const summe = discordIds.reduce(
      (bisher, discordId) => bisher + levelFromXp(nachId.get(discordId) ?? 0),
      0,
    );
    werte.set(participantId, summe / discordIds.length);
  }

  return [...teilnehmerIds].sort((a, b) => (werte.get(b) ?? 0) - (werte.get(a) ?? 0));
}

/**
 * Das Bracket erzeugen.
 *
 * Alles in einer Transaktion: Abschnitte, Gruppen, Matches und die Verweise
 * zwischen ihnen. Ein halb erzeugtes Bracket waere schlimmer als keines - es
 * saehe vollstaendig aus, und der Fehler faellt erst beim dritten Match auf.
 */
export async function generateBracket(
  tournamentId: string,
  actor: TournamentActor,
  optionen: { setzliste?: string[] } = {},
): Promise<{ matches: number; stages: number }> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  const vorhanden = await prisma.tournamentMatch.count({ where: { tournamentId } });
  if (vorhanden > 0) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Für dieses Turnier gibt es bereits ein Bracket. Es muss erst verworfen werden.',
    });
  }

  const setzliste = await setzeSetzliste(tournamentId, actor, optionen.setzliste);
  const reihenfolge = setzliste.map((eintrag) => eintrag.participantId);

  const geplant = planeMatches(tournament, reihenfolge);
  if (geplant.matches.length === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Aus den Antretenden lässt sich kein Bracket bauen.',
    });
  }

  const ergebnis = await speichereMatches(tournamentId, tournament, geplant);

  await tournamentEvent(tournamentId, 'BRACKET_GENERATED', actor, {
    format: tournament.format,
    matches: ergebnis.matches,
    teilnehmer: reihenfolge.length,
  });
  logger.info('Bracket erzeugt', { tournamentId, ...ergebnis });

  return ergebnis;
}

interface GeplantesBracket {
  matches: PlannedMatch[];
  /** Nur bei Gruppen: die Zusammensetzung. */
  gruppen?: string[][];
}

/** Welche Matches ein Format aus dieser Setzliste ergibt. */
export function planeMatches(
  tournament: Pick<Tournament, 'format' | 'groupCount' | 'swissRounds'>,
  reihenfolge: string[],
): GeplantesBracket {
  switch (tournament.format) {
    case 'SINGLE_ELIMINATION':
      return { matches: singleElimination(reihenfolge) };

    case 'DOUBLE_ELIMINATION':
      return { matches: doubleElimination(reihenfolge) };

    case 'ROUND_ROBIN':
      return { matches: roundRobin(reihenfolge, { stage: 'ROUND_ROBIN' }) };

    case 'SWISS': {
      // Nur die erste Runde: wer gegen wen spielt, haengt am Stand nach der
      // vorherigen - im Voraus laesst sich das nicht planen.
      const bilanzen: SwissBilanz[] = reihenfolge.map((participantId) => ({
        participantId,
        punkte: 0,
        gegner: [],
        hatteFreilos: false,
      }));
      return { matches: swissPaarung(bilanzen, 1) };
    }

    case 'GROUPS_THEN_ELIMINATION': {
      const gruppen = Math.max(1, tournament.groupCount);
      const { gruppen: verteilt, matches } = gruppenphase(reihenfolge, gruppen);
      return { matches, gruppen: verteilt };
    }

    default:
      return { matches: [] };
  }
}

/** Abschnitte, Gruppen und Matches anlegen - in einem Zug. */
async function speichereMatches(
  tournamentId: string,
  tournament: Tournament,
  geplant: GeplantesBracket,
): Promise<{ matches: number; stages: number }> {
  const abschnitte = [...new Set(geplant.matches.map((match) => match.stage))];
  const nummern = await reserveMatchNumbers(tournamentId, geplant.matches.length);

  return prisma.$transaction(async (tx) => {
    // --- Abschnitte ----------------------------------------------------
    const stageIds = new Map<BracketStage, string>();
    for (const [index, stage] of abschnitte.entries()) {
      const runden = Math.max(
        ...geplant.matches.filter((match) => match.stage === stage).map((match) => match.round),
      );
      const eintrag = await tx.tournamentStage.create({
        data: {
          tournamentId,
          kind: STAGE_KIND[stage],
          name: STAGE_NAME[stage],
          sortOrder: index,
          roundCount: runden,
        },
      });
      stageIds.set(stage, eintrag.id);
    }

    // --- Gruppen -------------------------------------------------------
    const gruppenIds = new Map<number, string>();
    if (geplant.gruppen) {
      const stageId = stageIds.get('GROUPS')!;
      for (const [index, mitglieder] of geplant.gruppen.entries()) {
        const gruppe = await tx.tournamentGroup.create({
          data: {
            tournamentId,
            stageId,
            name: `Gruppe ${String.fromCharCode(65 + index)}`,
            sortOrder: index,
          },
        });
        gruppenIds.set(index, gruppe.id);

        await tx.tournamentGroupMember.createMany({
          data: mitglieder.map((participantId, platz) => ({
            groupId: gruppe.id,
            participantId,
            sortOrder: platz,
          })),
        });
      }
    }

    // --- Matches -------------------------------------------------------
    // Zuerst alle anlegen, dann die Verweise setzen: ein Verweis auf ein
    // Match, das es noch nicht gibt, laesst sich nicht speichern.
    const nachPlatz = new Map<string, string>();
    const platz = (stage: BracketStage, round: number, position: number): string =>
      `${stage}:${round}:${position}`;

    for (const [index, match] of geplant.matches.entries()) {
      const angelegt = await tx.tournamentMatch.create({
        data: {
          tournamentId,
          stageId: stageIds.get(match.stage)!,
          groupId:
            match.groupIndex !== undefined ? (gruppenIds.get(match.groupIndex) ?? null) : null,
          matchNumber: nummern[index]!,
          round: match.round,
          position: match.position,
          participantAId: match.a,
          participantBId: match.b,
          bestOf: tournament.defaultBestOf,
          // Ein Match, dessen beide Seiten feststehen, kann gespielt werden.
          status: match.a !== null && match.b !== null ? 'READY' : 'PENDING',
        },
      });
      nachPlatz.set(platz(match.stage, match.round, match.position), angelegt.id);
    }

    for (const match of geplant.matches) {
      const eigeneId = nachPlatz.get(platz(match.stage, match.round, match.position))!;
      const winnerToId = match.winnerTo
        ? nachPlatz.get(platz(match.winnerTo.stage, match.winnerTo.round, match.winnerTo.position))
        : undefined;
      const loserToId = match.loserTo
        ? nachPlatz.get(platz(match.loserTo.stage, match.loserTo.round, match.loserTo.position))
        : undefined;

      if (!winnerToId && !loserToId) {
        continue;
      }

      await tx.tournamentMatch.update({
        where: { id: eigeneId },
        data: {
          winnerToMatchId: winnerToId ?? null,
          winnerToSlot: winnerToId ? (match.winnerTo?.slot ?? null) : null,
          loserToMatchId: loserToId ?? null,
          loserToSlot: loserToId ? (match.loserTo?.slot ?? null) : null,
        },
      });
    }

    return { matches: geplant.matches.length, stages: abschnitte.length };
  });
}

/**
 * Das Bracket verwerfen.
 *
 * Nur, solange kein Resultat feststeht. Ein Bracket wegzuwerfen, in dem schon
 * gespielt wurde, loescht Resultate - und die gehoeren niemandem, der auf
 * einen Knopf drueckt.
 */
export async function discardBracket(
  tournamentId: string,
  actor: TournamentActor,
): Promise<void> {
  const gespielt = await prisma.tournamentMatch.count({
    where: { tournamentId, status: { in: ['COMPLETED', 'FORFEIT', 'DISPUTED'] } },
  });
  if (gespielt > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `Es gibt bereits ${gespielt} abgeschlossene Matches. Das Bracket lässt sich nicht mehr verwerfen.`,
    });
  }

  await prisma.$transaction([
    prisma.tournamentMatch.deleteMany({ where: { tournamentId } }),
    prisma.tournamentGroup.deleteMany({ where: { tournamentId } }),
    prisma.tournamentStage.deleteMany({ where: { tournamentId } }),
    prisma.tournamentMatchCounter.deleteMany({ where: { tournamentId } }),
    prisma.tournamentParticipant.updateMany({
      where: { tournamentId },
      data: { seed: null, eliminatedAt: null, placement: null },
    }),
  ]);

  await tournamentEvent(tournamentId, 'BRACKET_RESEEDED', actor, { verworfen: true });
}

// --- Tabellen --------------------------------------------------------------

export interface GruppenTabelle {
  groupId: string;
  name: string;
  zeilen: Array<TabellenZeile & { participant: { id: string; label: string } }>;
}

/**
 * Die Tabellen der Gruppenphase.
 *
 * Wird aus den abgeschlossenen Matches gerechnet und nicht mitgefuehrt: eine
 * gespeicherte Tabelle geht auseinander, sobald die Leitung ein Resultat
 * korrigiert.
 */
export async function getGruppenTabellen(tournamentId: string): Promise<GruppenTabelle[]> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  const gruppen = await prisma.tournamentGroup.findMany({
    where: { tournamentId },
    orderBy: { sortOrder: 'asc' },
    include: {
      members: {
        include: {
          participant: {
            select: { id: true, username: true, team: { select: { name: true, tag: true } } },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      matches: {
        where: { status: { in: ['COMPLETED', 'FORFEIT'] } },
        select: { participantAId: true, participantBId: true, scoreA: true, scoreB: true, winnerId: true },
      },
    },
  });

  return gruppen.map((gruppe) => {
    const teilnehmer = gruppe.members.map((mitglied) => mitglied.participantId);
    const bezeichnung = new Map(
      gruppe.members.map((mitglied) => [
        mitglied.participantId,
        mitglied.participant.team?.name ?? mitglied.participant.username ?? 'Unbekannt',
      ]),
    );

    const tabelle = berechneTabelle(
      teilnehmer,
      gruppe.matches.map((match) => ({
        aId: match.participantAId,
        bId: match.participantBId,
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        winnerId: match.winnerId,
      })),
      {
        win: tournament.pointsPerWin,
        draw: tournament.pointsPerDraw,
        loss: tournament.pointsPerLoss,
      },
    );

    return {
      groupId: gruppe.id,
      name: gruppe.name,
      zeilen: sortiereTabelle(tabelle, tournament.tiebreakers).map((zeile) => ({
        ...zeile,
        participant: {
          id: zeile.participantId,
          label: bezeichnung.get(zeile.participantId) ?? 'Unbekannt',
        },
      })),
    };
  });
}

/**
 * Aus den Gruppen ins K.-o.-System.
 *
 * Erst wenn jede Gruppe fertig gespielt ist. Ein Bracket aus einer halben
 * Tabelle waere eine Behauptung.
 */
export async function generateKnockoutFromGroups(
  tournamentId: string,
  actor: TournamentActor,
): Promise<{ matches: number }> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  if (tournament.format !== 'GROUPS_THEN_ELIMINATION') {
    throw new AppError('CONFLICT', { userMessage: 'Dieses Turnier hat keine Gruppenphase.' });
  }

  const offen = await prisma.tournamentMatch.count({
    where: {
      tournamentId,
      stage: { kind: 'GROUPS' },
      status: { notIn: ['COMPLETED', 'FORFEIT', 'CANCELLED'] },
    },
  });
  if (offen > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `In der Gruppenphase sind noch ${offen} Matches offen.`,
    });
  }

  const schonDa = await prisma.tournamentStage.count({
    where: { tournamentId, kind: { in: ['WINNERS', 'LOSERS', 'GRAND_FINAL'] } },
  });
  if (schonDa > 0) {
    throw new AppError('CONFLICT', { userMessage: 'Die Endrunde steht bereits.' });
  }

  const tabellen = await getGruppenTabellen(tournamentId);
  const weiter = qualifikanten(
    tabellen.map((tabelle) => tabelle.zeilen),
    tournament.advancePerGroup,
  );

  if (weiter.length < 2) {
    throw new AppError('CONFLICT', {
      userMessage: 'Aus den Gruppen kommen weniger als zwei Teilnehmer weiter.',
    });
  }

  // Ausgeschieden ist, wer nicht weiterkommt - so zeigt die Turnierseite den
  // Stand richtig an, ohne dass jemand es von Hand nachtraegt.
  const alle = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { id: true },
  });
  const weiterSet = new Set(weiter);
  await prisma.tournamentParticipant.updateMany({
    where: { id: { in: alle.filter((eintrag) => !weiterSet.has(eintrag.id)).map((e) => e.id) } },
    data: { eliminatedAt: new Date() },
  });

  // Die Setzplaetze der Endrunde folgen der Qualifikationsreihenfolge.
  await prisma.$transaction(
    weiter.map((participantId, index) =>
      prisma.tournamentParticipant.update({
        where: { id: participantId },
        data: { seed: index + 1 },
      }),
    ),
  );

  const geplant = { matches: singleElimination(weiter) };
  const ergebnis = await speichereMatches(tournamentId, tournament, geplant);

  await tournamentEvent(tournamentId, 'BRACKET_GENERATED', actor, {
    abschnitt: 'Endrunde',
    matches: ergebnis.matches,
    qualifiziert: weiter.length,
  });

  return { matches: ergebnis.matches };
}

/**
 * Die naechste Schweizer Runde auslosen.
 *
 * Geht erst, wenn die laufende fertig ist - sonst stuende der Stand, nach dem
 * gepaart wird, noch gar nicht fest.
 */
export async function generateNextSwissRound(
  tournamentId: string,
  actor: TournamentActor,
): Promise<{ matches: number; runde: number } | null> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (tournament.format !== 'SWISS') {
    throw new AppError('CONFLICT', { userMessage: 'Dieses Turnier läuft nicht im Schweizer System.' });
  }

  const stage = await prisma.tournamentStage.findFirst({
    where: { tournamentId, kind: 'SWISS' },
  });
  if (!stage) {
    throw new AppError('CONFLICT', { userMessage: 'Es gibt noch kein Bracket.' });
  }

  const offen = await prisma.tournamentMatch.count({
    where: { tournamentId, status: { notIn: ['COMPLETED', 'FORFEIT', 'CANCELLED'] } },
  });
  if (offen > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `Es sind noch ${offen} Matches der laufenden Runde offen.`,
    });
  }

  const gespielteRunden = stage.roundCount;
  const teilnehmer = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { id: true },
  });

  const gewuenscht =
    tournament.swissRounds > 0 ? tournament.swissRounds : swissRunden(teilnehmer.length);
  if (gespielteRunden >= gewuenscht) {
    return null;
  }

  const matches = await prisma.tournamentMatch.findMany({
    where: { tournamentId, status: { in: ['COMPLETED', 'FORFEIT'] } },
    select: { participantAId: true, participantBId: true, scoreA: true, scoreB: true, winnerId: true },
  });

  const tabelle = berechneTabelle(
    teilnehmer.map((eintrag) => eintrag.id),
    matches.map((match) => ({
      aId: match.participantAId,
      bId: match.participantBId,
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      winnerId: match.winnerId,
    })),
    { win: tournament.pointsPerWin, draw: tournament.pointsPerDraw, loss: tournament.pointsPerLoss },
  );

  const bilanzen: SwissBilanz[] = tabelle.map((zeile) => ({
    participantId: zeile.participantId,
    punkte: zeile.punkte,
    gegner: matches
      .filter(
        (match) =>
          match.participantAId === zeile.participantId || match.participantBId === zeile.participantId,
      )
      .map((match) =>
        match.participantAId === zeile.participantId ? match.participantBId : match.participantAId,
      )
      .filter((id): id is string => id !== null),
    // Wer weniger Matches gespielt hat als Runden vorbei sind, hatte ein
    // Freilos.
    hatteFreilos: zeile.gespielt < gespielteRunden,
  }));

  const runde = gespielteRunden + 1;
  const geplant = swissPaarung(bilanzen, runde);
  if (geplant.length === 0) {
    return null;
  }

  const nummern = await reserveMatchNumbers(tournamentId, geplant.length);

  await prisma.$transaction(async (tx) => {
    for (const [index, match] of geplant.entries()) {
      await tx.tournamentMatch.create({
        data: {
          tournamentId,
          stageId: stage.id,
          matchNumber: nummern[index]!,
          round: match.round,
          position: match.position,
          participantAId: match.a,
          participantBId: match.b,
          bestOf: tournament.defaultBestOf,
          status: 'READY',
        },
      });
    }
    await tx.tournamentStage.update({ where: { id: stage.id }, data: { roundCount: runde } });
  });

  await tournamentEvent(tournamentId, 'ROUND_STARTED', actor, { runde, matches: geplant.length });
  return { matches: geplant.length, runde };
}

/**
 * Das Bracket mit allem, was die Darstellung braucht.
 *
 * Eine Abfrage statt einer je Runde: die Turnierseite zeigt alles auf einmal,
 * und ein Bracket mit sechzig Matches waere sonst sechzig Abfragen.
 */
export async function getBracket(tournamentId: string) {
  return prisma.tournamentStage.findMany({
    where: { tournamentId },
    orderBy: { sortOrder: 'asc' },
    include: {
      groups: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } },
      matches: {
        orderBy: [{ round: 'asc' }, { position: 'asc' }],
        include: {
          participantA: {
            select: {
              id: true,
              username: true,
              seed: true,
              team: { select: { id: true, name: true, tag: true, logoUrl: true } },
            },
          },
          participantB: {
            select: {
              id: true,
              username: true,
              seed: true,
              team: { select: { id: true, name: true, tag: true, logoUrl: true } },
            },
          },
          games: { orderBy: { index: 'asc' } },
        },
      },
    },
  });
}

/** Ein Teilnehmer, so wie ihn die Oberflaeche nennt. */
export function teilnehmerLabel(
  teilnehmer:
    | { username: string | null; team: { name: string; tag: string | null } | null }
    | null
    | undefined,
): string | null {
  if (!teilnehmer) {
    return null;
  }
  if (teilnehmer.team) {
    return teilnehmer.team.tag ? `${teilnehmer.team.name}` : teilnehmer.team.name;
  }
  return teilnehmer.username;
}

/** Prisma-Client oder Transaktion - fuer Hilfsfunktionen, die beides koennen. */
export type DbClient = Prisma.TransactionClient | typeof prisma;
