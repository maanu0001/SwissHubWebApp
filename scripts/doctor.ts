/**
 * SwissHub Doctor - Diagnose von Konfiguration und Berechtigungen.
 *
 *   npm run doctor                 # Konfiguration, Datenbank, Discord, Bot
 *   npm run doctor -- <DiscordID>  # zusätzlich: warum hat dieser Benutzer (keine) Rechte?
 *
 * Das Skript ändert nichts. Es beantwortet die Frage "warum sehe ich nichts?"
 * ohne Zugriff auf die Oberfläche - genau dann nützlich, wenn niemand mehr
 * hineinkommt.
 */
import { EnvironmentError, assertServerEnv, bootstrapConfig, discordConfig, env } from '@swisshub/config';
import { checkDatabase, prisma } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import {
  hasPermission,
  listPermissions,
  loadRoleConfiguration,
  resolvePermissions,
} from '@swisshub/permissions';
import { readBotStatus } from '@swisshub/modules';
import { formatDateTime, isSnowflake } from '@swisshub/shared';

const OK = '[ ok ]';
const WARN = '[warn]';
const FAIL = '[fail]';

function line(status: string, text: string, hint?: string): void {
  process.stdout.write(`${status} ${text}\n`);
  if (hint) {
    process.stdout.write(`       -> ${hint}\n`);
  }
}

function section(title: string): void {
  process.stdout.write(`\n${title}\n${'-'.repeat(title.length)}\n`);
}

