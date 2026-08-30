/**
 * Permission Registry.
 *
 * Berechtigungen werden als `<prefix>.<aktion>` Strings geführt. Module bringen
 * ihre eigenen Permissions mit und registrieren sie beim Laden - die Kernlogik
 * muss dafür nicht angefasst werden.
 */
export interface PermissionDefinition {
  /** z.B. `jail.create` */
  key: string;
  /** Anzeigename in den Einstellungen. */
  label: string;
  description: string;
  /** Modul-ID oder `core`. */
  module: string;
  /** Kennzeichnet besonders kritische Berechtigungen (Warnhinweis im UI). */
  critical?: boolean;
}

/** Sonderberechtigung: schliesst sämtliche anderen Berechtigungen ein. */
export const ADMIN_FULL = 'admin.full';

export const CORE_PERMISSIONS: PermissionDefinition[] = [
  {
    key: 'dashboard.view',
    label: 'Dashboard ansehen',
    description: 'Zugriff auf das Dashboard und die Statuskacheln.',
    module: 'core',
  },
  {
    key: 'members.view',
    label: 'Mitglieder ansehen',
    description: 'Mitgliedersuche und Mitgliederprofile einsehen.',
    module: 'core',
  },
  {
    key: 'moderation.view',
    label: 'Moderation ansehen',
    description: 'Moderationshistorie und laufende Massnahmen einsehen.',
    module: 'core',
  },
  {
    key: 'moderation.execute',
    label: 'Moderation ausführen',
    description: 'Moderationsaktionen gegen Mitglieder ausführen.',
    module: 'core',
    critical: true,
  },
  {
    key: 'audit.view',
    label: 'Audit Log ansehen',
    description: 'Das zentrale Audit Log einsehen und filtern.',
    module: 'core',
  },
  {
    key: 'settings.view',
    label: 'Einstellungen ansehen',
    description: 'Konfiguration der WebApp einsehen.',
    module: 'core',
  },
  {
    key: 'settings.edit',
    label: 'Einstellungen bearbeiten',
    description: 'Discord-, Rollen- und Systemeinstellungen ändern.',
    module: 'core',
    critical: true,
  },
  {
    key: 'permissions.manage',
    label: 'Berechtigungen verwalten',
    description: 'Discord-Rollen Berechtigungen zuweisen oder entziehen.',
    module: 'core',
    critical: true,
  },
  {
    key: 'modules.manage',
    label: 'Module verwalten',
    description: 'Module aktivieren, deaktivieren und konfigurieren.',
    module: 'core',
    critical: true,
  },
  {
    key: 'branding.manage',
    label: 'Branding verwalten',
    description: 'Logo und Erscheinungsbild der WebApp ändern.',
    module: 'core',
    critical: true,
  },
  {
    key: 'system.manage',
    label: 'System verwalten',
    description: 'Systemweite Funktionen wie Reconciliation und Wartung.',
    module: 'core',
    critical: true,
  },
  /**
   * Integrationen: technische Zugangsdaten.
   *
   * Fein geschnitten, weil «ansehen» und «Bot-Token austauschen» nicht
   * dieselbe Befugnis sind. Wer nur `integrations.view` hat, sieht Zustaende
   * und Masken - nie einen Wert, aber das gilt ohnehin fuer alle.
   *
   * `integrations.secrets.manage` ist die scharfe: sie erlaubt, Geheimnisse
   * zu setzen und zu loeschen. Ein falsch gesetzter Bot-Token nimmt den Bot
   * vom Netz, ein geloeschtes OAuth-Secret sperrt alle aus dem Dashboard aus.
   */
  {
    key: 'integrations.view',
    label: 'Integrationen ansehen',
    description: 'Zustand der Zugangsdaten und Verbindungen einsehen. Niemals Werte.',
    module: 'core',
  },
  {
    key: 'integrations.manage',
    label: 'Integrationen verwalten',
    description: 'Nicht geheime Einstellungen ändern und Verbindungen testen.',
    module: 'core',
    critical: true,
  },
  {
    key: 'integrations.secrets.manage',
    label: 'Zugangsdaten ändern',
    description: 'Tokens und Schlüssel hinterlegen, ersetzen und entfernen.',
    module: 'core',
    critical: true,
  },
  {
    key: 'integrations.discord.manage',
    label: 'Discord-Zugangsdaten verwalten',
    description: 'Bot-Token, OAuth-Zugangsdaten und die hinterlegten Bots.',
    module: 'core',
    critical: true,
  },
  {
    key: 'integrations.ai.manage',
    label: 'AI-Integration verwalten',
    description: 'Anbieter, Modell und Schlüssel der zentralen AI-Anbindung.',
    module: 'core',
    critical: true,
  },
  /**
   * Discord-Log-Kanaele.
   *
   * Eigener Namensraum statt `analytics.*`: die Kategorien reichen ueber das
   * Analytics-Modul hinaus - Moderation gibt es auch, wenn das Protokoll der
   * Nachrichten abgeschaltet ist. Eine Berechtigung, die an einem
   * abschaltbaren Modul haengt, waere fuer die Moderation die falsche.
   *
   * `test` ist von `manage` getrennt, weil die Testnachricht in einem Kanal
   * sichtbar wird, den andere lesen - wer die Einrichtung ansehen darf, soll
   * nicht ungefragt hineinschreiben koennen.
   */
  {
    key: 'logs.discord.view',
    label: 'Discord-Log-Kanäle ansehen',
    description: 'Welche Log-Kategorie in welchen Discord-Kanal geht.',
    module: 'core',
  },
  {
    key: 'logs.discord.manage',
    label: 'Discord-Log-Kanäle verwalten',
    description: 'Kategorien einem Kanal zuweisen oder abschalten.',
    module: 'core',
    critical: true,
  },
  {
    key: 'logs.discord.test',
    label: 'Log-Testnachricht senden',
    description: 'Eine Probenachricht in einen eingerichteten Log-Kanal senden.',
    module: 'core',
  },
  {
    key: ADMIN_FULL,
    label: 'Vollzugriff',
    description: 'Schliesst sämtliche Berechtigungen ein. Nur für Administratoren.',
    module: 'core',
    critical: true,
  },
];

const registry = new Map<string, PermissionDefinition>(
  CORE_PERMISSIONS.map((definition) => [definition.key, definition]),
);

/** Registriert Permissions eines Moduls (idempotent). */
export function registerPermissions(definitions: PermissionDefinition[]): void {
  for (const definition of definitions) {
    registry.set(definition.key, definition);
  }
}

export function listPermissions(): PermissionDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getPermission(key: string): PermissionDefinition | undefined {
  return registry.get(key);
}

export function isKnownPermission(key: string): boolean {
  return registry.has(key);
}

/** Gruppiert die bekannten Permissions nach Modul (für die Einstellungen). */
export function listPermissionsByModule(): Map<string, PermissionDefinition[]> {
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const definition of listPermissions()) {
    const entries = grouped.get(definition.module) ?? [];
    entries.push(definition);
    grouped.set(definition.module, entries);
  }
  return grouped;
}
