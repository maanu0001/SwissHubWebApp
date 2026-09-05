import { prisma, recordAudit, AUDIT_ACTIONS } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { setModuleEnabled, setModuleSettings } from '../module-state';
import { getModuleDefinition } from '../registry';
import { uebersetzeReferenzen } from './referenzen';
import { alsTabelle, type Mappings } from './plan';
import type { MigrationPackage } from './package';

const logger = createLogger('migration:apply');

/**
 * Die Übertragung anwenden.
 *
 * In Phasen und nicht in einer Transaktion. Der Grund ist nicht Bequemlich-
 * keit: eine Übertragung legt Discord-Objekte an, und Discord kennt keine
 * Rücknahme. Eine Transaktion über beides täuschte eine Geschlossenheit vor,
 * die es nicht gibt - fällt sie zurück, sind die Kanäle trotzdem da.
 *
 * Stattdessen: jede Phase für sich, jede idempotent, der Fortschritt nach
 * jeder Phase in der Datenbank. Bricht es ab, steht dort, wie weit es kam,
 * und ein zweiter Anlauf setzt fort, statt von vorn zu beginnen.
 */

export type Phase =
  'PREPARE' | 'SNAPSHOT' | 'APPLY_PERMISSIONS' | 'APPLY_MODULES' | 'IMPORT_AUTOMATIONS' | 'VERIFY';

export const PHASEN: Phase[] = [
  'PREPARE',
  'SNAPSHOT',
  'APPLY_PERMISSIONS',
  'APPLY_MODULES',
  'IMPORT_AUTOMATIONS',
  'VERIFY',
];

export interface PhasenErgebnis {
  phase: Phase;
  ok: boolean;
  detail: string;
  /** Was in dieser Phase geschehen ist - für den Abschlussbericht. */
  eintraege: string[];
}

export interface AnwendungsErgebnis {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  phasen: PhasenErgebnis[];
}

interface Handelnder {
  discordId: string;
  username: string;
}

/**
 * Der Zustand des Ziels, bevor etwas geschieht.
 *
 * Genug, um die Konfiguration zurückzudrehen - nicht mehr. Discord-Objekte
 * stehen nicht darin: was die Übertragung dort anlegt, wird beim Zurück-
 * drehen nicht gelöscht, weil zwischen Anlegen und Rücknahme jemand
 * hineingeschrieben haben kann.
 */
export interface Snapshot {
  erstelltAm: string;
  module: Array<{ moduleId: string; enabled: boolean; settings: unknown }>;
  rollen: Array<{
    discordRoleId: string;
    label: string;
    isProtected: boolean;
    keepOnJail: boolean;
    moderationLevel: number;
    permissions: string[];
  }>;
}

export async function erstelleSnapshot(): Promise<Snapshot> {
  const [zustaende, rollen] = await Promise.all([
    prisma.moduleState.findMany(),
    prisma.managedRole.findMany({ include: { permissions: { select: { permission: true } } } }),
  ]);

  return {
    erstelltAm: new Date().toISOString(),
    module: zustaende.map((zustand) => ({
      moduleId: zustand.moduleId,
      enabled: zustand.enabled,
      settings: zustand.settings,
    })),
    rollen: rollen.map((rolle) => ({
      discordRoleId: rolle.discordRoleId,
      label: rolle.label,
      isProtected: rolle.isProtected,
      keepOnJail: rolle.keepOnJail,
      moderationLevel: rolle.moderationLevel,
      permissions: rolle.permissions.map((eintrag) => eintrag.permission),
    })),
  };
}

/**
 * Die Konfiguration auf den Stand des Snapshots zurückdrehen.
 *
 * Nur, was der Snapshot kennt. Zeilen, die es damals nicht gab, bleiben
 * stehen: sie könnten von der Übertragung stammen, aber ebenso von einem
 * Menschen, der in der Zwischenzeit etwas eingerichtet hat. Löschen wäre die
 * Vermutung, dass niemand sonst gearbeitet hat.
 */
export async function stelleWiederHer(snapshot: Snapshot, actor: Handelnder): Promise<number> {
  let zurueckgedreht = 0;

  for (const modul of snapshot.module) {
    await prisma.moduleState.updateMany({
      where: { moduleId: modul.moduleId },
      data: { enabled: modul.enabled, settings: modul.settings as never, updatedBy: actor.discordId },
    });
    zurueckgedreht += 1;
  }

  for (const rolle of snapshot.rollen) {
    const vorhanden = await prisma.managedRole.findUnique({
      where: { discordRoleId: rolle.discordRoleId },
      select: { id: true },
    });
    if (!vorhanden) {
      continue;
    }
    await prisma.managedRole.update({
      where: { discordRoleId: rolle.discordRoleId },
      data: {
        label: rolle.label,
        isProtected: rolle.isProtected,
        keepOnJail: rolle.keepOnJail,
        moderationLevel: rolle.moderationLevel,
      },
    });
    await prisma.rolePermission.deleteMany({ where: { discordRoleId: rolle.discordRoleId } });
    if (rolle.permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: rolle.permissions.map((permission) => ({
          discordRoleId: rolle.discordRoleId,
          permission,
        })),
        skipDuplicates: true,
      });
    }
    zurueckgedreht += 1;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.MIGRATION_ROLLED_BACK,
    module: 'migration',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: 'Konfiguration zurückgedreht',
    metadata: { eintraege: zurueckgedreht, snapshotVon: snapshot.erstelltAm },
  });

  return zurueckgedreht;
}

