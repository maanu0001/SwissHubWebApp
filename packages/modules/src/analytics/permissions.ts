import type { PermissionDefinition } from '@swisshub/permissions';

/**
 * Berechtigungen der Analytics.
 *
 * Bewusst fein aufgeteilt. Ein Protokoll ueber alles, was auf dem Server
 * geschieht, ist eine maechtige Auskunft: wer Nachrichteninhalte lesen darf,
 * liest mit, was Menschen einander geschrieben haben - auch das, was sie
 * geloescht haben, gerade weil sie es nicht stehen lassen wollten.
 *
 * Deshalb steht `analytics.view` nur fuer «es gab hier ein Ereignis». Wer den
 * Text sehen will, braucht `analytics.content.view`, und wer die Dateien
 * herunterladen will, `analytics.media.download`. Diese drei sind absichtlich
 * getrennt: ein Moderator, der wissen muss, wer wann was geloescht hat, muss
 * nicht zwingend den Inhalt lesen.
 */
export const ANALYTICS_PERMISSIONS = {
  view: 'analytics.view',
  statisticsView: 'analytics.statistics.view',
  contentView: 'analytics.content.view',
  mediaDownload: 'analytics.media.download',
  export: 'analytics.export',
  settings: 'analytics.settings',
} as const;

const eintrag = (
  key: string,
  label: string,
  description: string,
  critical = false,
): PermissionDefinition => ({
  key,
  label,
  description,
  module: 'analytics',
  ...(critical ? { critical } : {}),
});

export const ANALYTICS_PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  eintrag(
    ANALYTICS_PERMISSIONS.statisticsView,
    'Statistik ansehen',
    'Kennzahlen, Verläufe und Ranglisten des Servers einsehen. Zeigt keine Nachrichteninhalte.',
  ),
  eintrag(
    ANALYTICS_PERMISSIONS.view,
    'Zeitleiste ansehen',
    'Den Verlauf der Server-Ereignisse einsehen: wer wann was getan hat, ohne Nachrichteninhalte.',
  ),
  eintrag(
    ANALYTICS_PERMISSIONS.contentView,
    'Nachrichteninhalte lesen',
    'Den Text gelöschter und bearbeiteter Nachrichten lesen. Weitreichend - nur an wenige vergeben.',
    true,
  ),
  eintrag(
    ANALYTICS_PERMISSIONS.mediaDownload,
    'Archivierte Dateien herunterladen',
    'Bilder und Dateien aus dem Archiv öffnen. Jeder Abruf wird protokolliert.',
    true,
  ),
  eintrag(
    ANALYTICS_PERMISSIONS.export,
    'Verlauf exportieren',
    'Den gefilterten Verlauf als CSV herunterladen. Jeder Export wird protokolliert.',
    true,
  ),
  eintrag(
    ANALYTICS_PERMISSIONS.settings,
    'Analytics-Einstellungen',
    'Aufbewahrungsfristen, Speichergrenzen und die Auswahl der aufgezeichneten Ereignisse ändern.',
    true,
  ),
];
