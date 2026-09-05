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
const { invalidateRoleConfiguration, PERMISSION_PRESETS, resolvePreset } =
  await import('@swisshub/permissions');

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
    {
      discordRoleId: OWNER_ROLE,
      label: 'Serverleitung',
      isProtected: true,
      keepOnJail: false,
      moderationLevel: 100,
    },
    {
      discordRoleId: MOD_ROLE,
      label: 'Moderator',
      isProtected: false,
      keepOnJail: false,
      moderationLevel: 50,
    },
    {
      discordRoleId: SUPPORT_ROLE,
      label: 'Supporter',
      isProtected: false,
      keepOnJail: false,
      moderationLevel: 40,
    },
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

const suche = (query: string) => jail.searchVoteJailTargets(query, PREMIUM, { gateway, limit: 20 });

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

  it('markiert geschützte Ziele als nicht wählbar', async () => {
    /*
      Sie stehen jetzt in der Liste - ausgegraut, mit dem Grund daneben.

      Weggelassen wurden sie früher, und das war der Fehler: die Suche fand
      jemanden, die Policy sortierte ihn aus, und übrig blieb eine leere
      Liste, die aussah wie «gibt es nicht». Wer wusste, dass die Person auf
      dem Server ist, stand vor einem Rätsel.

      Preisgegeben wird damit nichts: eine Rolle ist auf Discord öffentlich.
      Was zählt, ist dass sie nicht wählbar sind - und das prüft dieser Fall.
    */
    const alle = await Promise.all(['Nina', 'Manuel', 'Lars', 'SwissHub'].map((name) => suche(name)));
    const nachId = new Map(alle.flat().map((eintrag) => [eintrag.discordId, eintrag]));

    for (const [wer, id] of [
      ['Moderator', MODERATOR_ID],
      ['Serverleitung', OWNER_ID],
      ['Supporter', '100000000000000003'],
      ['Bot', BOT_ID],
    ] as const) {
      const eintrag = nachId.get(id);
      if (eintrag) {
        expect(eintrag.waehlbar, `${wer} darf nicht wählbar sein`).toBe(false);
        expect(eintrag.grund, `${wer} braucht eine Begründung`).toBeTruthy();
      }
    }
  });

  it('nennt die Rolle, an der die Moderationsstufe hängt', async () => {
    /*
      «Moderationsstufe» allein ist ein Urteil ohne Begründung - und wer eine
      Rolle für falsch eingestuft hält, sucht den Fehler im System statt in
      den Einstellungen. Der Hinweis nennt die Rolle, ihre Stufe und den Weg
      dorthin.

      Preisgegeben wird damit nichts: welche Rollen jemand trägt, steht auf
      Discord ohnehin neben seinem Namen.
    */
    const [moderator] = await suche(MODERATOR_ID);

    expect(moderator?.waehlbar).toBe(false);
    expect(moderator?.hinweis).toContain('Moderationsstufe');
    expect(moderator?.hinweis).toContain('Berechtigungen');
  });

  it('gibt einen Hinweis nur dort, wo sich etwas ändern lässt', async () => {
    // Gegen sich selbst abzustimmen ist keine Einstellungsfrage.
    const [ich] = await suche('alpenfuchs');

    expect(ich?.grund).toBe('Du selbst');
    expect(ich?.hinweis).toBeNull();
  });

  it('begründet kurz und ohne Innenansicht', async () => {
    // «Moderation» sagt genug. «Trägt Rolle X mit Stufe 2» wäre eine Auskunft
    // über die Rollenordnung, und die gehört nicht in eine Zielsuche.
    const [moderator] = await suche(MODERATOR_ID);

    expect(moderator?.grund).toBe('Moderationsstufe');
    expect(moderator?.grund).not.toMatch(/\d/u);
  });

  it('markiert einen selbst als nicht wählbar', async () => {
    const [ich] = await suche('alpenfuchs');

    expect(ich?.discordId).toBe(PREMIUM.discordId);
    expect(ich?.waehlbar).toBe(false);
    expect(ich?.grund).toBe('Du selbst');
  });

  it('markiert bereits gejailte Mitglieder', async () => {
    state.jails.push({
      id: 'jail-1',
      targetDiscordId: SPAMMER,
      activeKey: SPAMMER,
      status: 'COMPLETED',
      releasedAt: null,
    } as never);

    const [eintrag] = await suche('spammer');
    expect(eintrag?.waehlbar).toBe(false);
    expect(eintrag?.grund).toBe('Bereits gejailt');
  });

  it('markiert Mitglieder mit laufender Abstimmung', async () => {
    state.voteJails.push({
      id: 'vote-1',
      targetDiscordId: ROESCHTI,
      activeKey: ROESCHTI,
      status: 'ACTIVE',
    } as never);

    const [eintrag] = await suche('roeschti');
    expect(eintrag?.waehlbar).toBe(false);
    expect(eintrag?.grund).toBe('Abstimmung läuft bereits');
  });

  it('gibt ausschliesslich Anzeigedaten heraus', async () => {
    // Kein Rollen-, Beitritts- oder Moderationsdatum: was hier nicht steht,
    // laesst sich ueber diesen Weg auch nicht abfragen. `waehlbar` und
    // `grund` sind Aussagen ueber die Handlung, keine ueber die Person.
    const [treffer] = await suche('spammer');
    expect(Object.keys(treffer!).sort()).toEqual([
      'avatarHash',
      'discordId',
      'displayName',
      'grund',
      'hinweis',
      'username',
      'waehlbar',
    ]);
  });

  it('reicht einen Fehler von Discord durch, statt ihn zu leeren Treffern zu machen', async () => {
    /*
      DAS war die Ursache der leeren Suche.

      Hier stand `.catch(() => [])`. Damit sah jeder Fehler von Discord aus
      wie ein Ergebnis: keine Berechtigung, ein Rate Limit, ein Aussetzer -
      alles wurde zur leeren Liste. Im Browser blieb davon ein Ladekringel,
      der kurz erscheint und wieder verschwindet, und ein leeres Feld.

      Ein Fehler ist kein leeres Ergebnis.
    */
    const kaputt = {
      ...gateway,
      members: {
        ...gateway.members,
        search: async () => {
          throw new Error('403 Missing Access');
        },
      },
    };

    await expect(
      jail.searchVoteJailTargets('manu', PREMIUM, { gateway: kaputt as never, limit: 20 }),
    ).rejects.toThrow();
  });
});

