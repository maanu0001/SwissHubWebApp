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
});