async function main(): Promise<void> {
  process.stdout.write('SwissHub Doctor\n');

  // --- 1. Umgebung ---------------------------------------------------------
  section('Konfiguration');
  try {
    assertServerEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      line(FAIL, 'Umgebungsvariablen unvollständig');
      process.stdout.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
  line(OK, `NODE_ENV=${env.NODE_ENV}, App-URL=${env.NEXT_PUBLIC_APP_URL}`);
  line(
    OK,
    `OAuth Redirect URI: ${discordConfig.redirectUri}`,
    'Muss im Discord Developer Portal exakt so hinterlegt sein.',
  );
  line(OK, `Guild ID: ${discordConfig.guildId}`);

  if (bootstrapConfig.ownerDiscordId) {
    line(OK, `SWISSHUB_OWNER_DISCORD_ID: ${bootstrapConfig.ownerDiscordId}`);
  } else {
    line(
      WARN,
      'SWISSHUB_OWNER_DISCORD_ID ist nicht gesetzt',
      'Ohne Owner-ID bekommst du Rechte ausschliesslich über eine Discord-Rolle.',
    );
  }

  if (bootstrapConfig.adminRoleId) {
    line(OK, `DISCORD_ADMIN_ROLE_ID: ${bootstrapConfig.adminRoleId}`);
  } else {
    line(
      WARN,
      'DISCORD_ADMIN_ROLE_ID ist nicht gesetzt',
      'Dann wird beim Start keine Administratorrolle angelegt.',
    );
  }

  // --- 2. Datenbank --------------------------------------------------------
  section('Datenbank');
  const database = await checkDatabase();
  if (database.ok) {
    line(OK, `Verbindung steht (${database.latencyMs} ms)`);
  } else {
    line(FAIL, 'Keine Verbindung zur Datenbank', 'DATABASE_URL prüfen, läuft PostgreSQL?');
    process.exit(1);
  }

  const configuration = await loadRoleConfiguration(true);
  if (configuration.mappings.length === 0) {
    line(
      FAIL,
      'Es ist keiner Discord-Rolle eine Berechtigung zugeordnet',
      'Beheben mit: npm run grant:admin -- <ROLLEN_ID>   (oder SWISSHUB_OWNER_DISCORD_ID setzen)',
    );
  } else {
    line(OK, `${configuration.mappings.length} Rollen-Zuordnung(en) gespeichert`);
    const byRole = new Map<string, string[]>();
    for (const mapping of configuration.mappings) {
      byRole.set(mapping.discordRoleId, [...(byRole.get(mapping.discordRoleId) ?? []), mapping.permission]);
    }
    for (const [roleId, permissions] of byRole) {
      const label = configuration.roleLabels.get(roleId) ?? 'ohne Bezeichnung';
      process.stdout.write(`       ${roleId} (${label}): ${permissions.join(', ')}\n`);
    }
  }

  // --- 3. Discord ----------------------------------------------------------
  section('Discord');
  let guildOwnerId: string | null = null;
  try {
    const guild = await discord.guild.get();
    guildOwnerId = guild.ownerId;
    line(OK, `Guild erreichbar: ${guild.name} (${guild.approximateMemberCount ?? '?'} Mitglieder)`);
  } catch (error) {
    line(FAIL, 'Guild nicht erreichbar', `Bot-Token/Guild-ID prüfen. Fehler: ${(error as Error).message}`);
  }

  try {
    const identity = await discord.bot.identity();
    const position = await discord.bot.highestRolePosition();
    line(OK, `Bot-Konto: ${identity.username} (${identity.id}), höchste Rollenposition: ${position}`);
    if (position === 0) {
      line(WARN, 'Der Bot besitzt keine eigene Rolle', 'Er kann dann keine Rollen vergeben oder entziehen.');
    }
  } catch (error) {
    line(FAIL, 'Bot-Identität nicht abrufbar', (error as Error).message);
  }

  // --- 4. Bot-Prozess ------------------------------------------------------
  section('Bot-Prozess');
  const bot = await readBotStatus();
  if (bot.online) {
    line(OK, `Online${bot.wsPingMs !== null ? `, Ping ${bot.wsPingMs} ms` : ''}`);
  } else if (bot.lastHeartbeatAt) {
    line(
      WARN,
      `Offline - letzter Heartbeat ${formatDateTime(bot.lastHeartbeatAt)}`,
      'Läuft der Bot-Prozess?',
    );
  } else {
    line(WARN, 'Noch kein Heartbeat empfangen', 'Bot wurde offenbar nie gestartet.');
  }

  // --- 5. Benutzer ---------------------------------------------------------
  const target = process.argv[2];
  if (!target) {
    section('Benutzerprüfung');
    process.stdout.write('Kein Benutzer angegeben. Aufruf mit Discord-ID:\n');
    process.stdout.write('  npm run doctor -- 123456789012345678\n');
    await prisma.$disconnect();
    return;
  }

  section(`Benutzer ${target}`);
  if (!isSnowflake(target)) {
    line(
      FAIL,
      'Das ist keine gültige Discord-ID',
      'Entwicklermodus in Discord aktivieren, dann Rechtsklick auf dich -> ID kopieren.',
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  const member = await discord.members.get(target).catch(() => null);
  if (!member) {
    line(
      FAIL,
      'Kein Mitglied der konfigurierten Guild',
      'Richtige Guild? Richtige Benutzer-ID (nicht die Server-ID)?',
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  line(OK, `Mitglied: ${member.displayName} (@${member.username})`);
  const guildRoles = await discord.roles.list({ force: true }).catch(() => []);
  const roleNames = member.roleIds.map(
    (roleId) => `${guildRoles.find((role) => role.id === roleId)?.name ?? 'unbekannt'} (${roleId})`,
  );
  line(OK, `Discord-Rollen: ${roleNames.length > 0 ? roleNames.join(', ') : 'keine'}`);

  if (guildOwnerId === target) {
    line(
      WARN,
      'Dieses Konto ist Discord-Server-Owner',
      'Server-Ownerschaft allein gibt in SwissHub KEINE Rechte - massgeblich sind Rollen bzw. SWISSHUB_OWNER_DISCORD_ID.',
    );
  }

  const isOwner = bootstrapConfig.ownerDiscordId === target;
  line(
    isOwner ? OK : WARN,
    `SWISSHUB_OWNER_DISCORD_ID trifft zu: ${isOwner ? 'ja' : 'nein'}`,
    isOwner ? undefined : 'Mit gesetzter Owner-ID hätte dieses Konto sofort Vollzugriff.',
  );

  const resolution = resolvePermissions(
    { discordId: target, roleIds: member.roleIds, isOwner },
    configuration.mappings,
  );
  const effective = listPermissions()
    .map((definition) => definition.key)
    .filter((key) => hasPermission(resolution, key));

  if (effective.length === 0) {
    line(FAIL, 'Effektive Berechtigungen: keine');
    process.stdout.write('\nSo bekommst du Zugriff (eine der beiden Varianten genügt):\n');
    process.stdout.write(`  A) In .env setzen:  SWISSHUB_OWNER_DISCORD_ID=${target}\n`);
    process.stdout.write('     danach Dienste neu starten (docker compose up -d bzw. systemctl restart).\n');
    process.stdout.write('  B) Einer deiner Discord-Rollen Vollzugriff geben:\n');
    process.stdout.write('     npm run grant:admin -- <ROLLEN_ID>\n');
    if (member.roleIds.length > 0) {
      process.stdout.write(`     z.B. npm run grant:admin -- ${member.roleIds[0]}\n`);
    } else {
      process.stdout.write(
        '     (dieses Konto trägt aktuell keine Rolle - zuerst auf Discord eine Rolle zuweisen)\n',
      );
    }
  } else {
    line(OK, `Effektive Berechtigungen (${effective.length}): ${effective.join(', ')}`);
  }

  const cache = await prisma.discordIdentityCache.findUnique({ where: { discordId: target } });
  if (cache) {
    line(
      OK,
      `Rollen-Cache: ${cache.roleIds.length} Rolle(n), zuletzt aktualisiert ${formatDateTime(cache.fetchedAt)}`,
      'Nach Rollenänderungen auf Discord kann es bis zu ROLE_CACHE_TTL_SECONDS dauern - Abmelden/Anmelden wirkt sofort.',
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  process.stderr.write(`Doctor fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}\n`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