describe('Ein Ziel über seine Kennung', () => {
  /*
    Dieselbe Suche, nur mit einer Kennung statt einem Namen. Wer eine kennt,
    tippt sie ein - es braucht dafür keinen zweiten Weg und keine zweite
    Prüfung.
  */

  it('schlägt ein zulässiges Mitglied nach', async () => {
    const [treffer] = await suche(SPAMMER);

    expect(treffer?.discordId).toBe(SPAMMER);
    expect(treffer?.username).toBe('spammer99');
  });

  it('gibt ein geschütztes Mitglied heraus, aber nicht wählbar', async () => {
    const [geschuetzt] = await suche(MODERATOR_ID);

    expect(geschuetzt?.waehlbar).toBe(false);
    expect(geschuetzt?.grund).toBeTruthy();
  });

  it('liefert zu einer unbekannten Kennung nichts', async () => {
    expect(await suche('900000000000009999')).toEqual([]);
  });

  it('zählt bei einer Kennung nichts auf - höchstens ein Treffer', async () => {
    expect(await suche(SPAMMER)).toHaveLength(1);
  });

  it('gibt auf eine leere Eingabe nicht den ganzen Server heraus', async () => {
    // Eine leere Eingabe ist keine Anfrage nach der Mitgliederliste.
    expect(await suche('')).toEqual([]);
    expect(await suche('a')).toEqual([]);
  });
});

describe('Wer nach Namen suchen darf', () => {
  const quelle = readFileSync(join(process.cwd(), 'apps/web/src/modules/jail/actions.ts'), 'utf8');
  const suchAbschnitt = quelle.slice(
    quelle.indexOf('export const searchVoteJailTargetsAction'),
    quelle.indexOf('export const startVoteJailAction'),
  );

  it('verlangt genau das fachliche Recht - und nichts weiter', () => {
    /*
      Wer eine Abstimmung starten darf, darf ihr Ziel auch wählen. Ein
      zusätzliches Recht am Member Center zu verlangen hiesse: Premium tippt
      Kennungen ab, während das Team nebenan Namen eintippt - für dieselbe
      Handlung.

      Sicher ist das nicht über die Berechtigung, sondern über die Antwort:
      zurück kommt nur, gegen wen dieser Handelnde tatsächlich abstimmen
      lassen könnte, und von ihm nur Anzeigedaten. Das prüfen die Fälle oben.
    */
    expect(suchAbschnitt).toContain('JAIL_PERMISSIONS.voteStart');
    expect(suchAbschnitt).not.toContain("can(ctx, 'members.view')");
    expect(suchAbschnitt).not.toContain('members.search');
  });

  it('lässt die allgemeine Mitgliedersuche unverändert geschützt', () => {
    // Der Punkt, an dem sich beide unterscheiden: das Member Center bleibt
    // hinter `members.view`, mit Profilen, Notizen und Akte dahinter.
    const mitglieder = readFileSync(join(process.cwd(), 'apps/web/src/modules/members/actions.ts'), 'utf8');
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

  it('bedient dieselbe Auswahl wie «Bannen» - mit der eigenen Suche dahinter', () => {
    const dialog = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/jail/components/start-vote-jail-dialog.tsx'),
      'utf8',
    );
    const ban = readFileSync(
      join(process.cwd(), 'apps/web/src/modules/moderation/components/moderation-dialog.tsx'),
      'utf8',
    );

    // Dieselbe Komponente - keine zweite, fast gleiche daneben.
    expect(dialog).toContain('<MemberPicker');
    expect(ban).toContain('<MemberPicker');
    // Aber die Suche des Vote Jails, nicht die allgemeine.
    expect(dialog).toContain('suche={searchVoteJailTargetsAction}');
  });

  it('bekommt keinen Zugang zum Member Center', () => {
    // Die Suche im Dialog ist kontextgebunden; die Mitgliederseite selbst
    // bleibt hinter ihrer eigenen Berechtigung.
    const seite = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/members/page.tsx'), 'utf8');

    expect(seite).toContain("'members.view'");
  });
});

describe('Der Weg über Discord bleibt bestehen', () => {
  const befehle = readFileSync(join(process.cwd(), 'apps/bot/src/commands/jail-commands.ts'), 'utf8');

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
