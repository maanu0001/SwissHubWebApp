import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { createFakeState } from '../helpers/fake-database';

/**
 * Die Zielsuche des Vote Jail.
 *
 * Sie gibt es, weil Premium zwar eine Abstimmung starten durfte, aber kein
 * Ziel finden konnte: die allgemeine Mitgliedersuche verlangt `members.view`,
 * und die oeffnet das Member Center mit Profilen, Notizen und
 * Moderationsakte. Premium hatte sie nicht - zu Recht.
 *
 * Geprueft wird deshalb beides: dass die Suche jetzt findet, was sie finden
 * soll, und dass sie nicht zur Hintertuer ins Member Center wird.
 */
const fake = vi.hoisted(() => ({ state: null as unknown, module: null as unknown }));

vi.mock('@swisshub/database', async () => {
  const helpers = await import('../helpers/fake-database');
  const state = helpers.createFakeState();
  fake.state = state;
  fake.module = helpers.createFakeDatabaseModule(state);
  return fake.module as Record<string, unknown>;
});

const { jail } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');
const { invalidateRoleConfiguration, PERMISSION_PRESETS, resolvePreset } = await import(
  '@swisshub/permissions'
);

type State = ReturnType<typeof createFakeState>;

const MEMBER_ROLE = '900000000000000008';
const BOOSTER_ROLE = '900000000000000007';
const MOD_ROLE = '900000000000000003';
const SUPPORT_ROLE = '900000000000000004';
const OWNER_ROLE = '900000000000000001';

/**
 * Ein Premium-Mitglied.
 *
 * Keine Moderationsstufe, keine Moderationsrechte - nur eine Rolle, die in
 * der Discord-Hierarchie ueber der gewoehnlichen Mitgliederrolle steht. Genau
 * die Ausgangslage aus der Fehlermeldung.
 */
const PREMIUM = {
  discordId: '100000000000000005', // alpenfuchs
  username: 'alpenfuchs',
  roleIds: [MEMBER_ROLE, BOOSTER_ROLE],
  isOwner: false,
  moderationLevel: 0,
};

const SPAMMER = '100000000000000004';
const ROESCHTI = '100000000000000006';
const MODERATOR_ID = '100000000000000002';
const OWNER_ID = '100000000000000001';
const BOT_ID = '800000000000000001';

let state: State;
let gateway: ReturnType<typeof createMockGateway>;

beforeEach(() => {
  state = fake.state as State;
  state.jails.length = 0;
  state.voteJails.length = 0;
  state.managedRoles.length = 0;
  state.rolePermissions.length = 0;
  // So, wie ein eingerichteter Server aussieht: Team-Rollen tragen eine
  // Moderationsstufe. Genau daran erkennt die Policy sie - bei einer
  // Abstimmung ist es der einzige Schutz, denn die Rangfrage entscheidet dort
  // bewusst nicht mehr.
  state.managedRoles.push(
    { discordRoleId: OWNER_ROLE, label: 'Serverleitung', isProtected: true, keepOnJail: false, moderationLevel: 100 },
    { discordRoleId: MOD_ROLE, label: 'Moderator', isProtected: false, keepOnJail: false, moderationLevel: 50 },
    { discordRoleId: SUPPORT_ROLE, label: 'Supporter', isProtected: false, keepOnJail: false, moderationLevel: 40 },
  );
  state.moduleSettings.jail = {
    jailRoleId: '900000000000000006',
    voteJailEnabled: true,
    voteJailChannelId: '700000000000000002',
    voteJailRequiredVotes: 5,
    voteJailDurationSeconds: 300,
    voteJailResultSeconds: 1800,
  };
  invalidateRoleConfiguration();
  gateway = createMockGateway();
  setDiscordGateway(gateway);
});

const suche = (query: string) =>
  jail.searchVoteJailTargets(query, PREMIUM, { gateway, limit: 20 });

