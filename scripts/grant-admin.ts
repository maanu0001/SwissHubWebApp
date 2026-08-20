/**
 * Vollzugriff für eine Discord-Rolle vergeben (Notfall- bzw. Erstzugang).
 *
 *   npm run grant:admin -- <ROLLEN_ID>
 *
 * Nutzt denselben Weg wie die Oberfläche: die Rolle wird als verwaltete Rolle
 * angelegt und erhält die Berechtigung `admin.full`. Der Vorgang wird im Audit
 * Log protokolliert. Zugriff auf die Serverkonsole ist Voraussetzung - über die
 * WebApp lässt sich das bewusst nicht auslösen.
 */
import { EnvironmentError, assertServerEnv } from '@swisshub/config';
import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { ADMIN_FULL, invalidateRoleConfiguration } from '@swisshub/permissions';
import { isSnowflake } from '@swisshub/shared';

async function main(): Promise<void> {
  try {
    assertServerEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const roleId = process.argv[2];
  if (!roleId || !isSnowflake(roleId)) {
    process.stderr.write(
      'Aufruf: npm run grant:admin -- <ROLLEN_ID>\n' +
        '  Die Rollen-ID findest du auf Discord: Servereinstellungen -> Rollen -> Rechtsklick -> ID kopieren\n' +
        '  (Entwicklermodus muss aktiviert sein).\n',
    );
    process.exit(1);
  }

  // Rolle gegen Discord prüfen - so lässt sich keine erfundene ID eintragen.
  const roles = await discord.roles.list({ force: true }).catch(() => null);
  if (!roles) {
    process.stderr.write('Discord ist nicht erreichbar. Bot-Token und Guild-ID prüfen.\n');
    process.exit(1);
  }

  const role = roles.find((entry) => entry.id === roleId);
  if (!role) {
    process.stderr.write(`Die Rolle ${roleId} existiert auf dem konfigurierten Server nicht.\n`);
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.managedRole.upsert({
      where: { discordRoleId: roleId },
      create: {
        discordRoleId: roleId,
        label: role.name,
        isProtected: true,
        moderationLevel: 100,
        notes: 'Über npm run grant:admin angelegt.',
      },
      update: { label: role.name, isProtected: true, moderationLevel: 100 },
    });

    await tx.rolePermission.upsert({
      where: { discordRoleId_permission: { discordRoleId: roleId, permission: ADMIN_FULL } },
      create: { discordRoleId: roleId, permission: ADMIN_FULL, createdBy: 'cli' },
      update: {},
    });
  });

  invalidateRoleConfiguration();

  await recordAudit({
    action: AUDIT_ACTIONS.ROLE_MAPPING_CHANGED,
    module: 'settings',
    actorUsername: 'cli',
    targetLabel: role.name,
    success: true,
    metadata: { discordRoleId: roleId, permissions: [ADMIN_FULL], source: 'grant:admin' },
  }).catch(() => undefined);

  process.stdout.write(
    `Rolle "${role.name}" (${roleId}) hat jetzt Vollzugriff (${ADMIN_FULL}).\n` +
      'Mitglieder mit dieser Rolle können sich anmelden und unter Einstellungen alles Weitere konfigurieren.\n' +
      'Wichtig: die Änderung greift beim nächsten Rollenabruf - Abmelden und erneut anmelden wirkt sofort.\n',
  );

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  process.stderr.write(`Fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
