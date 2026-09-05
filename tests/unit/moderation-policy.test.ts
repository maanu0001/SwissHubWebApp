import { describe, expect, it } from 'vitest';
import { evaluateModerationPolicy, moderationLevelOf } from '@swisshub/permissions';
import type { GuildMember, GuildRole } from '@swisshub/discord';

const ROLES: GuildRole[] = [
  { id: 'r-admin', name: 'Administrator', color: 0, position: 90, managed: false, permissions: '8' },
  { id: 'r-bot', name: 'Bot', color: 0, position: 80, managed: true, permissions: '0' },
  { id: 'r-mod', name: 'Moderator', color: 0, position: 70, managed: false, permissions: '0' },
  { id: 'r-support', name: 'Supporter', color: 0, position: 50, managed: false, permissions: '0' },
  { id: 'r-member', name: 'Member', color: 0, position: 5, managed: false, permissions: '0' },
];

const member = (id: string, roleIds: string[], isBot = false): GuildMember => ({
  discordId: id,
  username: `user-${id}`,
  displayName: `User ${id}`,
  globalName: null,
  nickname: null,
  avatarHash: null,
  isBot,
  roleIds,
  joinedAt: new Date('2024-01-01T00:00:00.000Z'),
  accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
  boosting: false,
  timedOutUntil: null,
});

const baseInput = {
  guildRoles: ROLES,
  protectedRoleIds: ['r-admin'],
  moderationLevels: new Map([
    ['r-admin', 100],
    ['r-mod', 50],
    ['r-support', 10],
  ]),
  botHighestPosition: 80,
  botUserId: 'bot-1',
  guildOwnerId: 'owner-1',
};

const moderator = {
  discordId: 'mod-1',
  roleIds: ['r-mod', 'r-member'],
  isOwner: false,
  moderationLevel: 50,
};

describe('Moderation Policy', () => {
  it('erlaubt die Moderation eines normalen Mitglieds', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: moderator,
      target: member('user-1', ['r-member']),
    });

    expect(decision.allowed).toBe(true);
  });

  it('verhindert Selbstmoderation', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: moderator,
      target: member('mod-1', ['r-mod', 'r-member']),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('SELF_TARGET');
  });

  it('verhindert die Moderation von Bots', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: moderator,
      target: member('bot-1', ['r-member'], true),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TARGET_IS_BOT');
  });

  it('schützt Träger geschützter Rollen', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: { ...moderator, moderationLevel: 50 },
      target: member('admin-1', ['r-admin']),
      botHighestPosition: 95,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TARGET_PROTECTED_ROLE');
  });

  it('verhindert Moderation gleich hoher oder höherer Discord-Rollen', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: moderator,
      target: member('mod-2', ['r-mod']),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TARGET_HIGHER_OR_EQUAL_ROLE');
  });

  it('verhindert Moderation bei gleich hoher Moderationsstufe', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: { ...moderator, roleIds: ['r-mod'], moderationLevel: 10 },
      target: member('sup-1', ['r-support']),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TARGET_HIGHER_MODERATION_LEVEL');
  });

  it('meldet eine zu niedrige Bot-Rolle', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: { ...moderator, roleIds: ['r-admin'], moderationLevel: 100 },
      target: member('user-2', ['r-admin']),
      protectedRoleIds: [],
      botHighestPosition: 60,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('BOT_ROLE_TOO_LOW');
  });

  it('schützt den Guild Owner', () => {
    const decision = evaluateModerationPolicy({
      ...baseInput,
      actor: moderator,
      target: member('owner-1', ['r-member']),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TARGET_IS_OWNER');
  });

  it('lehnt Aktionen gegen Nicht-Mitglieder ab', () => {
    const decision = evaluateModerationPolicy({ ...baseInput, actor: moderator, target: null });

    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('TARGET_NOT_A_MEMBER');
  });

  it('erlaubt dem Owner die Rollenhierarchie zu übergehen, nicht aber die Schutzregeln', () => {
    const owner = { discordId: 'sh-owner', roleIds: [], isOwner: true, moderationLevel: 0 };

    expect(
      evaluateModerationPolicy({ ...baseInput, actor: owner, target: member('mod-2', ['r-mod']) }).allowed,
    ).toBe(true);
    expect(
      evaluateModerationPolicy({ ...baseInput, actor: owner, target: member('admin-9', ['r-admin']) }).code,
    ).toBe('TARGET_PROTECTED_ROLE');
  });

  it('bestimmt die höchste Moderationsstufe', () => {
    expect(moderationLevelOf(['r-support', 'r-mod'], baseInput.moderationLevels)).toBe(50);
    expect(moderationLevelOf(['r-member'], baseInput.moderationLevels)).toBe(0);
  });
});

describe('Abstimmung und Moderationsstufe', () => {
  /*
    Bei einer Abstimmung entscheidet die Gemeinschaft, nicht der Rang dessen,
    der sie anstösst. Für die Rollenposition galt das schon; für die
    Moderationsstufe wurde weiterhin mit dem Antragsteller verglichen, und das
    hatte zwei unerwünschte Folgen.
  */

  it('schützt jedes Teammitglied - auch vor einem höherrangigen Antragsteller', () => {
    // Das Loch: 50 >= 70 ist falsch, also war die Abstimmung erlaubt. Damit
    // durfte die Gemeinschaft doch über einen Moderator abstimmen, sofern nur
    // der Richtige sie anstiess.
    const entscheidung = evaluateModerationPolicy({
      ...baseInput,
      kind: 'COMMUNITY_VOTE',
      actor: { ...moderator, roleIds: ['r-admin'], moderationLevel: 100 },
      target: member('t-mod', ['r-mod', 'r-member']),
    });

    expect(entscheidung.allowed).toBe(false);
    expect(entscheidung.code).toBe('TARGET_HIGHER_MODERATION_LEVEL');
  });

  it('lässt Gleichrangige ohne Stufe gegeneinander abstimmen', () => {
    // Die zweite Folge: wegen `>=` kamen zwei Träger derselben Rolle nie
    // aneinander vorbei. Wer keine Stufe trägt, gehört nicht zum Team - und
    // ist damit wählbar.
    const entscheidung = evaluateModerationPolicy({
      ...baseInput,
      kind: 'COMMUNITY_VOTE',
      actor: { ...moderator, roleIds: ['r-member'], moderationLevel: 0 },
      target: member('t-member', ['r-member']),
    });

    expect(entscheidung.allowed).toBe(true);
  });

  it('behält im Alleingang die Rangordnung', () => {
    // Dort ist der Vergleich richtig: niemand moderiert nach oben oder zur
    // Seite.
    const entscheidung = evaluateModerationPolicy({
      ...baseInput,
      kind: 'UNILATERAL',
      actor: { ...moderator, roleIds: ['r-admin'], moderationLevel: 100 },
      target: member('t-mod', ['r-mod', 'r-member']),
    });

    expect(entscheidung.allowed).toBe(true);
  });
});
