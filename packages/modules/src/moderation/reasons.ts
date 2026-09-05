/**
 * Die Gründe, aus denen moderiert wird.
 *
 * Vorher gab es sie zweimal. Das Jail-Modul führte eine eigene, im Dashboard
 * pflegbare Liste; das Moderation Center hatte für Bann, Kick und Timeout gar
 * keine und verlangte, den Grund jedes Mal neu zu tippen. Das Ergebnis war
 * absehbar: derselbe Sachverhalt stand als «Spam», «spam», «Spamming» und
 * «spammt seit Tagen» in der Akte, und keine Auswertung darüber war je etwas
 * wert.
 *
 * Hier steht die eine Liste. Sie gehört der Moderation, weil Jail inzwischen
 * eine Massnahme darin ist - zwei Listen für dieselbe Frage wären genau der
 * Zustand, aus dem wir kommen.
 *
 * Drei Dinge, die eine Vorlage ausdrücklich nicht ist:
 *
 *  - **Keine Vorschrift.** Sie füllt das Feld, und danach lässt sich der Text
 *    ändern, ergänzen oder ganz ersetzen. Gespeichert wird, was am Ende
 *    dasteht, nicht die Vorlage.
 *  - **Keine Regel.** Aus «Bot» folgt keine Sonderbehandlung irgendwo im
 *    System. Es ist ein Text, und ein Text bleibt es.
 *  - **Keine Berechtigung.** Wer eine Massnahme nicht ergreifen darf, sieht
 *    ihre Vorlagen ebenso wenig - die Maske zeigt nur, was jemand tun kann.
 */

/** Die Massnahmen, die ein eigenes Grundfeld haben. */
export const MODERATION_ACTIONS = ['BAN', 'KICK', 'TIMEOUT', 'TIMEOUT_REMOVE', 'JAIL', 'NOTE'] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export interface ModerationReasonTemplate {
  id: string;
  label: string;
  /** Was im Grundfeld landet. Meist derselbe Text wie das Etikett. */
  reasonText: string;
  /** Für welche Massnahmen die Vorlage angeboten wird. */
  applicableActions: readonly ModerationAction[];
  sortOrder: number;
}

/** Überall dort, wo ein Grund eingetragen wird. */
const ALLE: readonly ModerationAction[] = MODERATION_ACTIONS;

/**
 * Die Gründe, die ein frischer Server vorfindet.
 *
 * Die ersten sieben stammen aus dem Jail-Modul und stehen weiterhin genau so
 * da - sie waren dort die Vorgabe, und ein Server, der sie kennt, soll sie
 * nicht verlieren.
 *
 * «Unter 16» und «Bot» sind eng gefasst: sie beschreiben, wer jemand ist,
 * nicht was er getan hat. Als Notiz ergäben sie keinen Satz, und einen
 * Timeout gegen einen Bot setzt niemand - man entfernt ihn.
 */
export const STANDARD_REASON_TEMPLATES: readonly ModerationReasonTemplate[] = [
  { id: 'spam', label: 'Spam', reasonText: 'Spam', applicableActions: ALLE, sortOrder: 10 },
  {
    id: 'beleidigung',
    label: 'Beleidigung',
    reasonText: 'Beleidigung',
    applicableActions: ALLE,
    sortOrder: 20,
  },
  {
    id: 'provokation',
    label: 'Provokation',
    reasonText: 'Provokation',
    applicableActions: ALLE,
    sortOrder: 30,
  },
  {
    id: 'regelverstoss',
    label: 'Regelverstoss',
    reasonText: 'Regelverstoss',
    applicableActions: ALLE,
    sortOrder: 40,
  },
  {
    id: 'unangemessenes-verhalten',
    label: 'Unangemessenes Verhalten',
    reasonText: 'Unangemessenes Verhalten',
    applicableActions: ALLE,
    sortOrder: 50,
  },
  {
    id: 'voice-verhalten',
    label: 'Voice-Verhalten',
    reasonText: 'Voice-Verhalten',
    applicableActions: ALLE,
    sortOrder: 60,
  },
  { id: 'werbung', label: 'Werbung', reasonText: 'Werbung', applicableActions: ALLE, sortOrder: 70 },
  {
    id: 'unter-16',
    label: 'Unter 16',
    reasonText: 'Unter 16',
    // Ein Altersgrund führt nicht zu einem Timeout und zu keiner Notiz - er
    // führt dazu, dass jemand nicht auf den Server gehört.
    applicableActions: ['BAN', 'KICK', 'JAIL'],
    sortOrder: 80,
  },
  {
    id: 'bot',
    label: 'Bot',
    reasonText: 'Bot',
    applicableActions: ['BAN', 'KICK', 'JAIL'],
    sortOrder: 90,
  },
];

/** Wie viele eigene Gründe eine Serverleitung eintragen kann. */
const MAX_EIGENE = 25;

/**
 * Eigene Gründe aus den Einstellungen lesen.
 *
 * Eine Zeile, ein Grund - dieselbe Schreibweise, die das Jail-Modul schon
 * hatte, damit eine bestehende Liste unverändert weiterverwendet werden kann.
 * Sie gelten für jede Massnahme: wer einen eigenen Grund einträgt, weiss
 * selbst, wann er ihn braucht, und eine Zuordnung pro Massnahme wäre eine
 * Pflege, die niemand leisten will.
 *
 * Was schon als Vorgabe existiert, kommt nicht doppelt zurück - auch nicht in
 * anderer Schreibweise. Zwei Knöpfe «Spam» und «spam» nebeneinander wären
 * genau die Uneinheitlichkeit, gegen die es die Liste gibt.
 */
export function parseEigeneGruende(roh: string): ModerationReasonTemplate[] {
  const vergeben = new Set(STANDARD_REASON_TEMPLATES.map((eintrag) => eintrag.label.toLowerCase()));
  const ergebnis: ModerationReasonTemplate[] = [];

  for (const zeile of roh.split('\n')) {
    const text = zeile.trim();
    const schluessel = text.toLowerCase();
    if (text.length < 3 || text.length > 100 || vergeben.has(schluessel)) {
      continue;
    }
    vergeben.add(schluessel);
    ergebnis.push({
      id: `eigen:${schluessel.replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')}`,
      label: text,
      reasonText: text,
      applicableActions: ALLE,
      sortOrder: 1000 + ergebnis.length,
    });
    if (ergebnis.length >= MAX_EIGENE) {
      break;
    }
  }
  return ergebnis;
}

export interface ReasonTemplateQuelle {
  /** Eigene Gründe, eine Zeile je Grund. */
  reasonTemplates: string;
  /** Vorgaben ausblenden - je Kennung eine Zeile. */
  disabledReasonTemplates?: string;
}

/**
 * Alle Vorlagen, die für diese Massnahme in Frage kommen.
 *
 * Die eine Funktion, die jede Maske aufruft. Vorher entschied jede Stelle für
 * sich, welche Gründe sie anbietet - und bot deshalb andere an.
 */
export function reasonTemplatesFor(
  action: ModerationAction,
  quelle: ReasonTemplateQuelle,
): ModerationReasonTemplate[] {
  const abgeschaltet = new Set(
    (quelle.disabledReasonTemplates ?? '')
      .split('\n')
      .map((zeile) => zeile.trim())
      .filter((zeile) => zeile.length > 0),
  );

  return [...STANDARD_REASON_TEMPLATES, ...parseEigeneGruende(quelle.reasonTemplates)]
    .filter((vorlage) => !abgeschaltet.has(vorlage.id))
    .filter((vorlage) => vorlage.applicableActions.includes(action))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
