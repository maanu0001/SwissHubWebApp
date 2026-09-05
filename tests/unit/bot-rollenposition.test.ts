import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateModerationPolicy } from '@swisshub/permissions';

/**
 * Null ist eine Position, kein Platzhalter.
 *
 * Die Moderation Policy lehnt jedes Ziel ab, das nicht unterhalb des Bots
 * steht. Bei Position 0 ist das jeder - auch die Serverleitung. Genau diesen
 * Wert lieferte `highestRolePosition()` aber auch dann, wenn sich die
 * Position gar nicht ermitteln liess.
 *
 * Ein Aussetzer beim Abruf hat damit die ganze Moderation stillgelegt, ohne
 * dass irgendwo ein Fehler auftauchte: die Vote-Jail-Suche fand Mitglieder,
 * aber keines liess sich auswählen.
 */
const ziel = {
  discordId: '2',
  username: 'manuel',
  displayName: 'Manuel',
  avatarHash: null,
  isBot: false,
  roleIds: [],
} as never;

const pruefe = (botHighestPosition: number, isOwner = false) =>
  evaluateModerationPolicy({
    kind: 'COMMUNITY_VOTE',
    actor: { discordId: '1', roleIds: [], isOwner, moderationLevel: isOwner ? 99 : 0 },
    target: ziel,
    guildRoles: [],
    protectedRoleIds: [],
    moderationLevels: new Map(),
    botHighestPosition,
  });

describe('Position 0 sperrt alles', () => {
  it('lehnt jedes Ziel ab, wenn der Bot bei 0 steht', () => {
    expect(pruefe(0).allowed).toBe(false);
    expect(pruefe(0).code).toBe('BOT_ROLE_TOO_LOW');
  });

  it('lehnt dann sogar die Serverleitung ab', () => {
    // Der Owner-Freibrief greift erst nach dieser Prüfung - sie steht davor,
    // weil auch der Owner keine Discord-Aktion erzwingen kann, die dem Bot
    // verwehrt ist.
    expect(pruefe(0, true).allowed).toBe(false);
  });

  it('lässt bei einer echten Position durch', () => {
    expect(pruefe(5).allowed).toBe(true);
  });
});

describe('«Unbekannt» darf nicht als 0 durchgehen', () => {
  const gateway = readFileSync(join(process.cwd(), 'packages/discord/src/rest-gateway.ts'), 'utf8');
  const beginn = gateway.indexOf('async highestRolePosition()');
  const abschnitt = gateway.slice(beginn, gateway.indexOf('},', gateway.indexOf('return Math.max', beginn)));

  it('wirft, statt 0 zurückzugeben, wenn der Bot nicht gefunden wird', () => {
    expect(abschnitt).toContain('throw new Error(');
    expect(abschnitt).not.toMatch(/if \(!botMember\) \{\s*return 0;/u);
  });

  it('fängt den Fehler im Jail-Kontext nicht mehr ab', () => {
    // Dort führte das Abfangen dazu, dass ein Aussetzer wie «gegen niemanden
    // möglich» aussah statt wie «gerade nicht erreichbar».
    const kontext = readFileSync(join(process.cwd(), 'packages/modules/src/jail/context.ts'), 'utf8');
    expect(kontext).toContain('gateway.bot.highestRolePosition();');
    expect(kontext).not.toContain('highestRolePosition().catch(() => 0)');
  });

  it('fängt ihn auch in der Moderation Policy nicht mehr ab', () => {
    const policy = readFileSync(join(process.cwd(), 'packages/modules/src/moderation/policy.ts'), 'utf8');
    expect(policy).not.toContain('highestRolePosition().catch(() => 0)');
  });
});

describe('Die Maske sagt es, wenn niemand wählbar ist', () => {
  const picker = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/members/components/member-picker.tsx'),
    'utf8',
  );

  it('fasst einen gemeinsamen Hinderungsgrund oben zusammen', () => {
    // Wenn gar nichts wählbar ist und immer aus demselben Grund, ist das kein
    // Merkmal der Treffer, sondern ein Zustand des Servers.
    expect(picker).toContain('gemeinsamerHinderungsgrund');
    expect(picker).toContain('Keines der gefundenen Mitglieder lässt sich auswählen');
  });

  it('verallgemeinert nicht bei gemischten Gründen', () => {
    expect(picker).toContain('gruende.size === 1');
  });

  it('schweigt, sobald einer wählbar ist', () => {
    expect(picker).toContain('eintraege.some((eintrag) => eintrag.waehlbar)');
  });
});
