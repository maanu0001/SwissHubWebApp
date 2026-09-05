import { registerPermissions, type PermissionDefinition } from '@swisshub/permissions';
import type { DiscordPermissionName } from '@swisshub/discord';
import type { z } from 'zod';
import type { SettingsField } from './settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from './health/types';

/**
 * Module Registry.
 *
 * Ein Modul beschreibt sich vollständig selbst: Permissions, Navigation,
 * Einstellungen. Navigation, Dashboard und die Berechtigungsverwaltung werden
 * daraus generiert - ein neues Modul erfordert deshalb keine Änderung an der
 * Kernanwendung (siehe docs/MODULES.md).
 */

/** Abschnitte der Seitenleiste (Reihenfolge = Anzeigereihenfolge). */
export const NAVIGATION_GROUPS = [
  { id: 'overview', label: null },
  { id: 'server', label: 'Server' },
  { id: 'modules', label: 'Module' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'system', label: 'System' },
] as const;

export type NavigationGroupId = (typeof NAVIGATION_GROUPS)[number]['id'];

export interface ModuleNavigationItem {
  href: string;
  label: string;
  /** Kurztext unter dem Seitentitel. */
  description?: string;
  /** Sichtbar, wenn der Benutzer diese Permission besitzt. */
  permission: string;
  /**
   * Weitere Berechtigungen, die den Eintrag ebenfalls sichtbar machen.
   *
   * Gebraucht, wo ein Bereich mehrere Zugaenge hat: den Jail-Bereich sieht,
   * wer Jails einsehen darf - und ebenso, wer eine Community-Abstimmung
   * starten darf, ohne deswegen die Strafakte lesen zu koennen. Ohne diese
   * Moeglichkeit braeuchte es fuer den zweiten Zugang einen eigenen
   * Seitenleisten-Eintrag, und genau den soll es nicht geben.
   */
  altPermissions?: string[];
  /**
   * Ausweich-Eintraege, wenn die Hauptberechtigung fehlt.
   *
   * `altPermissions` macht denselben Eintrag fuer mehrere Berechtigungen
   * sichtbar - richtig, wo alle auf dieselbe Seite duerfen. Beim Jail ist es
   * anders: wer nur Abstimmungen starten darf, sieht dort «Jail», landet auf
   * der Uebersicht und bekommt eine 403-Seite. Der Eintrag zeigte auf etwas,
   * das er nicht oeffnen darf.
   *
   * Ein Ausweich-Eintrag fuehrt ihn stattdessen direkt dorthin, wo er
   * hindarf - unter passender Beschriftung. Geprueft wird der Reihe nach,
   * und nur, wenn die Hauptberechtigung fehlt: wer beides hat, sieht den
   * Hauptbereich und keinen zweiten Eintrag daneben.
   *
   * Das gewaehrt keine Rechte. Es entscheidet nur, wohin ein Eintrag zeigt;
   * die Seite selbst prueft weiterhin serverseitig.
   */
  alternatives?: Array<{
    permission: string;
    href: string;
    label: string;
    description?: string;
    icon?: string;
  }>;
  /** Lucide Icon Name (siehe `nav-icon.tsx`). */
  icon: string;
  /**
   * Weiterer Pfad, dessen Unterseiten diesen Titel tragen sollen.
   *
   * Normalerweise ist der Navigationspfad zugleich die Wurzel des Moduls, und
   * die Kopfzeile findet den Titel fuer jede Unterseite ueber diesen Praefix.
   * Bei Premium ist das anders: die Wurzel `/premium` ist die oeffentliche
   * Shop-Seite ausserhalb des geschuetzten Bereichs, waehrend die Verwaltung
   * unter `/premium/...` liegt. Ohne diese Angabe faenden die Unterseiten
   * keinen Titel und die Kopfzeile zeigte nur "SwissHub".
   */
  titlePrefix?: string;
  /** Abschnitt in der Seitenleiste. */
  group: NavigationGroupId;
  order: number;
  /** Statisches Label rechts im Navigationseintrag, z.B. `NEU`. */
  badge?: string;
  /**
   * Bedingung, die zusaetzlich zur Berechtigung erfuellt sein muss.
   *
   * Die Registry selbst fragt keine Datenbank - sie wird an vielen Stellen
   * geladen, auch dort, wo keine Verbindung steht. Die Auswertung geschieht
   * deshalb im Layout, das die Daten ohnehin holt; hier steht nur, worauf es
   * ankommt.
   */
  visibleWhen?: 'activeRaffle';
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  /** Lucide Icon Name, z.B. `Lock`. */
  icon: string;
  /** Präfix sämtlicher Permissions dieses Moduls, z.B. `jail`. */
  permissionPrefix: string;
  permissions: PermissionDefinition[];
  navigation: ModuleNavigationItem[];
  /** Kernbereiche können nicht deaktiviert werden. */
  core?: boolean;
  defaultEnabled: boolean;
  /** Zod-Schema der Moduleinstellungen (optional). */
  settingsSchema?: z.ZodTypeAny;
  /**
   * Beschreibung der Einstellungen für die generische Oberfläche.
   * Daraus entsteht die Settings-Seite - inklusive Rollen- und Channel-Auswahl.
   */
  settingsFields?: SettingsField[];
  /** Schema-Version der Einstellungen (für spätere Migrationen). */
  configVersion?: number;
  /** Discord-Berechtigungen, die der Bot für dieses Modul benötigt. */
  requiredDiscordPermissions?: DiscordPermissionName[];
  /** Zusätzliche Prüfungen für die Modul-Gesundheit (siehe `health.ts`). */
  healthChecks?: (context: ModuleHealthContext) => Promise<ModuleHealthCheck[]>;
  /**
   * Läuft, nachdem das Modul eingeschaltet wurde.
   *
   * Für Startwerte, ohne die ein Modul nach dem Einschalten leer dastünde.
   * Muss idempotent sein: das Modul lässt sich beliebig oft aus- und wieder
   * einschalten, und ein Fehler hier darf das Einschalten nicht verhindern.
   */
  onEnable?: () => Promise<void>;
  /** Sehr kurzer Text für Modulkacheln (Dashboard). */
  tagline?: string;
  /** Kurzbeschreibung des Status für die Modulkarte. */
  badge?: string;
}

