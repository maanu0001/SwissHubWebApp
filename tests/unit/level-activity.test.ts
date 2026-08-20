import { describe, expect, it } from 'vitest';
import {
  decideMessageXp,
  decideVoiceXp,
  levelSettingsSchema,
  MessageCooldownTracker,
} from '@swisshub/modules/level';

/**
 * Wann es XP gibt und wann nicht.
 *
 * Beim Vorgänger lagen dieselben Bedingungen verstreut in zwei langen
 * Event-Handlern; ob ein Fall wirklich griff, zeigte sich erst im Betrieb.
 * Hier ist jede Bedingung einzeln nachweisbar.
 */
const settings = (overrides: Record<string, unknown> = {}) => levelSettingsSchema.parse(overrides);

const CHANNEL = '700000000000000001';
const NO_XP_ROLE = '800000000000000001';
const PREMIUM_ROLE = '800000000000000002';

describe('XP für Nachrichten', () => {
  const base = { channelId: CHANNEL, roleIds: [] as string[], secondsSinceLastXp: null };

  it('vergibt die konfigurierte Menge', () => {
    const decision = decideMessageXp(base, settings());
    expect(decision.grant).toBe(true);
    expect(decision.amount).toBe(10);
  });

  it('gibt nichts, wenn die Vergabe abgeschaltet ist', () => {
    expect(decideMessageXp(base, settings({ messageXpEnabled: false }))).toMatchObject({
      grant: false,
      reason: 'disabled',
    });
  });

  it('gibt nichts in einem Channel ohne XP', () => {
    expect(decideMessageXp(base, settings({ noXpChannelIds: [CHANNEL] }))).toMatchObject({
      grant: false,
      reason: 'no-xp-channel',
    });
  });

  it('gibt nichts an Trägerinnen der Rolle ohne XP', () => {
    const decision = decideMessageXp(
      { ...base, roleIds: [NO_XP_ROLE] },
      settings({ noXpRoleId: NO_XP_ROLE }),
    );
    expect(decision).toMatchObject({ grant: false, reason: 'no-xp-role' });
  });

  it('hält die Sperrfrist ein', () => {
    const config = settings({ messageCooldownSeconds: 60 });
    expect(decideMessageXp({ ...base, secondsSinceLastXp: 59 }, config).grant).toBe(false);
    expect(decideMessageXp({ ...base, secondsSinceLastXp: 60 }, config).grant).toBe(true);
  });

  it('verwendet für die Premium-Rolle deren eigene Sperrfrist', () => {
    const config = settings({
      premiumRoleId: PREMIUM_ROLE,
      messageCooldownSeconds: 60,
      premiumMessageCooldownSeconds: 30,
    });
    expect(decideMessageXp({ ...base, secondsSinceLastXp: 40 }, config).grant).toBe(false);
    expect(decideMessageXp({ ...base, roleIds: [PREMIUM_ROLE], secondsSinceLastXp: 40 }, config).grant).toBe(
      true,
    );
  });

  it('rechnet Boost und Premium-Faktor in derselben Reihenfolge wie der Vorgänger', () => {
    // Erst Boost, abschneiden, dann der Premium-Faktor. Eine andere Reihenfolge
    // ergäbe andere Beträge.
    const config = settings({
      xpPerMessage: 10,
      xpBoost: 1.5,
      premiumRoleId: PREMIUM_ROLE,
      premiumXpMultiplier: 1.5,
    });
    expect(decideMessageXp(base, config).amount).toBe(15);
    expect(decideMessageXp({ ...base, roleIds: [PREMIUM_ROLE] }, config).amount).toBe(22);
  });

  it('gibt nichts, wenn der Betrag auf null abgeschnitten wird', () => {
    expect(decideMessageXp(base, settings({ xpBoost: 0 }))).toMatchObject({
      grant: false,
      reason: 'zero-amount',
    });
  });
});

