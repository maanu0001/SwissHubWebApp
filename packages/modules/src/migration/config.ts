import { registerModule, type ModuleDefinition } from '../registry';

export const MIGRATION_MODULE_ID = 'migration';

/**
 * Berechtigungen der Übertragung.
 *
 * Fein geschnitten, weil die Schritte verschieden schwer wiegen. Ein Export
 * liest und schreibt nichts; ein Probelauf rechnet; das Anwenden schreibt
 * die Berechtigungen und Moduleinstellungen einer ganzen Installation um.
 * Wer das eine darf, soll damit nicht das andere dürfen.
 *
 * `execute` und `rollback` sind als kritisch markiert - sie gehören in
 * dieselbe Klasse wie das Einschalten einer Automation: nicht kaputt zu
 * machen, aber weitreichend genug, dass die Vergabe eine Entscheidung sein
 * soll und keine Nebensache.
 */
export const MIGRATION_PERMISSIONS = {
  view: 'migration.view',
  export: 'migration.export',
  import: 'migration.import',
  dryRun: 'migration.dry_run',
  execute: 'migration.execute',
  rollback: 'migration.rollback',
} as const;

export type MigrationPermission = (typeof MIGRATION_PERMISSIONS)[keyof typeof MIGRATION_PERMISSIONS];

/**
 * Das Modul.
 *
 * Ohne Einstellungen - es hat keine. Eine Übertragung ist ein Vorgang und
 * kein Dauerzustand; was sie braucht, steht im Lauf, nicht in einer
 * Konfiguration.
 *
 * `defaultEnabled: false`: das Modul erscheint erst, wenn es jemand
 * einschaltet. Ein Werkzeug, das die Konfiguration einer Installation auf
 * eine andere schreibt, soll nicht standardmässig in jeder Seitenleiste
 * stehen.
 */
export const migrationModule: ModuleDefinition = registerModule({
  id: MIGRATION_MODULE_ID,
  name: 'Migrate',
  description:
    'Die Konfiguration einer SwissHub-Installation kontrolliert auf eine andere Discord-Guild übertragen - mit Zuordnung von Rollen und Kanälen, Probelauf und Rücknahme.',
  icon: 'ArrowRightLeft',
  permissionPrefix: 'migration',
  defaultEnabled: false,
  configVersion: 1,
  permissions: [
    {
      key: MIGRATION_PERMISSIONS.view,
      label: 'Übertragungen ansehen',
      description: 'Laufende und vergangene Übertragungen einsehen.',
      module: MIGRATION_MODULE_ID,
    },
    {
      key: MIGRATION_PERMISSIONS.export,
      label: 'Konfiguration exportieren',
      description: 'Ein Paket der aktuellen Konfiguration erzeugen. Ohne Zugangsdaten.',
      module: MIGRATION_MODULE_ID,
    },
    {
      key: MIGRATION_PERMISSIONS.import,
      label: 'Paket einlesen',
      description: 'Ein Übertragungspaket hochladen und prüfen lassen. Verändert noch nichts.',
      module: MIGRATION_MODULE_ID,
    },
    {
      key: MIGRATION_PERMISSIONS.dryRun,
      label: 'Probelauf',
      description: 'Berechnen, was eine Übertragung ändern würde.',
      module: MIGRATION_MODULE_ID,
    },
    {
      key: MIGRATION_PERMISSIONS.execute,
      label: 'Übertragung durchführen',
      description:
        'Berechtigungen und Moduleinstellungen auf die Ziel-Guild schreiben. Weitreichend - deshalb eigenständig zu vergeben.',
      module: MIGRATION_MODULE_ID,
      critical: true,
    },
    {
      key: MIGRATION_PERMISSIONS.rollback,
      label: 'Übertragung zurücknehmen',
      description: 'Die Konfiguration auf den gesicherten Stand vor der Übertragung zurückdrehen.',
      module: MIGRATION_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/migrate',
      label: 'Migrate',
      description: 'Konfiguration auf eine andere Guild übertragen',
      permission: MIGRATION_PERMISSIONS.view,
      icon: 'ArrowRightLeft',
      group: 'system',
      order: 26,
    },
  ],
});