const modules = new Map<string, ModuleDefinition>();

/**
 * «Modul sehen».
 *
 * Der eine Schluessel, der entscheidet, ob ein Bereich in der Seitenleiste
 * ueberhaupt erscheint und ob seine Seiten sich oeffnen lassen. Er wird nicht
 * von den Modulen einzeln gepflegt, sondern hier aus dem Praefix abgeleitet:
 * ein Modul, das ihn vergisst, waere fuer niemanden sichtbar, und ein Modul,
 * das ihn anders benennt, waere die Ausnahme, die die Regel wertlos macht.
 *
 * Er folgt dem bestehenden Schema `<praefix>.<aktion>` und faellt damit unter
 * die vorhandene Wildcard-Semantik: `music.*` schliesst `music.module.view`
 * ein, `admin.full` ohnehin alles.
 *
 * Bewusst nicht `<praefix>.view`: der Schluessel gibt es an vielen Stellen
 * schon, und er bedeutet dort mal «Bereich oeffnen» und mal «diese Daten
 * lesen». Beim Jail heisst `jail.view` «Strafakte einsehen» - wer nur eine
 * Abstimmung starten darf, soll den Bereich sehen, ohne die Akte lesen zu
 * duerfen. Ein zweiter, eindeutiger Schluessel trennt die beiden Fragen,
 * statt eine bestehende Bedeutung stillschweigend zu erweitern.
 */
export function moduleViewPermission(permissionPrefix: string): string {
  return `${permissionPrefix}.module.view`;
}

/**
 * Der «Modul sehen»-Schluessel eines Moduls - oder `null`.
 *
 * `null` fuer Module ohne Seitenleisteneintrag: sie haben nichts zu zeigen,
 * und ein Schluessel, der nichts sichtbar macht, waere im Berechtigungseditor
 * nur eine Zeile mehr zum Raetseln.
 */
export function moduleViewPermissionOf(definition: ModuleDefinition): string | null {
  return definition.navigation.length > 0 ? moduleViewPermission(definition.permissionPrefix) : null;
}

/**
 * Der «Modul sehen»-Schluessel zum Praefix einer beliebigen Berechtigung.
 *
 * Damit findet der Seitenschutz den passenden Schluessel, ohne dass ihn 106
 * Seiten einzeln mitgeben muessten - und ohne dass eine neue Seite ihn
 * vergessen kann.
 */