describe('Vote-Jail-Zielsuche', () => {
  it('findet ein zulässiges Mitglied', async () => {
    const treffer = await suche('spammer');
    expect(treffer.map((eintrag) => eintrag.discordId)).toEqual([SPAMMER]);
    expect(treffer[0]?.username).toBe('spammer99');
  });

  it('löst eine Discord-ID direkt auf', async () => {
    const treffer = await suche(ROESCHTI);
    expect(treffer.map((eintrag) => eintrag.discordId)).toEqual([ROESCHTI]);
  });

  it('gibt bei leerer oder zu kurzer Eingabe nichts zurück', async () => {
    // Eine leere Eingabe ist keine Anfrage nach der ganzen Mitgliederliste.
    expect(await suche('')).toEqual([]);
    expect(await suche('a')).toEqual([]);
  });

  it('findet auch ein Mitglied mit gleich hoher Rolle', async () => {
    // Der eigentliche Grund, warum Vote Jail für Premium nicht funktionierte:
    // die Moderation Policy verlangt beim Alleingang, dass der Handelnde über
    // dem Ziel steht. Bei einer Abstimmung entscheidet aber niemand allein -
    // und ein gewöhnliches Mitglied steht über niemandem.
    const gleichrangig = {
      ...PREMIUM,
      discordId: '100000000000000004', // spammer99, nur @Member
      username: 'spammer99',
      roleIds: [MEMBER_ROLE],
    };
    const treffer = await jail.searchVoteJailTargets('roeschti', gleichrangig, {
      gateway,
      limit: 20,
    });
    expect(treffer.map((eintrag) => eintrag.discordId)).toEqual([ROESCHTI]);
  });

  it('zeigt keine geschützten Ziele', async () => {
    // Alle auf einmal suchen: die Mock-Mitglieder tragen alle ein «e» im
    // Anzeigenamen oder Benutzernamen - ausser dem Bot.
    const alle = await Promise.all(
      ['Nina', 'Manuel', 'Lars', 'SwissHub'].map((name) => suche(name)),
    );
    const ids = alle.flat().map((eintrag) => eintrag.discordId);

    // Moderator: trägt eine Moderationsstufe.
    expect(ids).not.toContain(MODERATOR_ID);
    // Serverleitung: geschützte Rolle und höchste Stufe.
    expect(ids).not.toContain(OWNER_ID);
    // Supporter: ebenfalls eine Stufe.
    expect(ids).not.toContain('100000000000000003');
    // Bots werden nicht moderiert.
    expect(ids).not.toContain(BOT_ID);
  });

  it('zeigt niemanden gegen sich selbst', async () => {
    const treffer = await suche('alpenfuchs');
    expect(treffer.map((eintrag) => eintrag.discordId)).not.toContain(PREMIUM.discordId);
  });

  it('lässt bereits gejailte Mitglieder weg', async () => {
    state.jails.push({
      id: 'jail-1',
      targetDiscordId: SPAMMER,
      activeKey: SPAMMER,
      status: 'COMPLETED',
      releasedAt: null,
    } as never);

    expect(await suche('spammer')).toEqual([]);
  });

  it('lässt Mitglieder mit laufender Abstimmung weg', async () => {
    state.voteJails.push({
      id: 'vote-1',
      targetDiscordId: ROESCHTI,
      activeKey: ROESCHTI,
      status: 'ACTIVE',
    } as never);

    expect(await suche('roeschti')).toEqual([]);
  });

  it('gibt ausschliesslich Anzeigedaten heraus', async () => {
    // Kein Rollen-, Beitritts- oder Moderationsdatum: was hier nicht steht,
    // laesst sich ueber diesen Weg auch nicht abfragen.
    const [treffer] = await suche('spammer');
    expect(Object.keys(treffer!).sort()).toEqual([
      'avatarHash',
      'discordId',
      'displayName',
      'username',
    ]);
  });
});

describe('Ein Ziel über seine Kennung', () => {
  /*
    Der Weg für alle, die keine Mitgliedersuche haben. Wer eine Abstimmung
    startet, kennt die Person - er sitzt mit ihr im Voice oder liest gerade
    ihre Nachricht. Er braucht keine Liste des Servers, sondern diesen einen
    Menschen.
  */

  it('schlägt ein zulässiges Mitglied nach', async () => {
    const treffer = await jail.resolveVoteJailTarget(SPAMMER, PREMIUM, { gateway });

    expect(treffer?.discordId).toBe(SPAMMER);
    expect(treffer?.username).toBe('spammer99');
  });

  it('gibt für ein geschütztes Mitglied dasselbe zurück wie für ein unbekanntes', async () => {
    // Sonst liesse sich an der Antwort ablesen, wer geschützt ist.
    const geschuetzt = await jail.resolveVoteJailTarget(MODERATOR_ID, PREMIUM, { gateway });
    const unbekannt = await jail.resolveVoteJailTarget('900000000000009999', PREMIUM, { gateway });

    expect(geschuetzt).toBeNull();
    expect(unbekannt).toBeNull();
  });

  it('weist alles ab, was keine Discord-Kennung ist', async () => {
    for (const eingabe of ['spammer99', '', '12', 'spammer99 OR 1=1']) {
      expect(await jail.resolveVoteJailTarget(eingabe, PREMIUM, { gateway }), eingabe).toBeNull();
    }
  });

  it('zählt nichts auf - eine Kennung, höchstens ein Treffer', async () => {
    const treffer = await jail.resolveVoteJailTarget(SPAMMER, PREMIUM, { gateway });

    expect(treffer).not.toBeInstanceOf(Array);
    expect(Object.keys(treffer!).sort()).toEqual([
      'avatarHash',
      'discordId',
      'displayName',
      'username',
    ]);
  });
});

