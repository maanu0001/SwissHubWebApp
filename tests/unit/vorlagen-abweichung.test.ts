import { describe, expect, it } from 'vitest';
import '@swisshub/modules';
import { PERMISSION_PRESETS, findPresetDrift, resolvePreset } from '@swisshub/permissions';

/**
 * Warum Premium keinen Vote Jail starten konnte - die eigentliche Ursache.
 *
 * Der frühere Anlauf hat die Vorlage «Premium» um `jail.vote.start` ergänzt.
 * Das hat für einen laufenden Server nichts geändert: eine Vorlage wird genau
 * einmal angewendet, nämlich wenn jemand im Dashboard darauf klickt. Danach
 * stehen die Rechte als Zeilen in der Datenbank, und die sind ab dann die
 * Wahrheit. Eine spätere Änderung an der Vorlage erreicht sie nie.
 *
 * Es war also kein Fehler in der Prüfkette - Sidebar, Seite, Server Action und
 * Policy waren in Ordnung. Der Rolle fehlte schlicht das Recht.
 *
 * Zwei Dinge folgen daraus. Die Migration trägt es nach; diese Datei prüft das
 * Zweite: dass so ein Auseinanderlaufen künftig sichtbar ist, statt still zu
 * bleiben, bis jemand sich beschwert.
 */

const premium = PERMISSION_PRESETS.find((preset) => preset.id === 'premium')!;
const moderator = PERMISSION_PRESETS.find((preset) => preset.id === 'moderator')!;

describe('Die Vorlage selbst', () => {
  it('gibt Premium die beiden Vote-Jail-Rechte', () => {
    const rechte = resolvePreset(premium);

    expect(rechte).toContain('jail.vote.start');
    expect(rechte).toContain('jail.module.view');
  });

  it('gibt Premium dabei keine Moderationsbefugnis', () => {
    // Least Privilege: eine Abstimmung führt nur dann zu einem Jail, wenn
    // genug Stimmen zusammenkommen. Selbst einsperren darf Premium nicht.
    const rechte = resolvePreset(premium);

    for (const verboten of [
      'jail.create',
      'jail.edit',
      'jail.release',
      'jail.settings',
      'jail.import',
      'jail.vote.multivote',
      'jail.vote.bypassCooldown',
      'moderation.execute',
      'moderation.ban',
      'moderation.kick',
      'moderation.timeout',
      'moderation.view',
      'members.view.basic.all',
    ]) {
      expect(rechte, `Premium hat ${verboten}`).not.toContain(verboten);
    }
  });

  it('lässt Premium ohne Moderationsstufe', () => {
    expect(premium.moderationLevel).toBe(0);
  });
});

describe('Eine Rolle, die hinter ihrer Vorlage zurückliegt', () => {
  it('erkennt genau das fehlende Recht', () => {
    // Der Stand, den ein laufender Server heute hat: die Premium-Rolle wurde
    // gesetzt, bevor es die beiden Schlüssel gab.
    const alterStand = resolvePreset(premium).filter(
      (recht) => recht !== 'jail.vote.start' && recht !== 'jail.module.view',
    );

    const abweichung = findPresetDrift(alterStand);

    expect(abweichung?.preset.id).toBe('premium');
    expect(abweichung?.fehlend).toEqual(expect.arrayContaining(['jail.vote.start', 'jail.module.view']));
  });

  it('meldet nichts, wenn die Rolle vollständig ist', () => {
    expect(findPresetDrift(resolvePreset(premium))).toBeNull();
    expect(findPresetDrift(resolvePreset(moderator))).toBeNull();
  });

  it('meldet nichts bei einer von Hand zusammengestellten Rolle', () => {
    // Wer der Rolle etwas hinzugefügt hat, hat sie bewusst von der Vorlage
    // gelöst - dem wird nichts nachgetragen und nichts vorgeworfen.
    const eigenbau = [...resolvePreset(premium), 'moderation.view'];

    expect(findPresetDrift(eigenbau)).toBeNull();
  });

  it('meldet nichts bei einer leeren Rolle', () => {
    // Eine Rolle ohne jedes Recht passt formal unter jede Vorlage - daraus
    // eine Empfehlung zu machen wäre geraten.
    expect(findPresetDrift([])).toBeNull();
  });

  it('meldet auch dann, wenn zwei gleiche Vorlagen passen', () => {
    // «Premium» und «Prestige» sind heute Zeichen für Zeichen gleich. Welche
    // der beiden es war, weiss man nicht - was fehlt, aber schon, und darum
    // geht es. Genau dieser Fall ist der, der uns eingeholt hat.
    const prestige = PERMISSION_PRESETS.find((preset) => preset.id === 'prestige')!;
    expect(resolvePreset(prestige).slice().sort()).toEqual(resolvePreset(premium).slice().sort());

    const abweichung = findPresetDrift(resolvePreset(premium).filter((recht) => recht !== 'jail.vote.start'));

    expect(abweichung?.fehlend).toEqual(['jail.vote.start']);
  });

  it('schweigt, wenn die passenden Vorlagen Verschiedenes vermissen', () => {
    // Dann wäre die Empfehlung geraten - und eine geratene Empfehlung zu
    // Berechtigungen ist schlechter als keine.
    const kaumEtwas = ['dashboard.module.view', 'dashboard.view'];

    expect(findPresetDrift(kaumEtwas)).toBeNull();
  });
});
