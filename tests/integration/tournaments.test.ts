import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_tournaments');

/**
 * Das Turniersystem gegen eine echte Datenbank.
 *
 * Geprueft wird, was sich nur hier pruefen laesst: dass zwei gleichzeitige
 * Anmeldungen auf den letzten Platz nicht beide gelingen, dass ein Resultat
 * erst zaehlt, wenn beide Seiten dasselbe melden, dass ein Sieger genau
 * einmal weiterkommt - und dass ein Gastorganisator die Turniere anderer
 * weder sieht noch anfasst.
 */
const { prisma } = await import('@swisshub/database');
const { tournaments, setModuleEnabled, syncDiscord, writeModuleSettings } = await import(
  '@swisshub/modules'
);

let GUILD = '';
const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const LEITUNGS_ROLLE = '900000000000000004'; // @Supporter im Mock
const KATEGORIE = '700000000000000010'; // Kategorie "Moderation" im Mock

const actor = (discordId: string, username: string) =>
  ({ discordId, username, source: 'WEBAPP' as const });

const viewer = (discordId: string, roleIds: string[], rechte: string[]) => ({
  discordId,
  roleIds,
  can: (permission: string) => rechte.includes(permission),
});

const P = () => tournaments.TOURNAMENT_PERMISSIONS;

/**
 * Alle Rechte ausser `admin`.
 *
 * `admin` hebt Zustaendigkeit und Rolle im Turnier auf - genau das, was diese
 * Tests pruefen wollen. Wer es haette, saehe alles, und der Test bewiese
 * nichts.
 */
const ALLE = () => Object.values(P()).filter((recht) => recht !== P().admin);

async function turnier(
  optionen: Partial<Parameters<typeof tournaments.createTournament>[0]> = {},
) {
  return tournaments.createTournament(
    {
      name: 'Testturnier',
      gameName: 'Valorant',
      mode: 'SOLO',
      access: 'OPEN',
      format: 'SINGLE_ELIMINATION',
      seeding: 'REGISTRATION_ORDER',
      checkinRequired: false,
      // Ohne Startzeitpunkt laesst der Startcheck nicht veroeffentlichen -
      // zu Recht, aber hier ist die Zeit nie der Gegenstand.
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...optionen,
    },
    actor(ADMIN.discordId, ADMIN.username),
  );
}

