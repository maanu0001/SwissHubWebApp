import { AUDIT_ACTIONS, bumpConfigRevision, prisma, safeRecordAudit } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { getModuleDefinition, type ModuleDefinition } from '../registry';
import { listCachedChannels, listCachedRoles } from '../discord/sync';
import { isChannelField, isRoleField, type SettingsField } from './fields';

const log = createLogger('settings');

/**
 * Zentrale Settings-Schreiblogik.
 *
 * Ablauf jeder Änderung: Zod-Validierung -> Prüfung gegen den echten
 * Discord-Zustand -> Speichern -> Audit Log mit Vorher/Nachher -> Revision
 * erhöhen (damit Bot und WebApp die neue Konfiguration sofort verwenden).
 */
export interface SettingsIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationContext {
  /** Höchste Rollenposition des Bots - für die Hierarchieprüfung. */
  botHighestPosition: number;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

/**
 * Prüft Rollen- und Channel-Referenzen gegen den synchronisierten
 * Discord-Zustand. Fehler verhindern das Speichern, Warnungen nicht.
 */
export async function validateAgainstDiscord(
  fields: readonly SettingsField[],
  values: Record<string, unknown>,
  context?: Partial<ValidationContext>,
): Promise<SettingsIssue[]> {
  const issues: SettingsIssue[] = [];
  const needsRoles = fields.some(isRoleField);
  const needsChannels = fields.some(isChannelField);

  const [roles, channels, botPosition] = await Promise.all([
    needsRoles ? listCachedRoles({ includeDeleted: true }) : Promise.resolve([]),
    needsChannels ? listCachedChannels({ includeDeleted: true }) : Promise.resolve([]),
    context?.botHighestPosition !== undefined
      ? Promise.resolve(context.botHighestPosition)
      : discord.bot.highestRolePosition().catch(() => 0),
  ]);

  for (const field of fields) {
    const selected = asStringList(values[field.key]);

    if (field.required && selected.length === 0) {
      issues.push({ field: field.key, message: `${field.label} muss gesetzt sein.`, severity: 'error' });
      continue;
    }

    if (isRoleField(field)) {
      for (const roleId of selected) {
        const role = roles.find((entry) => entry.id === roleId);
        if (!role || role.deleted) {
          issues.push({
            field: field.key,
            message: `Die gewählte Rolle existiert auf Discord nicht mehr (${roleId}).`,
            severity: 'error',
          });
          continue;
        }
        if (field.mustBeManageable) {
          if (role.managed) {
            issues.push({
              field: field.key,
              message: `"${role.name}" wird von Discord verwaltet und kann vom Bot nicht vergeben werden.`,
              severity: 'error',
            });
          } else if (botPosition > 0 && role.position >= botPosition) {
            issues.push({
              field: field.key,
              message: `"${role.name}" liegt auf oder über der Bot-Rolle. Bitte die Bot-Rolle auf Discord höher einordnen.`,
              severity: 'error',
            });
          }
        }
      }
    }

    if (isChannelField(field)) {
      for (const channelId of selected) {
        const channel = channels.find((entry) => entry.id === channelId);
        if (!channel || channel.deleted) {
          issues.push({
            field: field.key,
            message: `Der gewählte Channel existiert auf Discord nicht mehr (${channelId}).`,
            severity: 'error',
          });
          continue;
        }
        if (field.channelKinds && (channel.kind === null || !field.channelKinds.includes(channel.kind))) {
          issues.push({
            field: field.key,
            message: `"#${channel.name}" ist nicht der erwartete Channel-Typ.`,
            severity: 'error',
          });
        }
      }
    }
  }

  return issues;
}

function requireModule(moduleId: string): ModuleDefinition {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Modul existiert nicht.' });
  }
  if (!definition.settingsSchema) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Das Modul "${definition.name}" besitzt keine Einstellungen.`,
    });
  }
  return definition;
}

/** Aktuelle Einstellungen eines Moduls (validiert, mit Defaults). */
export async function readModuleSettings<T>(moduleId: string): Promise<T> {
  const definition = getModuleDefinition(moduleId);
  if (!definition?.settingsSchema) {
    return {} as T;
  }
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  const parsed = definition.settingsSchema.safeParse(row?.settings ?? {});
  if (!parsed.success) {
    log.warn('Ungültige Moduleinstellungen - Defaults werden verwendet', { moduleId });
    return definition.settingsSchema.parse({}) as T;
  }
  return parsed.data as T;
}

export interface WriteSettingsResult<T> {
  settings: T;
  warnings: SettingsIssue[];
}

/**
 * Speichert Moduleinstellungen.
 *
 * Wirft `VALIDATION_FAILED`, wenn Zod oder die Discord-Prüfung fehlschlagen -
 * es wird in dem Fall nichts geschrieben (Safe Save).
 */
export async function writeModuleSettings<T>(
  moduleId: string,
  values: unknown,
  actor: { discordId: string; username: string },
): Promise<WriteSettingsResult<T>> {
  const definition = requireModule(moduleId);
  const parsed = definition.settingsSchema!.safeParse(values);

  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Einstellungen sind ungültig.',
      details: {
        fieldErrors: Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]),
        ),
      },
    });
  }

  const issues = await validateAgainstDiscord(definition.settingsFields ?? [], parsed.data);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: errors[0]?.message ?? 'Die Einstellungen konnten nicht gespeichert werden.',
      details: { fieldErrors: Object.fromEntries(errors.map((issue) => [issue.field, issue.message])) },
    });
  }

  const before = await prisma.moduleState.findUnique({ where: { moduleId }, select: { settings: true } });

  await prisma.moduleState.upsert({
    where: { moduleId },
    create: {
      moduleId,
      enabled: definition.defaultEnabled,
      settings: parsed.data,
      configVersion: definition.configVersion ?? 1,
      updatedBy: actor.discordId,
    },
    update: {
      settings: parsed.data,
      configVersion: definition.configVersion ?? 1,
      updatedBy: actor.discordId,
    },
  });

  await bumpConfigRevision(`module.${moduleId}.settings`, actor.discordId);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MODULE_SETTINGS_CHANGED,
    module: moduleId,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: {
      before: (before?.settings as Record<string, unknown> | undefined) ?? {},
      after: parsed.data as Record<string, unknown>,
      changed: changedKeys(before?.settings, parsed.data),
    },
  });

  log.info('Moduleinstellungen gespeichert', { moduleId, by: actor.discordId });
  return {
    settings: parsed.data as T,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  };
}

/** Feldnamen, die sich tatsächlich geändert haben - für lesbare Audit-Einträge. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const previous = (before ?? {}) as Record<string, unknown>;
  const next = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
}
