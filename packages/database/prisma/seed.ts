/**
 * Initiales Setup.
 *
 * Der Seed erfindet keine Discord-IDs: er übernimmt ausschliesslich die Werte
 * aus der Umgebung (DISCORD_ADMIN_ROLE_ID, DISCORD_JAIL_ROLE_ID) und legt
 * sinnvolle Grundeinstellungen an. Fehlt eine ID, wird eine klare Anleitung
 * ausgegeben statt etwas zu raten.
 */
import { EnvironmentError, assertServerEnv, bootstrapConfig } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { ADMIN_FULL } from '@swisshub/permissions';
import { CORE_SETTINGS_KEY, coreSettingsSchema, jail } from '@swisshub/modules';

const log = createLogger('seed');

async function main(): Promise<void> {
  try {
    assertServerEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      log.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const adminRoleId = bootstrapConfig.adminRoleId;
  const jailRoleId = bootstrapConfig.jailRoleId;

  // 1. Kerneinstellungen anlegen, falls noch nicht vorhanden.
  const existingCore = await prisma.systemConfig.findUnique({ where: { key: CORE_SETTINGS_KEY } });
  if (!existingCore) {
    await prisma.systemConfig.create({
      data: { key: CORE_SETTINGS_KEY, value: coreSettingsSchema.parse({}), updatedBy: 'seed' },
    });
    log.info('Kerneinstellungen angelegt');
  }

  // 2. Administratorrolle inklusive Vollzugriff.
  if (adminRoleId) {
    await prisma.managedRole.upsert({
      where: { discordRoleId: adminRoleId },
      create: {
        discordRoleId: adminRoleId,
        label: 'Administrator',
        isProtected: true,
        moderationLevel: 100,
        notes: 'Aus DISCORD_ADMIN_ROLE_ID übernommen.',
      },
      update: {},
    });
    await prisma.rolePermission.upsert({
      where: { discordRoleId_permission: { discordRoleId: adminRoleId, permission: ADMIN_FULL } },
      create: { discordRoleId: adminRoleId, permission: ADMIN_FULL, createdBy: 'seed' },
      update: {},
    });
    log.info('Administratorrolle konfiguriert', { adminRoleId });
  } else {
    log.warn(
      'DISCORD_ADMIN_ROLE_ID ist nicht gesetzt. Ohne diese Rolle kann sich niemand die ersten Berechtigungen geben.\n' +
        'Bitte auf Discord den Entwicklermodus aktivieren, die Administratorrolle kopieren und in .env eintragen.',
    );
  }

  // 3. Jail-Modul vorbereiten.
  const jailState = await prisma.moduleState.findUnique({ where: { moduleId: jail.JAIL_MODULE_ID } });
  if (!jailState) {
    await prisma.moduleState.create({
      data: {
        moduleId: jail.JAIL_MODULE_ID,
        enabled: true,
        settings: jail.jailSettingsSchema.parse(jailRoleId ? { jailRoleId } : {}),
        updatedBy: 'seed',
      },
    });
    log.info('Jail-Modul vorbereitet', { jailRoleId: jailRoleId ?? 'nicht gesetzt' });
  }

  if (!jailRoleId) {
    log.warn(
      'DISCORD_JAIL_ROLE_ID ist nicht gesetzt. Das Jail-Modul bleibt aktiv, kann aber erst genutzt werden,\n' +
        'sobald in den Einstellungen der WebApp eine Jail-Rolle hinterlegt wurde.',
    );
  }

  log.info('Seed abgeschlossen');
}

main()
  .catch((error: unknown) => {
    log.error('Seed fehlgeschlagen', { error });
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
