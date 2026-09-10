'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Welche Abschnitte zugeklappt sind.
 *
 * Bewusst «zu» und nicht «offen»: die Vorgabe ist offen, und gespeichert wird
 * die Abweichung davon. Ein neuer Abschnitt ist damit sichtbar, ohne dass ihn
 * jemand erst aufklappen muss - und eine Liste, die einmal leer war, kommt
 * nicht als «alles zu» zurueck.
 *
 * Der Zustand liegt im Browser und nicht in der Datenbank: es ist eine
 * Gewohnheit an diesem Geraet, keine Eigenschaft der Person. Ein Feld dafuer
 * waere eine Datenbankmigration fuer eine Anzeigevorliebe.
 *
 * `schluessel` trennt die Bereiche voneinander - die zugeklappten Abschnitte
 * der Seitenleiste haben mit denen der Berechtigungsmatrix nichts zu tun.
 */
export function useZugeklappt(schluessel: string): [ReadonlySet<string>, (id: string) => void] {
  const [zu, setZu] = useState<ReadonlySet<string>>(() => new Set());

  // Erst nach dem ersten Rendern lesen: der Server kennt den Speicher des
  // Browsers nicht, und ein Unterschied zwischen beiden waere ein
  // Hydrationsfehler.
  useEffect(() => {
    try {
      const roh = window.localStorage.getItem(schluessel);
      if (roh) {
        const gelesen: unknown = JSON.parse(roh);
        if (Array.isArray(gelesen)) {
          setZu(new Set(gelesen.filter((eintrag): eintrag is string => typeof eintrag === 'string')));
        }
      }
    } catch {
      // Privater Modus, gesperrter Speicher, kaputter Eintrag: dann bleibt
      // alles offen. Das ist der brauchbare Zustand, nicht der Fehlerfall.
    }
  }, [schluessel]);

  const umschalten = useCallback(
    (id: string) => {
      setZu((bisher) => {
        const naechster = new Set(bisher);
        if (naechster.has(id)) {
          naechster.delete(id);
        } else {
          naechster.add(id);
        }
        try {
          window.localStorage.setItem(schluessel, JSON.stringify([...naechster]));
        } catch {
          // Nicht speichern zu koennen ist kein Grund, nicht zuzuklappen.
        }
        return naechster;
      });
    },
    [schluessel],
  );

  return [zu, umschalten];
}
