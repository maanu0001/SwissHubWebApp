import { describe, expect, it } from 'vitest';
import {
  ADMIN_FULL,
  PERMISSION_PRESETS,
  getPermissionPreset,
  matchPreset,
  resolvePreset,
} from '@swisshub/permissions';

// Der Import registriert die Modul-Permissions (z.B. `jail.*`).
await import('@swisshub/modules');

/**
 * Berechtigungs-Vorlagen.
 *
 * Vorlagen dürfen niemals Berechtigungen erzeugen, die es nicht gibt - sonst
 * stünde in der Datenbank eine Berechtigung, die keine Prüfung je auswertet.
 */
describe('Permission Presets', () => {
  it('löst nur registrierte Berechtigungen auf', async () => {
    const { listPermissions } = await import('@swisshub/permissions');
    const known = new Set(listPermissions().map((permission) => permission.key));

    for (const preset of PERMISSION_PRESETS) {
      for (const permission of resolvePreset(preset)) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it('gibt der Vorlage "Nur Lesen" keine ausführenden Rechte', () => {
    const preset = getPermissionPreset('viewer');
    expect(preset).toBeDefined();
    const permissions = resolvePreset(preset!);
    expect(permissions).not.toContain('moderation.execute');
    expect(permissions).not.toContain('jail.create');
    expect(permissions).not.toContain(ADMIN_FULL);
  });

  it('erkennt eine passende Vorlage anhand der Auswahl', () => {
    const preset = getPermissionPreset('moderator')!;
    expect(matchPreset(resolvePreset(preset))?.id).toBe('moderator');
    expect(matchPreset(['dashboard.view'])).toBeUndefined();
  });

  it('bildet Administrator auf Vollzugriff ab', () => {
    expect(resolvePreset(getPermissionPreset('administrator')!)).toEqual([ADMIN_FULL]);
  });

  /**
   * Der Test darueber prueft, dass nichts Unbekanntes herauskommt. Dieser
   * prueft die andere Richtung: dass nichts verlorengeht.
   *
   * Ein Tippfehler in einem Schluessel faellt sonst nirgends auf - die
   * Berechtigung verschwindet beim Aufloesen stillschweigend, und die Rolle
   * bekommt beim Anwenden der Vorlage weniger, als draufsteht.
   */
  it('lässt beim Auflösen keine Berechtigung fallen', () => {
    for (const preset of PERMISSION_PRESETS) {
      if (preset.permissions.includes(ADMIN_FULL)) {
        continue;
      }
      const aufgeloest = resolvePreset(preset);
      const verloren = preset.permissions.filter((key) => !aufgeloest.includes(key));
      expect(verloren, `${preset.id}: unbekannte Berechtigungen ${verloren.join(', ')}`).toEqual([]);
    }
  });

  /**
   * Die Vorlage «Mitglied» ist die einzige, die auf eine Rolle kommt, die
   * jeder auf dem Server traegt. Was hier hineinrutscht, hat damit jeder.
   */
  it('gibt der Vorlage "Mitglied" nichts Verwaltendes', () => {
    const permissions = resolvePreset(getPermissionPreset('mitglied')!);

    expect(permissions).not.toContain(ADMIN_FULL);
    for (const verboten of [
      'members.view',
      'members.view.basic.all',
      'members.view.moderation.all',
      'members.view.notes.all',
      'members.roles.manage',
      'members.notes.create',
      'moderation.view',
      'moderation.execute',
      'jail.create',
      'audit.view',
      'permissions.manage',
      'settings.edit',
      'modules.manage',
      'level.members.manage',
      'premium.subscriptions.manage',
      // Musik und eigene Levelkarte gehoeren auf diesem Server zu Premium.
      'music.view',
      'music.session.start',
      'level.card.custom',
      'tickets.view',
      'tickets.support.view',
      'spielersuche.closeAny',
      'voiceHub.admin.view',
    ]) {
      expect(permissions, `«Mitglied» darf ${verboten} nicht enthalten`).not.toContain(verboten);
    }

    // Und die Gegenprobe: das Alltaegliche muss drin sein, sonst nimmt die
    // Vorlage der Rolle beim Anwenden mehr weg, als sie gibt.
    for (const noetig of [
      'dashboard.view',
      'members.view.basic.own',
      'members.view.level.own',
      'spielersuche.create',
      'tickets.create',
      'tickets.viewOwn',
      'level.view',
      'tournaments.participate',
      'voiceHub.use',
    ]) {
      expect(permissions, `«Mitglied» braucht ${noetig}`).toContain(noetig);
    }
  });

  /**
   * Die Registry fuellt sich erst mit dem Import von `@swisshub/modules`.
   * Wer sie vorher fragt, bekaeme fuer «Mitglied» eine leere Liste - und
   * loeschte damit einer Rolle saemtliche Berechtigungen, ohne eine neue zu
   * vergeben. Das muss knallen statt still durchzugehen.
   */
  it('gibt Premium und Prestige alles, was das Mitglied hat - und Musik dazu', () => {
    const mitglied = resolvePreset(getPermissionPreset('mitglied')!);

    for (const id of ['premium', 'prestige']) {
      const erweitert = resolvePreset(getPermissionPreset(id)!);
      // Nichts vom Alltaeglichen darf fehlen: eine Vorlage ersetzt die
      // Berechtigungen einer Rolle vollstaendig.
      for (const permission of mitglied) {
        expect(erweitert, `${id}: ${permission} fehlt`).toContain(permission);
      }
      expect(erweitert).toContain('music.view');
      expect(erweitert).toContain('music.session.start');
      expect(erweitert).toContain('level.card.custom');
      // Aber weiterhin nichts Verwaltendes.
      expect(erweitert).not.toContain('music.sessions.manageAll');
      expect(erweitert).not.toContain('music.settings.manage');
      expect(erweitert).not.toContain('level.members.manage');
      expect(erweitert).not.toContain(ADMIN_FULL);
    }
  });

  it('scheitert laut, wenn sich eine Vorlage gegen nichts auflösen lässt', () => {
    expect(() =>
      resolvePreset({
        id: 'erfunden',
        label: 'Erfunden',
        description: 'Nur erfundene Berechtigungen.',
        permissions: ['gibt.es.nicht', 'auch.nicht'],
        moderationLevel: 0,
      }),
    ).toThrow(/auflösen/u);
  });
});