/**
 * Alle Phasen der Reihe nach.
 *
 * Bricht eine ab, hören die folgenden auf - was davor lief, bleibt. Genau
 * dafür gibt es `PARTIAL`: ein Ergebnis, kein Zwischenstand.
 */
export async function wendeAn(
  runId: string,
  paket: MigrationPackage,
  mappings: Mappings,
  actor: Handelnder,
  options: { gateway?: DiscordGateway } = {},
): Promise<AnwendungsErgebnis> {
  const gateway = options.gateway ?? defaultDiscord;
  const tabelle = alsTabelle(mappings);
  const phasen: PhasenErgebnis[] = [];

  for (const phase of PHASEN) {
    await prisma.migrationRun.update({ where: { id: runId }, data: { phase } });

    try {
      const ergebnis = await fuehrePhaseAus(phase, runId, paket, tabelle, actor, gateway);
      phasen.push(ergebnis);
      if (!ergebnis.ok) {
        return { status: 'PARTIAL', phasen };
      }
    } catch (fehler) {
      const grund = fehler instanceof Error ? fehler.message : 'Unbekannter Fehler';
      logger.error('Phase der Übertragung gescheitert', { runId, phase, grund });
      phasen.push({ phase, ok: false, detail: grund, eintraege: [] });
      return { status: phasen.length === 1 ? 'FAILED' : 'PARTIAL', phasen };
    }
  }

  return { status: 'COMPLETED', phasen };
}

async function fuehrePhaseAus(
  phase: Phase,
  runId: string,
  paket: MigrationPackage,
  tabelle: { roles: Record<string, string>; channels: Record<string, string> },
  actor: Handelnder,
  gateway: DiscordGateway,
): Promise<PhasenErgebnis> {
  switch (phase) {
    case 'PREPARE': {
      // Ist das Ziel überhaupt noch erreichbar? Lieber hier scheitern als
      // nach der halben Übertragung.
      const guild = await gateway.guild.get().catch(() => null);
      return {
        phase,
        ok: guild !== null,
        detail: guild ? `Ziel erreichbar: ${guild.name}` : 'Die Ziel-Guild ist nicht erreichbar.',
        eintraege: [],
      };
    }

    case 'SNAPSHOT': {
      const snapshot = await erstelleSnapshot();
      await prisma.migrationRun.update({
        where: { id: runId },
        data: { snapshot: snapshot as never },
      });
      return {
        phase,
        ok: true,
        detail: `Zustand gesichert: ${snapshot.module.length} Module, ${snapshot.rollen.length} Rollen`,
        eintraege: [],
      };
    }

    case 'APPLY_PERMISSIONS':
      return uebertrageRollen(paket, tabelle, actor);

    case 'APPLY_MODULES':
      return uebertrageModule(paket, tabelle, actor);

    case 'IMPORT_AUTOMATIONS':
      return importiereAutomationen(paket, actor);

    case 'VERIFY': {
      const offen = paket.modules.filter((modul) => !getModuleDefinition(modul.id)).length;
      return {
        phase,
        ok: true,
        detail:
          offen === 0 ? 'Alles übernommen.' : `${offen} Modul(e) übersprungen - in dieser Fassung unbekannt.`,
        eintraege: [],
      };
    }
  }
}

/**
 * Berechtigungen je Rolle.
 *
 * `upsert` statt `create`: ein zweiter Anlauf soll dieselbe Rolle nicht ein
 * zweites Mal anlegen. Die Rechte werden ersetzt und nicht ergänzt - sonst
 * sammelte sich bei jedem Durchgang mehr an, als in der Quelle je stand.
 */
