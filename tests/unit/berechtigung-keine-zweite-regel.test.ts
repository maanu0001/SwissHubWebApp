import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { communication } from '@swisshub/modules';

/**
 * Wo eine Ausnahme sonst noch untergehen koennte.
 *
 * Die Engine entscheidet richtig - aber sie entscheidet nur dort, wo man sie
 * fragt. An mehreren Stellen stand danach noch ein eigenes
 * `includes('admin.full')` oder eine eigene Wildcard-Aufloesung. Die waren
 * frueher harmlos (sie kamen zum selben Ergebnis) und sind es jetzt nicht
 * mehr: sie geben zurueck, was die Ausnahme gerade weggenommen hat.
 *
 * Diese Tests halten die Stellen fest. Sie pruefen nicht, dass etwas
 * funktioniert, sondern dass eine zweite Regel nicht wieder entsteht.
 */

const lies = (pfad: string): string => readFileSync(join(process.cwd(), pfad), 'utf8');

/** Quelltext ohne Kommentare - sonst trifft eine Zusicherung die Erklaerung. */
const ohneKommentare = (quelle: string): string =>
  quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Erwaehnungen fragen nicht selbst nach Vollzugriff', () => {
  const settings = communication.communicationSettingsSchema.parse({});

  const handelnder = (permissionKeys: string[]) => ({
    discordId: '900000000000004001',
    username: 'test',
    permissionKeys,
    isOwner: false,
  });

  it('erlaubt eine Rollen-Erwaehnung mit der Berechtigung', () => {
    const warnungen: string[] = [];
    const mention = communication.resolveMention(
      { type: 'role', target: '900000000000004010' },
      handelnder(['communication.mention']),
      settings,
      warnungen,
    );

    expect(mention).toEqual({ kind: 'role', roleId: '900000000000004010' });
    expect(warnungen).toHaveLength(0);
  });

  it('verweigert sie, wenn die aufgeloeste Liste sie nicht enthaelt - trotz admin.full', () => {
    // Genau der Fall aus §35: Vollzugriff mit einer Ausnahme auf
    // `communication.mention`. Die Engine hat den Schluessel entfernt,
    // `admin.full` steht weiterhin drin. Wer hier nochmals selbst nach
    // `admin.full` fragte, gaebe die Erwaehnung zurueck.
    const warnungen: string[] = [];
    const mention = communication.resolveMention(
      { type: 'role', target: '900000000000004010' },
      handelnder(['admin.full']),
      settings,
      warnungen,
    );

    expect(mention).toBeNull();
    expect(warnungen.join(' ')).toContain('Berechtigung');
  });

  it('trennt @everyone weiterhin von der gewoehnlichen Erwaehnung', () => {
    const warnungen: string[] = [];
    const mention = communication.resolveMention(
      { type: 'everyone' },
      handelnder(['communication.mention']),
      settings,
      warnungen,
    );

    expect(mention).toBeNull();
    expect(warnungen.join(' ')).toContain('@everyone');
  });
});

describe('Die Oberflaeche loest Wildcards nicht ein zweites Mal auf', () => {
  it('prueft im PermissionGuard nur die aufgeloeste Liste', () => {
    const quelle = ohneKommentare(lies('apps/web/src/components/shared/permission-guard.tsx'));

    expect(quelle).not.toContain("owned.has('admin.full')");
    expect(quelle).not.toContain('.split(');
    expect(quelle).toContain('owned.has(permission)');
  });

  it('prueft die Mitgliedersuche in der Kopfzeile ohne Vollzugriff-Sonderfall', () => {
    const quelle = ohneKommentare(lies('apps/web/src/components/layout/app-shell.tsx'));

    expect(quelle).not.toContain("permissions.includes('admin.full')");
    expect(quelle).toContain("permissions.includes('members.view')");
  });

  it('warnt im Automations-Baukasten anhand der aufgeloesten Liste', () => {
    const quelle = ohneKommentare(lies('apps/web/src/modules/automation/components/builder.tsx'));

    expect(quelle).not.toContain("eigeneRechte.includes('admin.full')");
    expect(quelle).toContain('eigeneRechte.includes(definition.requiredPermission)');
  });

  it('gibt dem Bot dieselbe aufgeloeste Liste wie dem Dashboard', () => {
    const quelle = ohneKommentare(lies('apps/bot/src/commands/context.ts'));

    expect(quelle).not.toContain('permissionKeys: [...resolution.granted]');
    expect(quelle).toContain('expandPermissions(');
  });
});

describe('Der Einrichtungszugang fragt die Engine', () => {
  it('kennt in `hasSetupAccess` keinen eigenen Vollzugriff-Zweig', () => {
    const quelle = ohneKommentare(lies('apps/web/src/server/auth.ts'));

    expect(quelle).not.toContain("can(context, 'admin.full')");
    expect(quelle).toContain("can(context, 'settings.edit')");
  });

  it('kennt in `assertSetupAccess` keinen eigenen Vollzugriff-Zweig', () => {
    const quelle = ohneKommentare(lies('apps/web/src/modules/configuration/actions.ts'));

    expect(quelle).not.toContain("permissionKeys.includes('admin.full')");
    expect(quelle).toContain("permissionKeys.includes('settings.edit')");
  });
});

describe('Owner heisst System-Owner', () => {
  it('leitet den Handelnden der Verifikation nicht mehr aus admin.full ab', () => {
    const quelle = ohneKommentare(lies('apps/web/src/modules/verification/actions.ts'));

    expect(quelle).not.toContain("ctx.permissionKeys.includes('admin.full')");
    expect(quelle).toContain('isOwner: ctx.user.isOwner');
  });

  it('prueft den Owner in der Engine vor jeder Ausnahme', () => {
    const quelle = lies('packages/permissions/src/engine.ts');
    const funktion = quelle.slice(quelle.indexOf('export function hasPermission'));

    // Die Reihenfolge ist die Zusicherung: waere die Ausnahme zuerst dran,
    // liesse sich der Notzugang ueber die Oberflaeche entziehen.
    expect(funktion.indexOf('resolution.isOwner')).toBeLessThan(
      funktion.indexOf('matches(resolution.denied'),
    );
  });
});

describe('Die Speicheraktion nimmt Ausnahmen entgegen und prueft sie', () => {
  const quelle = lies('apps/web/src/modules/configuration/actions.ts');

  it('kennt eine eigene Liste fuer Ausnahmen', () => {
    expect(quelle).toContain('deniedPermissions: z.array(z.string().max(64))');
  });

  it('weist unbekannte Schluessel in beiden Listen ab', () => {
    expect(quelle).toContain('[...input.permissions, ...input.deniedPermissions].filter');
    expect(quelle).toContain('isKnownPermission(permission)');
  });

  it('weist denselben Schluessel in beiden Listen ab', () => {
    expect(quelle).toContain('Gleichzeitig erlaubt und verweigert');
  });

  it('reicht die Ausnahmen an den Aussperrschutz weiter', () => {
    expect(quelle).toContain('checkLockout(input.discordRoleId, input.permissions, input.deniedPermissions)');
  });

  it('schreibt die Wirkung auch beim Aktualisieren mit', () => {
    expect(quelle).toContain('update: { effect }');
  });
});