describe('XP für Voice', () => {
  const base = {
    channelId: CHANNEL,
    roleIds: [] as string[],
    selfMuted: false,
    selfDeafened: false,
    serverMuted: false,
    serverDeafened: false,
    secondsSinceMuted: null,
    otherHumansInChannel: 1,
  };

  it('vergibt die konfigurierte Menge pro Minute', () => {
    expect(decideVoiceXp(base, settings())).toMatchObject({ grant: true, amount: 10 });
  });

  it('sperrt XP bei Stummschaltung', () => {
    expect(decideVoiceXp({ ...base, selfMuted: true }, settings())).toMatchObject({
      grant: false,
      reason: 'muted',
    });
  });

  it('lässt den Nachlauf bei Stummschaltung wirken', () => {
    const config = settings({ voiceMuteCooldownSeconds: 60 });
    expect(decideVoiceXp({ ...base, selfMuted: true, secondsSinceMuted: 30 }, config).grant).toBe(true);
    expect(decideVoiceXp({ ...base, selfMuted: true, secondsSinceMuted: 60 }, config).grant).toBe(false);
  });

  it('unterscheidet Sound- und Server-Stummschaltung', () => {
    const soundOnly = settings({ voiceMuteMode: 'sound' });
    expect(decideVoiceXp({ ...base, selfMuted: true }, soundOnly).grant).toBe(false);
    expect(decideVoiceXp({ ...base, serverMuted: true }, soundOnly).grant).toBe(true);

    const voiceOnly = settings({ voiceMuteMode: 'voice' });
    expect(decideVoiceXp({ ...base, selfMuted: true }, voiceOnly).grant).toBe(true);
    expect(decideVoiceXp({ ...base, serverMuted: true }, voiceOnly).grant).toBe(false);
  });

  it('gibt auf Wunsch keine XP für Alleinsein', () => {
    const config = settings({ xpWhileAlone: false });
    expect(decideVoiceXp({ ...base, otherHumansInChannel: 0 }, config)).toMatchObject({
      grant: false,
      reason: 'alone',
    });
    expect(decideVoiceXp({ ...base, otherHumansInChannel: 1 }, config).grant).toBe(true);
  });

  it('gibt standardmässig auch alleine XP', () => {
    expect(decideVoiceXp({ ...base, otherHumansInChannel: 0 }, settings()).grant).toBe(true);
  });

  it('multipliziert Sonder- und Bühnenkanäle', () => {
    const config = settings({
      specialVoiceChannelIds: [CHANNEL],
      specialVoiceMultiplier: 2,
    });
    expect(decideVoiceXp(base, config).amount).toBe(20);
  });

  it('kombiniert Kanal- und Premium-Multiplikator', () => {
    const config = settings({
      specialVoiceChannelIds: [CHANNEL],
      specialVoiceMultiplier: 2,
      premiumRoleId: PREMIUM_ROLE,
      premiumXpMultiplier: 1.5,
    });
    expect(decideVoiceXp({ ...base, roleIds: [PREMIUM_ROLE] }, config).amount).toBe(30);
  });

  it('gibt nichts in einem Channel ohne XP', () => {
    expect(decideVoiceXp(base, settings({ noXpChannelIds: [CHANNEL] }))).toMatchObject({
      grant: false,
      reason: 'no-xp-channel',
    });
  });
});

describe('Sperrfrist für Nachrichten', () => {
  it('meldet vor der ersten Vergabe keine Zeit', () => {
    const tracker = new MessageCooldownTracker();
    expect(tracker.secondsSince('1')).toBeNull();
  });

  it('rechnet ab der letzten Vergabe', () => {
    const tracker = new MessageCooldownTracker();
    tracker.record('1', 1_000_000);
    expect(tracker.secondsSince('1', 1_060_000)).toBe(60);
  });

  it('räumt alte Einträge irgendwann weg', () => {
    const tracker = new MessageCooldownTracker();
    tracker.record('1', 0);
    tracker.record('2', 1);
    expect(tracker.size).toBe(2);

    // Der Aufräumlauf greift frühestens zehn Minuten nach dem letzten und
    // wirft nur weg, was älter als eine Stunde ist.
    const later = 2 * 60 * 60_000;
    tracker.record('3', later);
    expect(tracker.size).toBe(1);
    expect(tracker.secondsSince('1', later)).toBeNull();
  });
});
