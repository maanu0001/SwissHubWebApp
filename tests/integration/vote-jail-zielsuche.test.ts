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
const { invalidateRoleConfiguration } = await import('@swisshub/permissions');

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

describe('Vote-Jail-Zielsuche - Berechtigung', () => {
  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/jail/actions.ts'),
    'utf8',
  );

  it('verlangt dieselbe Berechtigung wie das Starten einer Abstimmung', () => {
    const abschnitt = quelle.slice(
      quelle.indexOf('searchVoteJailTargetsAction'),
      quelle.indexOf('export const startVoteJailAction'),
    );
    expect(abschnitt).toContain('JAIL_PERMISSIONS.voteStart');
  });

  it('verlangt nicht members.view', () => {
    // Der eigentliche Fehler: die Zielsuche hing an der Berechtigung des
    // Member Center. Premium darf durch diese Aktion keinen Zugriff darauf
    // bekommen.
    const abschnitt = quelle.slice(
      quelle.indexOf('searchVoteJailTargetsAction'),
      quelle.indexOf('export const startVoteJailAction'),
    );
    expect(abschnitt).not.toContain('members.view');
  });

  it('lässt die allgemeine Mitgliedersuche unverändert geschützt', () => {
    const mitglieder = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/members/actions.ts'),
      'utf8',
    );
    const abschnitt = mitglieder.slice(
      mitglieder.indexOf('searchMembersAction'),
      mitglieder.indexOf('// --- Rollen'),
    );
    expect(abschnitt).toContain("permission: 'members.view'");
  });
});
