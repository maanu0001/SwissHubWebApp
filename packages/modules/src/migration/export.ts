import { prisma } from '@swisshub/database';
import { listModuleDefinitions } from '../registry';
import { findeGeheimnisse, MIGRATION_PACKAGE_VERSION, type MigrationPackage } from './package';

/**
 * Die aktuelle Konfiguration als Paket.
 *
 * Gelesen wird ausschliesslich Konfiguration: welche Module laufen und wie
 * sie eingestellt sind, welche Discord-Rolle welche Berechtigungen traegt,
 * welche Automationen es gibt. Kein Ticket, kein Jail, kein Antrag, keine
 * Statistik - Historie gehoert zu der Guild, in der sie entstanden ist, und
 * ein Umzug ist kein Grund, sie zu vervielfaeltigen.
 *
 * Und keine Geheimnisse. Nicht, weil sie herausgefiltert werden, sondern
 * weil sie gar nicht erst gelesen werden: das Paket entsteht aus benannten
 * Feldern, nicht aus einem Abzug der Tabellen. Die Pruefung am Ende ist die
 * zweite Sperre fuer den Fall, dass ein Modul kuenftig eine Einstellung
 * einfuehrt, die dort nicht hingehoert.
 */
export async function erstellePaket(sourceGuild: { id: string; name: string }): Promise<MigrationPackage> {
  const [zustaende, rollen, automationen] = await Promise.all([
    prisma.moduleState.findMany({ orderBy: { moduleId: 'asc' } }),
    prisma.managedRole.findMany({
      orderBy: { label: 'asc' },
      include: { permissions: { select: { permission: true } } },
    }),
    prisma.automation.findMany({
      where: { guildId: sourceGuild.id, archivedAt: null },
      orderBy: { name: 'asc' },
    }),
  ]);

  const bekannt = new Map(listModuleDefinitions().map((definition) => [definition.id, definition]));

  const paket: MigrationPackage = {
    schemaVersion: MIGRATION_PACKAGE_VERSION,
    createdAt: new Date().toISOString(),
    applicationVersion: process.env.npm_package_version ?? '1.0.0',
    sourceGuild: { id: sourceGuild.id, name: sourceGuild.name.slice(0, 200) },

    // Nur Module, die es in dieser Fassung wirklich gibt. Ein Zustand ohne
    // Modul waere ein Rest aus einer aelteren Fassung; ihn mitzunehmen
    // hiesse, ihn im Ziel wiederzubeleben.
    modules: zustaende
      .filter((zustand) => bekannt.has(zustand.moduleId))
      .map((zustand) => ({
        id: zustand.moduleId,
        enabled: zustand.enabled,
        configVersion: zustand.configVersion,
        settings: (zustand.settings ?? {}) as Record<string, unknown>,
      })),

    roles: rollen.map((rolle) => ({
      discordRoleId: rolle.discordRoleId,
      sourceName: rolle.label,
      label: rolle.label,
      isProtected: rolle.isProtected,
      keepOnJail: rolle.keepOnJail,
      moderationLevel: rolle.moderationLevel,
      permissions: rolle.permissions.map((eintrag) => eintrag.permission),
    })),

    automations: automationen.map((eintrag) => ({
      name: eintrag.name,
      description: eintrag.description,
      triggerType: eintrag.triggerType,
      triggerConfig: eintrag.triggerConfig as unknown,
      conditions: (eintrag.conditions ?? null) as unknown,
      steps: eintrag.steps as unknown,
      concurrency: eintrag.concurrency,
      concurrencyKey: eintrag.concurrencyKey,
    })),

    integrations: await integrationsZustand(),
  };

  // Die zweite Sperre. Sie soll nie anschlagen - schlaegt sie an, ist der
  // Aufbau oben falsch und nicht der Filter zu streng.
  const geheim = findeGeheimnisse(paket);
  if (geheim.length > 0) {
    throw new Error(
      `Der Export wurde abgebrochen: die Felder ${geheim.slice(0, 3).join(', ')} sehen nach Zugangsdaten aus.`,
    );
  }

  return paket;
}

/**
 * Welche Integrationen eingerichtet sind - und keine einzige Zugangsangabe.
 *
 * «Der KI-Zugang steht» ist die Auskunft, die beim Umzug hilft: sie sagt,
 * was am Ziel noch zu tun ist. Der Schluessel selbst bleibt, wo er ist.
 */
async function integrationsZustand(): Promise<MigrationPackage['integrations']> {
  // `IntegrationStatus` und ausdruecklich nicht `IntegrationSecret`. Die
  // eine Tabelle traegt den Zustand, die andere den Geheimtext; sie hier
  // auch nur zu lesen waere der erste Schritt dahin, ihn zu exportieren.
  const eintraege = await prisma.integrationStatus
    .findMany({ select: { provider: true, status: true }, orderBy: { provider: 'asc' } })
    .catch(() => []);

  return eintraege.slice(0, 50).map((eintrag) => ({
    id: eintrag.provider.slice(0, 64),
    label: eintrag.provider.slice(0, 200),
    // Der Discord-Zugang haengt an der Guild, alles andere gilt fuer die
    // ganze Installation und muss beim Umzug nicht angefasst werden.
    guildScoped: eintrag.provider === 'discord',
    konfiguriert: eintrag.status !== 'NOT_CONFIGURED',
  }));
}
