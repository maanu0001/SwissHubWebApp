import { describe, expect, it } from 'vitest';
import { moderation } from '@swisshub/modules';
import { getModuleDefinition } from '@swisshub/modules';
import type { GuildMember, GuildRole } from '@swisshub/discord';

/**
 * Die Rangfolge des Moderation Center.
 *
 * Geprüft wird bewusst der Adapter und nicht die Policy dahinter: die Policy
 * hat ihre eigenen Fälle in `moderation-policy.test.ts`. Hier geht es um das,
 * was das Moderation Center hinzufügt - vor allem um den einen Unterschied
 * zum Jail: **ein Bann trifft auch jemanden, der gar nicht mehr da ist.**
 */

const ROLLEN: GuildRole[] = [
  { id: 'r-owner', name: 'Owner', color: 0, position: 100, managed: false, permissions: '8' },
  { id: 'r-bot', name: 'Bot', color: 0, position: 80, managed: true, permissions: '0' },
  { id: 'r-mod', name: 'Moderator', color: 0, position: 70, managed: false, permissions: '0' },
  { id: 'r-member', name: 'Member', color: 0, position: 5, managed: false, permissions: '0' },
];

const KONTEXT: moderation.ModerationPolicyContext = {
  guildRoles: ROLLEN,
  protectedRoleIds: ['r-owner'],
  moderationLevels: new Map([
    ['r-owner', 100],
    ['r-mod', 50],
  ]),
  botHighestPosition: 80,
  botUserId: 'bot-1',
  guildOwnerId: 'owner-1',
};

const mitglied = (id: string, roleIds: string[]): GuildMember => ({
  discordId: id,
  username: `user-${id}`,
  displayName: `User ${id}`,
  globalName: null,
  nickname: null,
  avatarHash: null,
  isBot: false,
  roleIds,
  joinedAt: new Date('2024-01-01T00:00:00.000Z'),
  accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
  boosting: false,
  timedOutUntil: null,
});

const MODERATOR = { discordId: 'mod-1', roleIds: ['r-mod', 'r-member'], isOwner: false };

describe('Moderation Center - Rangfolge', () => {
  it('erlaubt eine Massnahme gegen ein gewöhnliches Mitglied', () => {
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'user-1',
      target: mitglied('user-1', ['r-member']),
      context: KONTEXT,
    });

    expect(urteil.allowed).toBe(true);
  });

  it('verhindert Selbstmoderation, auch wenn das Mitglied nicht geladen wurde', () => {
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: MODERATOR.discordId,
      target: null,
      context: KONTEXT,
      erlaubeNichtmitglied: true,
    });

    expect(urteil.allowed).toBe(false);
    expect(urteil.code).toBe('SELF_TARGET');
  });

  it('schützt den Serverinhaber auch beim Bann eines Nichtmitglieds', () => {
    // Der wichtige Fall: `erlaubeNichtmitglied` darf kein Freibrief werden.
    // Ohne geladenes Mitglied gibt es keine Rollen zu vergleichen - die
    // Kennung genügt trotzdem für diese Entscheidung.
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'owner-1',
      target: null,
      context: KONTEXT,
      erlaubeNichtmitglied: true,
    });

    expect(urteil.allowed).toBe(false);
    expect(urteil.code).toBe('TARGET_IS_OWNER');
  });

  it('schützt den Bot selbst beim Bann eines Nichtmitglieds', () => {
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'bot-1',
      target: null,
      context: KONTEXT,
      erlaubeNichtmitglied: true,
    });

    expect(urteil.allowed).toBe(false);
    expect(urteil.code).toBe('TARGET_IS_BOT');
  });

  it('erlaubt den Bann einer Person, die den Server verlassen hat', () => {
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'ehemalig-1',
      target: null,
      context: KONTEXT,
      erlaubeNichtmitglied: true,
    });

    expect(urteil.allowed).toBe(true);
  });

  it('lehnt Kick und Timeout gegen eine abwesende Person ab', () => {
    // Discord kann niemanden entfernen oder stummschalten, der nicht da ist.
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'ehemalig-1',
      target: null,
      context: KONTEXT,
      erlaubeNichtmitglied: false,
    });

    expect(urteil.allowed).toBe(false);
    expect(urteil.code).toBe('TARGET_NOT_A_MEMBER');
  });

  it('lehnt ein Ziel mit geschützter Rolle ab', () => {
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'admin-1',
      target: mitglied('admin-1', ['r-owner']),
      context: KONTEXT,
    });

    expect(urteil.allowed).toBe(false);
    expect(urteil.code).toBe('TARGET_PROTECTED_ROLE');
  });

  it('lehnt ein Ziel mit gleich hoher Rolle ab', () => {
    const urteil = moderation.pruefeRangfolge({
      actor: MODERATOR,
      targetDiscordId: 'mod-2',
      target: mitglied('mod-2', ['r-mod']),
      context: KONTEXT,
    });

    expect(urteil.allowed).toBe(false);
    expect(urteil.code).toBe('TARGET_HIGHER_OR_EQUAL_ROLE');
  });

  it('leitet die Moderationsstufe aus den Rollen ab statt sie entgegenzunehmen', () => {
    // Der Aufrufer übergibt keine Stufe. Täte er es, könnte eine manipulierte
    // Eingabe sich selbst hochstufen - deshalb steht sie nicht in der
    // Schnittstelle.
    const eingabe = {
      actor: { discordId: 'neuling-1', roleIds: ['r-member'], isOwner: false },
      targetDiscordId: 'mod-2',
      target: mitglied('mod-2', ['r-mod']),
      context: KONTEXT,
    };

    expect(Object.keys(eingabe.actor)).not.toContain('moderationLevel');
    expect(moderation.pruefeRangfolge(eingabe).allowed).toBe(false);
  });
});

describe('Moderation Center - Berechtigungen', () => {
  it('registriert jede Massnahme als eigene Berechtigung', () => {
    const modul = getModuleDefinition('moderation');
    const registriert = new Set((modul?.permissions ?? []).map((eintrag) => eintrag.key));

    for (const schluessel of Object.values(moderation.MODERATION_PERMISSIONS)) {
      expect(registriert, `${schluessel} fehlt in der Module Registry`).toContain(schluessel);
    }
  });

  it('führt keine eigene Jail-Berechtigung - Jail bleibt beim Jail-Modul', () => {
    // Ein zweiter Schlüssel für dieselbe Handlung wäre eine zweite Wahrheit:
    // wer ihn hätte, dürfte über das Moderation Center, was ihm das
    // Jail-Modul verweigert.
    const schluessel = Object.values(moderation.MODERATION_PERMISSIONS);
    expect(schluessel.filter((eintrag) => eintrag.includes('jail'))).toEqual([]);
  });

  it('kennzeichnet Bann, Entbannung und Kick als kritisch', () => {
    const modul = getModuleDefinition('moderation');
    const kritisch = new Set(
      (modul?.permissions ?? []).filter((eintrag) => eintrag.critical).map((eintrag) => eintrag.key),
    );

    expect(kritisch).toContain(moderation.MODERATION_PERMISSIONS.ban);
    expect(kritisch).toContain(moderation.MODERATION_PERMISSIONS.unban);
    expect(kritisch).toContain(moderation.MODERATION_PERMISSIONS.kick);
  });
});
