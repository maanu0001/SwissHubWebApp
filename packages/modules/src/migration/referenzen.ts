import type { SettingsField } from '../settings/fields';
import { getModuleDefinition } from '../registry';

/**
 * Wo in den Einstellungen Rollen und Kanäle stehen.
 *
 * Die Antwort steht bereits im System, und zwar an genau einer Stelle: jedes
 * Modul beschreibt seine Einstellungen mit `settingsFields`, und dort trägt
 * jedes Feld seine Art - `discord-role`, `discord-channel-list` und so
 * weiter. Die generische Einstellungsmaske baut daraus ihre Auswahllisten.
 *
 * Dieselbe Beschreibung beantwortet die Frage, die eine Übertragung stellt:
 * welche Werte sind Guild-Objekte und müssen übersetzt werden? Eine eigene
 * Liste pro Modul wäre die zweite Antwort auf dieselbe Frage - und sie
 * verwaiste beim ersten neuen Feld, ohne dass es jemandem auffiele.
 */

export type ReferenzArt = 'role' | 'channel';

export interface Referenzfeld {
  key: string;
  art: ReferenzArt;
  /** Steht dort eine Liste oder ein einzelner Wert? */
  liste: boolean;
  label: string;
}

const ART_JE_TYP: Record<string, { art: ReferenzArt; liste: boolean } | undefined> = {
  'discord-role': { art: 'role', liste: false },
  'discord-role-list': { art: 'role', liste: true },
  'discord-channel': { art: 'channel', liste: false },
  'discord-channel-list': { art: 'channel', liste: true },
};

/** Die Referenzfelder eines Moduls - leer, wenn es keine Einstellungen hat. */
export function referenzfelderVon(moduleId: string): Referenzfeld[] {
  const definition = getModuleDefinition(moduleId);
  return felderAus(definition?.settingsFields ?? []);
}

function felderAus(felder: SettingsField[]): Referenzfeld[] {
  const gefunden: Referenzfeld[] = [];
  for (const feld of felder) {
    const art = ART_JE_TYP[feld.type];
    if (art) {
      gefunden.push({ key: feld.key, art: art.art, liste: art.liste, label: feld.label });
    }
  }
  return gefunden;
}

/**
 * Alle Rollen- und Kanal-IDs, die ein Modul in seinen Einstellungen nennt.
 *
 * Ohne Duplikate und ohne leere Werte - eine nicht gesetzte Einstellung ist
 * keine Referenz, die jemand zuordnen müsste.
 */
export function referenzenIn(
  moduleId: string,
  settings: Record<string, unknown>,
): { roles: string[]; channels: string[] } {
  const rollen = new Set<string>();
  const kanaele = new Set<string>();

  for (const feld of referenzfelderVon(moduleId)) {
    const ziel = feld.art === 'role' ? rollen : kanaele;
    for (const wert of werteVon(settings[feld.key], feld.liste)) {
      ziel.add(wert);
    }
  }

  return { roles: [...rollen], channels: [...kanaele] };
}

function werteVon(roh: unknown, liste: boolean): string[] {
  if (liste) {
    return Array.isArray(roh)
      ? roh.filter((wert): wert is string => typeof wert === 'string' && wert !== '')
      : [];
  }
  return typeof roh === 'string' && roh !== '' ? [roh] : [];
}

/**
 * Die Referenzen eines Moduls uebersetzen.
 *
 * Was sich nicht zuordnen laesst, wird geleert und nicht durchgereicht: eine
 * Rollen-ID aus der Quell-Guild ist im Ziel keine Rolle, sondern eine Zahl,
 * auf die niemand mehr zeigt. Sie stehenzulassen hiesse, eine Einstellung zu
 * uebertragen, die schweigend nicht wirkt.
 *
 * Was dabei wegfaellt, steht in `fehlend` - der Probelauf zeigt es an, bevor
 * irgendetwas geschrieben wird.
 */
export function uebersetzeReferenzen(
  moduleId: string,
  settings: Record<string, unknown>,
  zuordnung: { roles: Record<string, string>; channels: Record<string, string> },
): { settings: Record<string, unknown>; fehlend: Array<{ key: string; art: ReferenzArt; quelle: string }> } {
  const ergebnis: Record<string, unknown> = { ...settings };
  const fehlend: Array<{ key: string; art: ReferenzArt; quelle: string }> = [];

  for (const feld of referenzfelderVon(moduleId)) {
    const tabelle = feld.art === 'role' ? zuordnung.roles : zuordnung.channels;
    const quellwerte = werteVon(settings[feld.key], feld.liste);

    const uebersetzt: string[] = [];
    for (const quelle of quellwerte) {
      const ziel = tabelle[quelle];
      if (ziel) {
        uebersetzt.push(ziel);
      } else {
        fehlend.push({ key: feld.key, art: feld.art, quelle });
      }
    }

    if (feld.liste) {
      ergebnis[feld.key] = uebersetzt;
    } else {
      // Ein einzelnes Feld ohne Zuordnung wird leer - `null`, weil die
      // Schemata der Module genau das als «nicht gesetzt» kennen.
      ergebnis[feld.key] = uebersetzt[0] ?? null;
    }
  }

  return { settings: ergebnis, fehlend };
}
