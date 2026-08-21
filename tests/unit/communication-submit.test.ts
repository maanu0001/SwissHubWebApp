import { describe, expect, it, vi } from 'vitest';
import { runSubmit } from '../../apps/web/src/modules/communication/submit';

/**
 * Regressionstest für den gemeldeten Hänger.
 *
 * Der Fehler war: der Aufruf der Server Action stand ohne `try`/`catch` im
 * Klick-Handler, und der Ladezustand wurde erst danach zurückgesetzt. Lehnte
 * die Anfrage ab - Netzabbruch, Serverfehler, abgelaufene Sitzung -, wurde
 * diese Zeile nie erreicht: der Knopf blieb deaktiviert und der
 * Bestätigungsdialog offen. Die Oberfläche war damit unbrauchbar.
 *
 * Diese Tests halten die eine Zusage fest, auf die es ankommt: `settle` läuft
 * immer.
 */
const handlers = () => {
  const settle = vi.fn();
  const onSuccess = vi.fn();
  const onError = vi.fn();
  return { settle, onSuccess, onError };
};

describe('Sende-Ablauf', () => {
  it('meldet Erfolg und beendet den Ladezustand', async () => {
    const h = handlers();
    const outcome = await runSubmit(async () => ({ ok: true, data: { id: 'abc' } }), h);

    expect(outcome).toEqual({ kind: 'success', data: { id: 'abc' } });
    expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).toHaveBeenCalledWith({ id: 'abc' });
    expect(h.onError).not.toHaveBeenCalled();
  });

  it('beendet den Ladezustand auch bei einer abgelehnten Anfrage', async () => {
    const h = handlers();
    const outcome = await runSubmit(
      async () => ({
        ok: false,
        error: { code: 'VALIDATION_FAILED' as const, message: 'Titel fehlt' },
      }),
      h,
    );

    expect(outcome.kind).toBe('error');
    expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Titel fehlt' }));
  });

  it('beendet den Ladezustand, wenn die Anfrage gar nicht durchkommt', async () => {
    // Genau der Fall, der die Oberfläche einfrieren liess: die Server Action
    // wirft, statt ein Ergebnis zu liefern.
    const h = handlers();
    const outcome = await runSubmit(async () => {
      throw new TypeError('Failed to fetch');
    }, h);

    expect(outcome.kind).toBe('transport');
    expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalled();
  });

  it('wirft selbst nie', async () => {
    const h = handlers();
    // Auch ein Fehler ohne Meldung darf nicht nach aussen dringen.
    await expect(
      runSubmit(async () => {
        throw 'kaputt';
      }, h),
    ).resolves.toBeDefined();
    expect(h.settle).toHaveBeenCalledTimes(1);
  });

  it('reicht Feldfehler weiter, damit das Formular sie anzeigen kann', async () => {
    const h = handlers();
    await runSubmit(
      async () => ({
        ok: false,
        error: {
          code: 'VALIDATION_FAILED' as const,
          message: 'Ungültig',
          details: { fieldErrors: { title: 'Zu kurz' } },
        },
      }),
      h,
    );

    expect(h.onError).toHaveBeenCalledWith(expect.objectContaining({ fieldErrors: { title: 'Zu kurz' } }));
  });

  it('beendet den Ladezustand vor der Erfolgsmeldung', async () => {
    // Reihenfolge zählt: würde erst die Erfolgsmeldung laufen und dabei ein
    // Fehler auftreten, bliebe der Ladezustand wieder hängen.
    const reihenfolge: string[] = [];
    await runSubmit(async () => ({ ok: true, data: null }), {
      settle: () => reihenfolge.push('settle'),
      onSuccess: () => reihenfolge.push('success'),
      onError: () => reihenfolge.push('error'),
    });

    expect(reihenfolge).toEqual(['settle', 'success']);
  });
});