async function uebertrageRollen(
  paket: MigrationPackage,
  tabelle: { roles: Record<string, string> },
  actor: Handelnder,
): Promise<PhasenErgebnis> {
  const eintraege: string[] = [];

  for (const rolle of paket.roles) {
    const zielRolle = tabelle.roles[rolle.discordRoleId];
    if (!zielRolle) {
      eintraege.push(`${rolle.label}: übersprungen (keine Zuordnung)`);
      continue;
    }

    await prisma.managedRole.upsert({
      where: { discordRoleId: zielRolle },
      create: {
        discordRoleId: zielRolle,
        label: rolle.label,
        isProtected: rolle.isProtected,
        keepOnJail: rolle.keepOnJail,
        moderationLevel: rolle.moderationLevel,
      },
      update: {
        label: rolle.label,
        isProtected: rolle.isProtected,
        keepOnJail: rolle.keepOnJail,
        moderationLevel: rolle.moderationLevel,
      },
    });

    // Ersetzen statt ergaenzen: sonst sammelte sich bei jedem Anlauf mehr
    // an, als in der Quelle je stand.
    await prisma.rolePermission.deleteMany({ where: { discordRoleId: zielRolle } });
    if (rolle.permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: rolle.permissions.map((permission) => ({ discordRoleId: zielRolle, permission })),
        skipDuplicates: true,
      });
    }
    eintraege.push(`${rolle.label}: ${rolle.permissions.length} Rechte`);
  }

  await recordAudit({
    action: AUDIT_ACTIONS.MIGRATION_APPLIED,
    module: 'migration',
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: 'Berechtigungen übertragen',
    metadata: { rollen: eintraege.length },
  });

  return { phase: 'APPLY_PERMISSIONS', ok: true, detail: `${eintraege.length} Rolle(n)`, eintraege };
}

/**
 * Moduleinstellungen.
 *
 * Geschrieben wird über `setModuleSettings`, nicht über einen eigenen Weg in
 * die Tabelle. Das ist der Punkt: dort läuft das Zod-Schema des Moduls, und
 * damit kommt aus einem Paket nur an, was das Modul selbst als Einstellung
 * kennt. Ein Feld, das jemand in die Datei geschrieben hat, wird abgewiesen -
 * ohne dass die Übertragung wissen müsste, welche Felder es gibt.
 */
async function uebertrageModule(
  paket: MigrationPackage,
  tabelle: { roles: Record<string, string>; channels: Record<string, string> },
  actor: Handelnder,
): Promise<PhasenErgebnis> {
  const eintraege: string[] = [];

  for (const modul of paket.modules) {
    const definition = getModuleDefinition(modul.id);
    if (!definition) {
      eintraege.push(`${modul.id}: übersprungen (unbekannt)`);
      continue;
    }

    if (definition.settingsSchema) {
      const { settings } = uebersetzeReferenzen(modul.id, modul.settings, tabelle);
      try {
        await setModuleSettings(modul.id, settings, actor.discordId);
        eintraege.push(`${definition.name}: Einstellungen übernommen`);
      } catch (fehler) {
        // Ein Modul, dessen Einstellungen nicht passen, hält die Übertragung
        // nicht auf - es steht im Bericht, und die übrigen laufen weiter.
        eintraege.push(
          `${definition.name}: Einstellungen abgewiesen (${fehler instanceof Error ? fehler.message.slice(0, 120) : 'unbekannt'})`,
        );
      }
    }

    await setModuleEnabled(modul.id, modul.enabled, actor.discordId);
  }

  return { phase: 'APPLY_MODULES', ok: true, detail: `${eintraege.length} Modul(e)`, eintraege };
}

/**
 * Automationen - ausgeschaltet.
 *
 * Immer, ohne Ausnahme und ohne Schalter dafür. Eine Automation des
 * Testservers, die nach dem Import sofort läuft, schreibt in Kanäle eines
 * öffentlichen Servers, bevor irgendwer sie gelesen hat. Wer sie will,
 * schaltet sie einzeln ein - das ist der Moment, in dem jemand hinsieht.
 *
 * Wiedererkannt wird an Name und Guild: ein zweiter Anlauf legt dieselbe
 * Automation nicht noch einmal an.
 */
async function importiereAutomationen(paket: MigrationPackage, actor: Handelnder): Promise<PhasenErgebnis> {
  const eintraege: string[] = [];
  const guildId = await aktuelleGuild();

  for (const automation of paket.automations) {
    const vorhanden = await prisma.automation.findFirst({
      where: { guildId, name: automation.name, archivedAt: null },
      select: { id: true },
    });

    if (vorhanden) {
      eintraege.push(`${automation.name}: bereits vorhanden`);
      continue;
    }

    await prisma.automation.create({
      data: {
        guildId,
        name: automation.name,
        description: automation.description,
        // Ausgeschaltet. Siehe oben.
        enabled: false,
        triggerType: automation.triggerType,
        triggerConfig: automation.triggerConfig as never,
        conditions: (automation.conditions ?? undefined) as never,
        steps: automation.steps as never,
        // Weggelassen statt `null`: das Feld hat eine Vorgabe im Schema, und
        // `null` waere keine Angabe, sondern ein ungueltiger Wert.
        ...(automation.concurrency ? { concurrency: automation.concurrency as never } : {}),
        concurrencyKey: automation.concurrencyKey,
        createdBy: actor.discordId,
      } as never,
    });
    eintraege.push(`${automation.name}: importiert (ausgeschaltet)`);
  }

  return { phase: 'IMPORT_AUTOMATIONS', ok: true, detail: `${eintraege.length} Automation(en)`, eintraege };
}

async function aktuelleGuild(): Promise<string> {
  const { resolveGuildId } = await import('@swisshub/discord');
  return resolveGuildId();
}
