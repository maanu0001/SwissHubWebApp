import { expect, it, beforeAll } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_dashboard_scope');

/**
 * Was nicht gezeigt wird, wird auch nicht geladen.
 *
 * Der Unterschied ist nicht kosmetisch: die Zahlen kaemen sonst aus der
 * Datenbank, laegen in der Antwort des Servers und stuenden im Fehlerfall im
 * Protokoll - fuer jemanden, der sie nie haette sehen duerfen.
 *
 * Diese Faelle standen frueher unter `tests/unit`. Sie fragen die Datenbank
 * aber tatsaechlich ab und liefen deshalb gegen das Schema `public` - sie
 * gingen nur auf einem Rechner durch, auf dem dort schon Migrationen
 * angewandt waren, und scheiterten auf jedem frischen. Hier bekommen sie ihr
 * eigenes Schema wie jede andere datenbankgestuetzte Pruefung auch.
 */
await import('@swisshub/modules');
const { loadDashboardData } = await import('@/server/dashboard');

describeWithDatabase('Dashboard lädt nur, was der Betrachter sehen darf', () => {
  beforeAll(() => {
    pushSchema();
  });

  it('lässt Jail- und Moderationszahlen ohne Berechtigung ganz weg', async () => {
    const daten = await loadDashboardData({
      canViewJails: false,
      canViewAudit: false,
      canViewModeration: false,
    });

    // `undefined` und nicht `0`: eine Null waere eine Auskunft ueber den
    // Moderationsstand des Servers.
    expect(daten.jailStats).toBeUndefined();
    expect(daten.actionsToday).toBeUndefined();
    expect(daten.actionsYesterday).toBeUndefined();
    expect(daten.actionsTrend).toBeNull();
    expect(daten.activeJails).toEqual([]);
    expect(daten.recentActivity).toEqual([]);
    // Was jeder sehen darf, bleibt.
    expect(daten.bot).toBeDefined();
  });

  it('liefert sie mit Berechtigung', async () => {
    const daten = await loadDashboardData({
      canViewJails: true,
      canViewAudit: true,
      canViewModeration: true,
    });

    expect(daten.jailStats).toBeDefined();
    expect(typeof daten.actionsToday).toBe('number');
  });
});