export function moduleViewPermissionFor(permission: string): string | null {
  const praefix = permission.split('.')[0];
  if (praefix === undefined || permission === moduleViewPermission(praefix)) {
    return null;
  }
  for (const definition of modules.values()) {
    if (definition.permissionPrefix === praefix) {
      const schluessel = moduleViewPermissionOf(definition);
      if (schluessel) {
        return schluessel;
      }
    }
  }
  return null;
}

export function registerModule(definition: ModuleDefinition): ModuleDefinition {
  modules.set(definition.id, definition);
  registerPermissions(definition.permissions);

  const sehen = moduleViewPermissionOf(definition);
  if (sehen) {
    // Zwei Module koennen sich einen Praefix teilen - «Server» und
    // «Einstellungen» tun es, damit `settings.*` beide abdeckt. Sie teilen
    // sich dann auch diesen Schluessel; die Beschreibung sagt das, statt so
    // zu tun, als gaebe es zwei.
    registerPermissions([
      {
        key: sehen,
        label: 'Modul sehen',
        description:
          'Diesen Bereich in der Seitenleiste sehen und öffnen. Erlaubt für sich genommen ' +
          'keine einzige Aktion darin - dafür stehen die Berechtigungen darunter.',
        module: definition.id,
      },
    ]);
  }

  return definition;
}

export function listModuleDefinitions(): ModuleDefinition[] {
  return [...modules.values()];
}

export function getModuleDefinition(id: string): ModuleDefinition | undefined {
  return modules.get(id);
}

export interface NavigationEntry extends ModuleNavigationItem {
  moduleId: string;
}

/**
 * Navigationseinträge aller aktivierten Module, gefiltert nach Permissions.
 *
 * Es erscheint nur, was auch funktioniert: ein Eintrag entsteht ausschliesslich
 * für ein eingeschaltetes Modul mit vorhandener Seite. Platzhalter, die zu
 * einer leeren Seite führen, gibt es bewusst nicht.
 */
export function buildNavigation(
  permissionKeys: readonly string[],
  enabledModuleIds: ReadonlySet<string>,
): NavigationEntry[] {
  const owned = new Set(permissionKeys);
  return listModuleDefinitions()
    .filter((definition) => definition.core || enabledModuleIds.has(definition.id))
    // «Modul sehen» zuerst: fehlt der Schluessel, erscheint von diesem Modul
    // nichts - unabhaengig davon, welche Aktionen jemand darin ausfuehren
    // duerfte. Frueher genuegte irgendeine Berechtigung des Moduls, und der
    // Eintrag entstand als Nebenwirkung einer Handlungsbefugnis. Sichtbarkeit
    // ist jetzt eine eigene Entscheidung.
    .filter((definition) => {
      const sehen = moduleViewPermissionOf(definition);
      return sehen === null || owned.has(sehen);
    })
    .flatMap((definition) => definition.navigation.map((item) => ({ ...item, moduleId: definition.id })))
    .flatMap((item) => {
      if (owned.has(item.permission)) {
        return [item];
      }

      // Hauptberechtigung fehlt: gibt es einen Weg, der zu dem passt, was
      // diese Person tatsaechlich darf?
      const ausweich = (item.alternatives ?? []).find((eintrag) => owned.has(eintrag.permission));
      if (ausweich) {
        return [
          {
            ...item,
            href: ausweich.href,
            label: ausweich.label,
            description: ausweich.description ?? item.description,
            icon: ausweich.icon ?? item.icon,
            // Der Titel-Praefix bleibt der des Moduls: die Unterseiten
            // gehoeren weiterhin dazu.
            titlePrefix: item.titlePrefix ?? item.href,
          },
        ];
      }

      return (item.altPermissions ?? []).some((permission) => owned.has(permission)) ? [item] : [];
    })
    .sort((a, b) => a.order - b.order);
}

/** Gruppiert Navigationseinträge für die Seitenleiste. */
export function groupNavigation(
  entries: NavigationEntry[],
): Array<{ id: NavigationGroupId; label: string | null; items: NavigationEntry[] }> {
  return NAVIGATION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: entries.filter((entry) => entry.group === group.id),
  })).filter((group) => group.items.length > 0);
}