/** Die offene Einladung an diese Person - `inviteToTeam` liefert keine zurueck. */
async function einladungVon(discordId: string): Promise<string> {
  const einladung = await prisma.tournamentTeamInvite.findFirstOrThrow({
    where: { discordId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  return einladung.id;
}

/** Jemanden anmelden - der kuerzeste Weg zu einem Teilnehmer. */
async function melde(tournamentId: string, discordId: string, username: string) {
  return tournaments.register(
    { tournamentId, discordId, username, rulesVersion: 1 },
    actor(discordId, username),
  );
}

describeWithDatabase('Turniere', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "TournamentMatchCaster","TournamentMatchGame","TournamentResultSubmission",' +
        '"TournamentDispute","TournamentMatch","TournamentGroup","TournamentStage",' +
        '"TournamentCustomFieldResponse","TournamentCustomField","TournamentTeamInvite",' +
        '"TournamentTeamMember","TournamentRegistration","TournamentParticipant",' +
        '"TournamentTeam","TournamentPrize","TournamentAnnouncement","TournamentResource",' +
        '"TournamentEvent","TournamentStaff","TournamentBlockEntry","TournamentMatchCounter",' +
        '"Tournament","ModuleState" RESTART IDENTITY CASCADE',
    );
    await syncDiscord({ trigger: 'manual' });
    const { resolveGuildId, clearGuildIdCache } = await import('@swisshub/discord');
    clearGuildIdCache();
    GUILD = await resolveGuildId();
    await setModuleEnabled(tournaments.TOURNAMENTS_MODULE_ID, true, ADMIN.discordId);
    await writeModuleSettings(
      tournaments.TOURNAMENTS_MODULE_ID,
      {
        defaultAnnouncementChannelId: null,
        defaultMatchCategoryId: KATEGORIE,
        defaultStaffCategoryId: null,
        defaultStreamChannelId: null,
        defaultStaffRoleIds: [LEITUNGS_ROLLE],
        defaultPingRoleIds: [],
        createMatchChannels: false,
        maintenanceMode: false,
      },
      ADMIN,
    );
  });

  // --- Anlegen und Kennung ---------------------------------------------

  it('legt ein Turnier als Entwurf an und vergibt eine freie Kennung', async () => {
    const eins = await turnier({ name: 'Schweizer Cup' });
    const zwei = await turnier({ name: 'Schweizer Cup' });

    expect(eins.status).toBe('DRAFT');
    expect(eins.slug).toBe('schweizer-cup');
    expect(zwei.slug).toBe('schweizer-cup-2');
    expect(eins.guildId).toBe(GUILD);
  });

  it('vergibt keine Kennung, die die Verwaltung belegt', async () => {
    // `/turniere/matches` gehoert der Matchliste. Ein Turnier mit dieser
    // Kennung waere unter seiner eigenen Adresse nicht erreichbar.
    const t = await turnier({ name: 'Matches' });
    expect(t.slug).not.toBe('matches');
  });

  // --- Anmeldung und Warteliste ----------------------------------------

  it('setzt auf die Warteliste, sobald die Obergrenze erreicht ist', async () => {
    const t = await turnier({ maxParticipants: 2 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const a = await melde(t.id, '900000000000002001', 'anna');
    const b = await melde(t.id, '900000000000002002', 'beat');
    const c = await melde(t.id, '900000000000002003', 'carla');

    expect(a.status).toBe('CONFIRMED');
    expect(b.status).toBe('CONFIRMED');
    expect(c.status).toBe('WAITLISTED');
    expect(c.waitlistPosition).toBe(1);
  });

  it('vergibt den letzten Platz auch bei gleichzeitigen Anmeldungen nur einmal', async () => {
    const t = await turnier({ maxParticipants: 1 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    // Ohne die Zeilensperre in `register` bekaemen beide den Platz: sie
    // zaehlen die Bestaetigten, bevor die jeweils andere geschrieben hat.
    const [a, b] = await Promise.all([
      melde(t.id, '900000000000002011', 'anna'),
      melde(t.id, '900000000000002012', 'beat'),
    ]);

    const status = [a.status, b.status].sort();
    expect(status).toEqual(['CONFIRMED', 'WAITLISTED']);
  });

  it('lässt niemanden zweimal anmelden', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    await melde(t.id, '900000000000002021', 'anna');

    await expect(melde(t.id, '900000000000002021', 'anna')).rejects.toThrow();
  });

  it('rückt beim Rückzug jemanden von der Warteliste nach', async () => {
    const t = await turnier({ maxParticipants: 1 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const a = await melde(t.id, '900000000000002031', 'anna');
    await melde(t.id, '900000000000002032', 'beat');

    await tournaments.withdrawRegistration(a.id, actor('900000000000002031', 'anna'));

    const beat = await prisma.tournamentRegistration.findFirstOrThrow({
      where: { tournamentId: t.id, discordId: '900000000000002032' },
    });
    expect(beat.status).toBe('CONFIRMED');
    expect(beat.waitlistPosition).toBeNull();
  });

  it('hält eine Turniersperre von der Anmeldung fern', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    await tournaments.blockMember(
      {
        discordId: '900000000000002041',
        username: 'anna',
        reason: 'Wiederholt nicht angetreten.',
        expiresAt: null,
      },
      actor(ADMIN.discordId, ADMIN.username),
    );

    const eignung = await tournaments.checkEligibility(t, '900000000000002041');
    expect(eignung.eligible).toBe(false);
    // Der Grund bleibt aussen vor: er steht im Protokoll, nicht auf einer
    // oeffentlichen Seite.
    expect(eignung.reasons.join(' ')).not.toContain('nicht angetreten');
  });

  // --- Teams -------------------------------------------------------------

  it('nimmt eine Teamanmeldung erst mit genügend Spielern an', async () => {
    const t = await turnier({ mode: 'TEAM', minTeamSize: 2, maxTeamSize: 3 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const team = await tournaments.createTeam(
      {
        tournamentId: t.id,
        name: 'Edelweiss',
        captainDiscordId: '900000000000003001',
        captainUsername: 'anna',
      },
      actor('900000000000003001', 'anna'),
    );

    await expect(
      tournaments.register(
        {
          tournamentId: t.id,
          discordId: '900000000000003001',
          username: 'anna',
          teamId: team.id,
          rulesVersion: 1,
        },
        actor('900000000000003001', 'anna'),
      ),
    ).rejects.toThrow();

    await tournaments.inviteToTeam(
      {
        teamId: team.id,
        discordId: '900000000000003002',
        username: 'beat',
        role: 'PLAYER',
      },
      actor('900000000000003001', 'anna'),
    );
    await tournaments.acceptInvite(
      await einladungVon('900000000000003002'),
      '900000000000003002',
      actor('900000000000003002', 'beat'),
    );

    const anmeldung = await tournaments.register(
      {
        tournamentId: t.id,
        discordId: '900000000000003001',
        username: 'anna',
        teamId: team.id,
        rulesVersion: 1,
      },
      actor('900000000000003001', 'anna'),
    );
    expect(anmeldung.status).toBe('CONFIRMED');
  });

  it('lässt niemanden in zwei Teams desselben Turniers spielen', async () => {
    const t = await turnier({ mode: 'TEAM', minTeamSize: 1, maxTeamSize: 3 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const eins = await tournaments.createTeam(
      {
        tournamentId: t.id,
        name: 'Edelweiss',
        captainDiscordId: '900000000000003011',
        captainUsername: 'anna',
      },
      actor('900000000000003011', 'anna'),
    );
    const zwei = await tournaments.createTeam(
      {
        tournamentId: t.id,
        name: 'Enzian',
        captainDiscordId: '900000000000003012',
        captainUsername: 'beat',
      },
      actor('900000000000003012', 'beat'),
    );

    await tournaments.inviteToTeam(
      { teamId: eins.id, discordId: '900000000000003013', username: 'carla', role: 'PLAYER' },
      actor('900000000000003011', 'anna'),
    );
    await tournaments.acceptInvite(
      await einladungVon('900000000000003013'),
      '900000000000003013',
      actor('900000000000003013', 'carla'),
    );

    // Abgewiesen wird schon die Einladung - besser, als erst beim Annehmen:
    // sonst stuende eine Einladung im Postfach, die nie funktioniert haette.
    await expect(
      tournaments.inviteToTeam(
        { teamId: zwei.id, discordId: '900000000000003013', username: 'carla', role: 'PLAYER' },
        actor('900000000000003012', 'beat'),
      ),
    ).rejects.toThrow();
  });

  // --- Check-in ----------------------------------------------------------

  it('lässt nur Eingecheckte antreten, wenn Check-in verlangt ist', async () => {
    const t = await turnier({ checkinRequired: true });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    await melde(t.id, '900000000000004001', 'anna');
    await melde(t.id, '900000000000004002', 'beat');
    await tournaments.setTournamentStatus(
      t.id,
      'REGISTRATION_CLOSED',
      actor(ADMIN.discordId, ADMIN.username),
    );
    await tournaments.setTournamentStatus(
      t.id,
      'CHECKIN_OPEN',
      actor(ADMIN.discordId, ADMIN.username),
    );

    await tournaments.checkIn(t.id, '900000000000004001', actor('900000000000004001', 'anna'));

    const antretende = await tournaments.listAntretende(t.id);
    expect(antretende.map((eintrag) => eintrag.username)).toEqual(['anna']);
  });

  // --- Bracket -----------------------------------------------------------

  it('erzeugt ein Bracket und lässt den Sieger genau einmal weiterkommen', async () => {
    const t = await turnier({ maxParticipants: 0 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    for (const [index, name] of ['anna', 'beat', 'carla', 'david'].entries()) {
      await melde(t.id, `90000000000000501${index}`, name);
    }

    const ergebnis = await tournaments.generateBracket(
      t.id,
      actor(ADMIN.discordId, ADMIN.username),
    );
    expect(ergebnis.matches).toBe(3);

    const bracket = await tournaments.getBracket(t.id);
    const matches = bracket.flatMap((abschnitt) => abschnitt.matches);
    const erstrunde = matches.filter((match) => match.round === 1);
    const finale = matches.find((match) => match.round === 2);

    expect(erstrunde).toHaveLength(2);
    expect(finale?.participantA).toBeNull();
    expect(finale?.participantB).toBeNull();

    // Beide Seiten melden dasselbe - erst dann zaehlt es.
    const match = erstrunde[0]!;
    await tournaments.reportResult(
      {
        matchId: match.id,
        slot: 'A',
        reportedByDiscordId: match.participantA!.username === null ? '' : 'x',
        reportedByUsername: 'x',
        scoreA: 1,
        scoreB: 0,
        games: [],
        comment: null,
        evidenceUrl: null,
      },
      actor(ADMIN.discordId, ADMIN.username),
    );

    const zwischenstand = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: match.id },
    });
    expect(zwischenstand.status).toBe('AWAITING_RESULT');
    expect(zwischenstand.winnerId).toBeNull();

    await tournaments.reportResult(
      {
        matchId: match.id,
        slot: 'B',
        reportedByDiscordId: 'y',
        reportedByUsername: 'y',
        scoreA: 1,
        scoreB: 0,
        games: [],
        comment: null,
        evidenceUrl: null,
      },
      actor(ADMIN.discordId, ADMIN.username),
    );

    const entschieden = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: match.id },
    });
    expect(entschieden.status).toBe('COMPLETED');
    expect(entschieden.winnerId).toBe(match.participantA!.id);

    const finaleDanach = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: finale!.id },
    });
    const weitergekommen =
      finaleDanach.participantAId === match.participantA!.id ||
      finaleDanach.participantBId === match.participantA!.id;
    expect(weitergekommen).toBe(true);
  });

  it('macht aus zwei verschiedenen Meldungen einen Einspruch', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    await melde(t.id, '900000000000005101', 'anna');
    await melde(t.id, '900000000000005102', 'beat');
    await tournaments.generateBracket(t.id, actor(ADMIN.discordId, ADMIN.username));

    const match = (await tournaments.listMatches({ tournamentId: t.id }))[0]!;

    await tournaments.reportResult(
      {
        matchId: match.id,
        slot: 'A',
        reportedByDiscordId: '900000000000005101',
        reportedByUsername: 'anna',
        scoreA: 1,
        scoreB: 0,
        games: [],
        comment: null,
        evidenceUrl: null,
      },
      actor('900000000000005101', 'anna'),
    );
    const ergebnis = await tournaments.reportResult(
      {
        matchId: match.id,
        slot: 'B',
        reportedByDiscordId: '900000000000005102',
        reportedByUsername: 'beat',
        scoreA: 0,
        scoreB: 1,
        games: [],
        comment: null,
        evidenceUrl: null,
      },
      actor('900000000000005102', 'beat'),
    );

    expect(ergebnis.strittig).toBe(true);
    const danach = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(danach.status).toBe('DISPUTED');
    expect(danach.winnerId).toBeNull();

    const einsprueche = await tournaments.listDisputes({ tournamentId: t.id, offen: true });
    expect(einsprueche).toHaveLength(1);
  });

  it('nimmt beim Korrigieren das Weiterkommen zurück', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    for (const [index, name] of ['anna', 'beat', 'carla', 'david'].entries()) {
      await melde(t.id, `90000000000000520${index}`, name);
    }
    await tournaments.generateBracket(t.id, actor(ADMIN.discordId, ADMIN.username));

    const matches = await tournaments.listMatches({ tournamentId: t.id });
    const match = matches.find((eintrag) => eintrag.round === 1)!;

    await tournaments.overrideResult(
      match.id,
      { scoreA: 2, scoreB: 0, reason: 'ADMIN_DECISION' },
      'Gegner nicht angetreten.',
      actor(ADMIN.discordId, ADMIN.username),
    );
    const nachher = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(nachher.winnerId).toBe(match.participantA!.id);

    // Umgekehrt entscheiden: der vorher Weitergekommene darf im Folgematch
    // nicht mehr stehen, sonst stehen dort beide.
    await tournaments.overrideResult(
      match.id,
      { scoreA: 0, scoreB: 2, reason: 'ADMIN_DECISION' },
      'Korrektur nach Einspruch.',
      actor(ADMIN.discordId, ADMIN.username),
    );

    const finale = await prisma.tournamentMatch.findFirstOrThrow({
      where: { tournamentId: t.id, round: 2 },
    });
    const drin = [finale.participantAId, finale.participantBId];
    expect(drin).toContain(match.participantB!.id);
    expect(drin).not.toContain(match.participantA!.id);
  });

  // --- Zugriff -----------------------------------------------------------

  it('zeigt einem Gastorganisator nur seine eigenen Turniere', async () => {
    const fremd = await turnier({ name: 'Fremdes Turnier' });
    const eigen = await tournaments.createTournament(
      {
        name: 'Eigenes Turnier',
        gameName: 'Valorant',
        mode: 'SOLO',
        access: 'OPEN',
        format: 'SINGLE_ELIMINATION',
        seeding: 'RANDOM',
      },
      actor('900000000000006001', 'gast'),
    );

    const gast = viewer('900000000000006001', [], [P().view, P().create, P().manage]);
    const { rows } = await tournaments.listTournaments(gast, { page: 1, pageSize: 20 });

    expect(rows.map((zeile) => zeile.tournament.id)).toEqual([eigen.id]);
    expect(rows.map((zeile) => zeile.tournament.id)).not.toContain(fremd.id);
  });

  it('gibt einem Gastorganisator keinen Zugriff auf ein fremdes Turnier', async () => {
    const fremd = await turnier();
    const gast = viewer('900000000000006011', [], ALLE());

    const zugriff = await tournaments.getTournamentAccess(gast, fremd);
    expect(zugriff.view).toBe(false);
    expect(zugriff.manage).toBe(false);
  });

  it('begrenzt einen Schiedsrichter auf seine Aufgaben', async () => {
    const t = await turnier();
    await tournaments.setStaff(
      t.id,
      [
        { discordId: ADMIN.discordId, username: ADMIN.username, role: 'OWNER' },
        { discordId: '900000000000006021', username: 'referee', role: 'REFEREE' },
      ],
      actor(ADMIN.discordId, ADMIN.username),
    );

    // Alle zentralen Rechte - was er nicht darf, entscheidet allein die Rolle
    // im Turnier.
    const referee = viewer('900000000000006021', [], ALLE());
    const zugriff = await tournaments.getTournamentAccess(referee, t);

    expect(zugriff.view).toBe(true);
    expect(zugriff.matchesManage).toBe(true);
    expect(zugriff.disputesManage).toBe(true);
    expect(zugriff.manage).toBe(false);
    expect(zugriff.publish).toBe(false);
    expect(zugriff.staffManage).toBe(false);
  });

  it('gibt die Rolle im Turnier kein Recht, das zentral fehlt', async () => {
    const t = await turnier();
    await tournaments.setStaff(
      t.id,
      [{ discordId: '900000000000006031', username: 'owner2', role: 'OWNER' }],
      actor(ADMIN.discordId, ADMIN.username),
    );

    // Turnierleitung im Turnier, aber ohne die zentrale Berechtigung zum
    // Veroeffentlichen.
    const ohne = viewer('900000000000006031', [], [P().view, P().manage]);
    const zugriff = await tournaments.getTournamentAccess(ohne, t);

    expect(zugriff.view).toBe(true);
    expect(zugriff.manage).toBe(true);
    expect(zugriff.publish).toBe(false);
  });

  it('macht die Standard-Leitungsrolle zuständig, ohne sie einzutragen', async () => {
    const t = await turnier();
    const mitRolle = viewer('900000000000006041', [LEITUNGS_ROLLE], ALLE());

    const zugriff = await tournaments.getTournamentAccess(mitRolle, t);
    expect(zugriff.view).toBe(true);
    expect(zugriff.manage).toBe(true);
  });

  // --- Öffentliche Sicht -------------------------------------------------

  it('führt ein abgeschlossenes Turnier nur unter «Vorbei»', async () => {
    const t = await turnier({ name: 'Vorbei' });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    for (const status of ['REGISTRATION_CLOSED', 'READY', 'RUNNING', 'COMPLETED'] as const) {
      await tournaments.setTournamentStatus(t.id, status, actor(ADMIN.discordId, ADMIN.username));
    }

    const laufend = await tournaments.listPublicTournaments();
    const vergangen = await tournaments.listPublicTournaments({ archiv: true });

    // Beide Listen muessen sich ausschliessen - sonst steht dasselbe Turnier
    // auf der oeffentlichen Seite zweimal.
    expect(laufend.map((eintrag) => eintrag.id)).not.toContain(t.id);
    expect(vergangen.map((eintrag) => eintrag.id)).toContain(t.id);
  });

  it('zeigt Entwürfe nicht auf der öffentlichen Seite', async () => {
    const entwurf = await turnier({ name: 'Noch nicht fertig' });
    const offen = await turnier({ name: 'Ausgeschrieben' });
    await tournaments.publishTournament(offen.id, actor(ADMIN.discordId, ADMIN.username));

    const liste = await tournaments.listPublicTournaments();
    expect(liste.map((eintrag) => eintrag.id)).toEqual([offen.id]);
    expect(liste.map((eintrag) => eintrag.id)).not.toContain(entwurf.id);
  });

  it('gibt in der öffentlichen Teilnehmerliste keine Discord-Kennungen preis', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    await melde(t.id, '900000000000007001', 'anna');

    const teilnehmer = await tournaments.getPublicParticipants(t.id);
    expect(teilnehmer).toHaveLength(1);
    expect(JSON.stringify(teilnehmer)).not.toContain('900000000000007001');
    expect(teilnehmer[0]?.username).toBe('anna');
  });

  // --- Der eigene Stand --------------------------------------------------

  it('findet den eigenen Stand auch für einen Spieler im fremden Team', async () => {
    const t = await turnier({ mode: 'TEAM', minTeamSize: 1, maxTeamSize: 3 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const team = await tournaments.createTeam(
      {
        tournamentId: t.id,
        name: 'Edelweiss',
        captainDiscordId: '900000000000008001',
        captainUsername: 'anna',
      },
      actor('900000000000008001', 'anna'),
    );
    await tournaments.inviteToTeam(
      { teamId: team.id, discordId: '900000000000008002', username: 'beat', role: 'PLAYER' },
      actor('900000000000008001', 'anna'),
    );
    await tournaments.acceptInvite(
      await einladungVon('900000000000008002'),
      '900000000000008002',
      actor('900000000000008002', 'beat'),
    );
    await tournaments.register(
      {
        tournamentId: t.id,
        discordId: '900000000000008001',
        username: 'anna',
        teamId: team.id,
        rulesVersion: 1,
      },
      actor('900000000000008001', 'anna'),
    );

    // Der Spieler hat keine eigene Anmeldung - sie steht beim Captain.
    const spieler = await tournaments.getEigenerStand(t.id, '900000000000008002');
    expect(spieler.angemeldet).toBe(true);
    expect(spieler.teamName).toBe('Edelweiss');
    expect(spieler.istCaptain).toBe(false);

    const captain = await tournaments.getEigenerStand(t.id, '900000000000008001');
    expect(captain.istCaptain).toBe(true);
  });

  it('spricht nur der Captain für sein Team', async () => {
    const t = await turnier({ mode: 'TEAM', minTeamSize: 1, maxTeamSize: 3 });
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const team = await tournaments.createTeam(
      {
        tournamentId: t.id,
        name: 'Edelweiss',
        captainDiscordId: '900000000000008011',
        captainUsername: 'anna',
      },
      actor('900000000000008011', 'anna'),
    );
    await tournaments.inviteToTeam(
      { teamId: team.id, discordId: '900000000000008012', username: 'beat', role: 'PLAYER' },
      actor('900000000000008011', 'anna'),
    );
    await tournaments.acceptInvite(
      await einladungVon('900000000000008012'),
      '900000000000008012',
      actor('900000000000008012', 'beat'),
    );
    await tournaments.register(
      {
        tournamentId: t.id,
        discordId: '900000000000008011',
        username: 'anna',
        teamId: team.id,
        rulesVersion: 1,
      },
      actor('900000000000008011', 'anna'),
    );
    const gegner = await tournaments.createTeam(
      {
        tournamentId: t.id,
        name: 'Enzian',
        captainDiscordId: '900000000000008013',
        captainUsername: 'carla',
      },
      actor('900000000000008013', 'carla'),
    );
    await tournaments.register(
      {
        tournamentId: t.id,
        discordId: '900000000000008013',
        username: 'carla',
        teamId: gegner.id,
        rulesVersion: 1,
      },
      actor('900000000000008013', 'carla'),
    );
    await tournaments.generateBracket(t.id, actor(ADMIN.discordId, ADMIN.username));

    const match = (await tournaments.listMatches({ tournamentId: t.id }))[0]!;

    // Der Captain spricht fuer sein Team, der Spieler nicht.
    const captainSlot = await tournaments.getMatchSlot(match.id, '900000000000008011');
    const spielerSlot = await tournaments.getMatchSlot(match.id, '900000000000008012');
    const fremdSlot = await tournaments.getMatchSlot(match.id, '900000000000009999');

    expect(captainSlot).not.toBeNull();
    expect(spielerSlot).toBeNull();
    expect(fremdSlot).toBeNull();
  });

  // --- Abschluss und Archiv ----------------------------------------------

  it('vergibt beim Abschluss Platzierungen und Preise', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    await melde(t.id, '900000000000009001', 'anna');
    await melde(t.id, '900000000000009002', 'beat');
    await tournaments.upsertPrize(
      t.id,
      { placement: 1, title: 'Pokal' },
      actor(ADMIN.discordId, ADMIN.username),
    );
    await tournaments.generateBracket(t.id, actor(ADMIN.discordId, ADMIN.username));

    const match = (await tournaments.listMatches({ tournamentId: t.id }))[0]!;
    await tournaments.overrideResult(
      match.id,
      { scoreA: 1, scoreB: 0, reason: 'PLAYED' },
      'Ausgespielt.',
      actor(ADMIN.discordId, ADMIN.username),
    );

    await tournaments.berechnePlatzierungen(t.id);
    await tournaments.awardPrizes(t.id, actor(ADMIN.discordId, ADMIN.username));

    const sieger = await prisma.tournamentParticipant.findFirstOrThrow({
      where: { tournamentId: t.id, placement: 1 },
    });
    expect(sieger.id).toBe(match.participantA!.id);

    const preise = await tournaments.listPrizes(t.id);
    expect(preise[0]?.status).toBe('AWARDED');
    expect(preise[0]?.gewinner?.username).toBe('anna');
  });

  it('hält das Archiv ohne Discord vollständig', async () => {
    const t = await turnier();
    await tournaments.publishTournament(t.id, actor(ADMIN.discordId, ADMIN.username));
    await melde(t.id, '900000000000009011', 'anna');
    await melde(t.id, '900000000000009012', 'beat');
    await tournaments.generateBracket(t.id, actor(ADMIN.discordId, ADMIN.username));

    const match = (await tournaments.listMatches({ tournamentId: t.id }))[0]!;
    await tournaments.overrideResult(
      match.id,
      { scoreA: 1, scoreB: 0, reason: 'PLAYED' },
      'Ausgespielt.',
      actor(ADMIN.discordId, ADMIN.username),
    );
    // Den Zustandsweg der Reihe nach gehen: die Uebergangstabelle laesst
    // keine Abkuerzung, und das ist genau ihr Zweck.
    for (const status of ['REGISTRATION_CLOSED', 'READY', 'RUNNING', 'COMPLETED'] as const) {
      await tournaments.setTournamentStatus(
        t.id,
        status,
        actor(ADMIN.discordId, ADMIN.username),
      );
    }
    await tournaments.archiveTournament(t.id, actor(ADMIN.discordId, ADMIN.username));

    const archiviert = await prisma.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(archiviert.status).toBe('ARCHIVED');

    // Resultate, Teilnehmer und Verlauf ueberleben - der Datensatz ist die
    // Wahrheit, nicht der Discord-Kanal.
    const matches = await prisma.tournamentMatch.count({ where: { tournamentId: t.id } });
    const teilnehmer = await prisma.tournamentParticipant.count({ where: { tournamentId: t.id } });
    const ereignisse = await prisma.tournamentEvent.count({ where: { tournamentId: t.id } });
    expect(matches).toBe(1);
    expect(teilnehmer).toBe(2);
    expect(ereignisse).toBeGreaterThan(0);
  });

  it('zählt in der Statistik nur Turniere dieses Servers', async () => {
    await turnier({ name: 'Hier' });
    await prisma.tournament.create({
      data: {
        guildId: '111111111111111111',
        slug: 'anderswo',
        name: 'Anderswo',
        gameName: 'Valorant',
        createdByDiscordId: ADMIN.discordId,
        status: 'COMPLETED',
      },
    });

    const stats = await tournaments.getTournamentStats();
    expect(stats.gesamt).toBe(1);
    expect(stats.abgeschlossen).toBe(0);
  });

  it('zeigt in der Verwaltungsliste keine Turniere anderer Server', async () => {
    const hier = await turnier({ name: 'Hier' });
    await prisma.tournament.create({
      data: {
        guildId: '111111111111111111',
        slug: 'anderswo',
        name: 'Anderswo',
        gameName: 'Valorant',
        createdByDiscordId: ADMIN.discordId,
        status: 'REGISTRATION_OPEN',
      },
    });

    // Bewusst mit dem Vollzugriff geprueft: er hebt die Zustaendigkeit auf,
    // nicht die Serverzugehoerigkeit.
    const allmaechtig = viewer(ADMIN.discordId, [], Object.values(P()));
    const { rows } = await tournaments.listTournaments(allmaechtig, { page: 1, pageSize: 50 });
    expect(rows.map((zeile) => zeile.tournament.id)).toEqual([hier.id]);

    const oeffentlich = await tournaments.listPublicTournaments();
    expect(oeffentlich.map((eintrag) => eintrag.name)).not.toContain('Anderswo');
  });

  it('hält Turniere anderer Server auseinander', async () => {
    const t = await turnier();

    // Ein Turnier mit derselben Kennung auf einem anderen Server.
    await prisma.tournament.create({
      data: {
        guildId: '111111111111111111',
        slug: t.slug,
        name: t.name,
        gameName: 'Valorant',
        createdByDiscordId: ADMIN.discordId,
        status: 'REGISTRATION_OPEN',
      },
    });

    const oeffentlich = await tournaments.getPublicTournament(t.slug);
    expect(oeffentlich?.id).toBe(t.id);
    expect(oeffentlich?.guildId).toBe(GUILD);
  });
});
