import { discord } from '@swisshub/discord';
import { getGuildConfig } from '../guild/config';
import { inspectBotPermissions } from '../discord/inspector';
import { listCachedChannels, listCachedRoles } from '../discord/sync';
import { listModuleStatus } from '../module-state';
import { worstStatus, type HealthStatus, type ModuleHealthContext, type ModuleHealthReport } from './types';

/**
 * Systemgesundheit.
 *
 * Fasst zusammen, was für den Betrieb noch fehlt - jede Aussage mit einem Link,
 * der direkt zur passenden Einstellung führt ("Quick Fix"). Der
 * Fertigstellungsgrad zeigt, wie weit die Einrichtung ist.
 */
export interface SetupStep {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href: string;
  /** Ohne diesen Schritt funktioniert die Anwendung nicht. */
  required: boolean;
}

export interface SystemHealthReport {
  /** Fertigstellungsgrad der Einrichtung in Prozent (0-100). */
  completeness: number;
  status: HealthStatus;
  setupComplete: boolean;
  guildConnected: boolean;
  steps: SetupStep[];
  modules: ModuleHealthReport[];
  bot: {
    available: boolean;
    missing: string[];
    hierarchyOk: boolean;
  };
}

/** Kontext für die Modulprüfungen (einmal laden, an alle Module weitergeben). */
export async function buildHealthContext(): Promise<ModuleHealthContext> {
  const [roles, channels, botPosition] = await Promise.all([
    listCachedRoles({ includeDeleted: true }).catch(() => []),
    listCachedChannels({ includeDeleted: true }).catch(() => []),
    discord.bot.highestRolePosition().catch(() => 0),
  ]);

  return {
    roles,
    channels,
    botHighestPosition: botPosition,
    discordAvailable: roles.length > 0,
  };
}

/** Gesundheitsberichte aller Module (auch deaktivierter - für die Übersicht). */
export async function getModuleHealth(context?: ModuleHealthContext): Promise<ModuleHealthReport[]> {
  const ctx = context ?? (await buildHealthContext());
  const entries = await listModuleStatus();

  return Promise.all(
    entries.map(async (entry): Promise<ModuleHealthReport> => {
      const settingsHref = entry.definition.settingsFields?.length ? `/modules/${entry.definition.id}` : null;

      if (!entry.enabled || !entry.definition.healthChecks) {
        return {
          moduleId: entry.definition.id,
          moduleName: entry.definition.name,
          enabled: entry.enabled,
          status: 'ok',
          checks: [],
          settingsHref,
        };
      }

      const checks = await entry.definition.healthChecks(ctx).catch(() => []);
      return {
        moduleId: entry.definition.id,
        moduleName: entry.definition.name,
        enabled: entry.enabled,
        status: worstStatus(checks),
        checks,
        settingsHref,
      };
    }),
  );
}

/** Gesamtbild: Einrichtung, Bot-Rechte und Modulzustand. */
export async function getSystemHealth(): Promise<SystemHealthReport> {
  const context = await buildHealthContext();
  const [guild, permissions, modules] = await Promise.all([
    getGuildConfig(),
    inspectBotPermissions().catch(() => null),
    getModuleHealth(context),
  ]);

  const hierarchyOk = context.botHighestPosition > 0;
  const missing = permissions?.missing ?? [];

  const steps: SetupStep[] = [
    {
      id: 'guild',
      label: 'Discord-Server verbunden',
      description: 'Der Server, den diese Anwendung verwaltet.',
      done: guild.guildId !== null,
      href: '/setup',
      required: true,
    },
    {
      id: 'sync',
      label: 'Rollen und Channels synchronisiert',
      description: 'Grundlage für alle Auswahllisten im Dashboard.',
      done: guild.lastSyncedAt !== null && context.roles.length > 0,
      href: '/system/discord',
      required: true,
    },
    {
      id: 'bot-permissions',
      label: 'Bot-Berechtigungen vollständig',
      description: 'Der Bot besitzt alle Rechte, die die aktivierten Module brauchen.',
      done: permissions?.available === true && missing.length === 0,
      href: '/system/bot',
      required: true,
    },
    {
      id: 'hierarchy',
      label: 'Bot-Rolle richtig einsortiert',
      description: 'Die Bot-Rolle muss über den verwalteten Rollen stehen.',
      done: hierarchyOk,
      href: '/server/roles',
      required: true,
    },
    {
      id: 'permissions',
      label: 'Dashboard-Berechtigungen vergeben',
      description: 'Mindestens eine Discord-Rolle darf das Dashboard verwenden.',
      done: await hasAnyRoleMapping(),
      href: '/server/permissions',
      required: true,
    },
    {
      id: 'modules',
      label: 'Module konfiguriert',
      description: 'Alle aktivierten Module sind vollständig eingerichtet.',
      done: modules.every((module) => module.status !== 'error'),
      href: '/modules',
      required: false,
    },
    {
      id: 'setup',
      label: 'Einrichtung abgeschlossen',
      description: 'Der Einrichtungsassistent wurde bestätigt.',
      done: guild.setupCompletedAt !== null,
      href: '/setup',
      required: false,
    },
  ];

  const completeness = Math.round((steps.filter((step) => step.done).length / steps.length) * 100);
  const requiredOpen = steps.filter((step) => step.required && !step.done);
  const status: HealthStatus =
    requiredOpen.length > 0
      ? 'error'
      : steps.some((step) => !step.done) || modules.some((module) => module.status !== 'ok')
        ? 'warning'
        : 'ok';

  return {
    completeness,
    status,
    setupComplete: guild.setupCompletedAt !== null,
    guildConnected: guild.guildId !== null,
    steps,
    modules,
    bot: {
      available: permissions?.available ?? false,
      missing,
      hierarchyOk,
    },
  };
}

async function hasAnyRoleMapping(): Promise<boolean> {
  const { countRolePermissionMappings } = await import('@swisshub/permissions');
  return (await countRolePermissionMappings().catch(() => 0)) > 0;
}