describe('Wer nach Namen suchen darf', () => {
  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/jail/actions.ts'),
    'utf8',
  );
  const abschnitt = (von: string, bis: string): string =>
    quelle.slice(quelle.indexOf(von), quelle.indexOf(bis));

  const suchAbschnitt = abschnitt(
    'export const searchVoteJailTargetsAction',
    'export const resolveVoteJailTargetAction',
  );
  const kennungsAbschnitt = abschnitt(
    'export const resolveVoteJailTargetAction',
    'export const startVoteJailAction',
  );

  it('verlangt für die Namenssuche zusätzlich das Recht am Member Center', () => {
    // Eine Namenssuche beantwortet «wer ist alles da?», und die Antwort ist
    // eine Mitgliederliste. Wer sie ohnehin hat, sucht weiter; die Befugnis,
    // eine Abstimmung zu starten, ist keine Befugnis, den Server zu
    // durchsuchen.
    expect(suchAbschnitt).toContain('JAIL_PERMISSIONS.voteStart');
    expect(suchAbschnitt).toContain("can(ctx, 'members.view')");
  });

  it('verlangt für die Kennung genau das fachliche Recht - und nichts weiter', () => {
    expect(kennungsAbschnitt).toContain('JAIL_PERMISSIONS.voteStart');
    expect(kennungsAbschnitt).not.toContain('members.view');
    expect(kennungsAbschnitt).not.toContain('members.search');
  });

  it('nimmt für die Kennung nur eine Snowflake entgegen', () => {
    expect(kennungsAbschnitt).toContain('z.string().regex(/^\\d{17,20}$/u)');
  });

  it('lässt die allgemeine Mitgliedersuche unverändert geschützt', () => {
    const mitglieder = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/members/actions.ts'),
      'utf8',
    );
    const suche = mitglieder.slice(
      mitglieder.indexOf('searchMembersAction'),
      mitglieder.indexOf('// --- Rollen'),
    );
    expect(suche).toContain("permission: 'members.view'");
  });
});

describe('Was Premium dadurch nicht bekommt', () => {
  it('bekommt weder Mitgliedersicht noch Moderationsrechte', () => {
    const premium = resolvePreset(PERMISSION_PRESETS.find((v) => v.id === 'premium')!);

    for (const verboten of [
      'members.view',
      'members.view.basic.all',
      'moderation.view',
      'moderation.execute',
      'moderation.ban',
      'moderation.kick',
      'moderation.timeout',
      'jail.create',
      'jail.release',
      'jail.view',
    ]) {
      expect(premium, verboten).not.toContain(verboten);
    }
    // Was er hat, ist genau das eine: eine Abstimmung starten.
    expect(premium).toContain('jail.vote.start');
  });

  it('sieht im Dialog keine Namenssuche', () => {
    const seite = readFileSync(
      join(process.cwd(), 'apps/web/src/app/(app)/vote-jail/page.tsx'),
      'utf8',
    );
    const dialog = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/jail/components/start-vote-jail-dialog.tsx'),
      'utf8',
    );

    // Die Seite entscheidet es serverseitig und gibt es dem Dialog mit.
    expect(seite).toContain("darfSuchen={can(context, 'members.view')}");
    expect(dialog).toContain('{darfSuchen ? (');
    expect(dialog).toContain('<ZielUeberKennung');
  });

  it('bekommt stattdessen den Weg über Discord genannt', () => {
    const kennung = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/jail/components/ziel-ueber-kennung.tsx'),
      'utf8',
    );

    expect(kennung).toContain('/vote_jail');
  });
});

describe('Der Weg über Discord bleibt bestehen', () => {
  const befehle = readFileSync(
    join(process.cwd(), 'apps/bot/src/commands/jail-commands.ts'),
    'utf8',
  );

  it('nimmt das Ziel aus Discords eigenem Auswahldialog', () => {
    // Kein Suchendpunkt von uns: die Person wählt jemanden, den sie auf
    // Discord ohnehin vor sich hat.
    expect(befehle).toContain("name: 'vote_jail'");
    expect(befehle).toContain('ApplicationCommandOptionType.User');
    expect(befehle).toContain("interaction.options.getUser('user', true)");
  });

  it('prüft dort dieselbe Berechtigung', () => {
    expect(befehle).toContain('actor.can(jail.JAIL_PERMISSIONS.voteStart)');
  });
});
