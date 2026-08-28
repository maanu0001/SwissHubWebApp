import { prisma } from '@swisshub/database';
import type { Automation } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { LIMITS } from './contract';
import type { AutomationContext } from './context';
import { render } from './context';

const logger = createLogger('automation:limits');

/**
 * Die Schutzmauern um einen Lauf.
 *
 * Drei Gefahren, drei Mauern - und alle drei zählen in der Datenbank, nicht
 * im Arbeitsspeicher. Ein Zähler in einer Map wäre je Prozess einer: bei zwei
 * Instanzen liesse eine Grenze von zehn zwanzig Läufe durch, und nach einem
 * Neustart wäre sie ganz vergessen (§13).
 *
 * 1. **Sturm** - hundert Beitritte in einer Sekunde ergeben hundert Läufe.
 *    Dagegen die Rate je Minute (§16).
 * 2. **Überholen** - derselbe Lauf zweimal gleichzeitig, etwa weil ein
 *    Ereignis doppelt kam. Dagegen die Gleichzeitigkeit (§18).
 * 3. **Schleife** - Automation A löst B aus, B löst A aus. Dagegen die
 *    Ursachenkette (§17).
 *
 * Keine dieser Grenzen ist eine Vorliebe. Wer sie erreicht, hat einen Fehler
 * gebaut - deshalb wird ein Überschreiten protokolliert und nicht still
 * verschluckt.
 */

/** Das Fenster, über das die Rate zählt. */
export const RATE_FENSTER_MS = 60_000;

/**
 * Darf diese Automation jetzt noch laufen? (§16)
 *
 * Gezählt werden die Läufe der letzten Minute in der Datenbank - Probeläufe
 * ausgenommen, denn ein Probelauf wirkt nicht und soll sich beliebig oft
 * wiederholen lassen.
 *
 * `0` oder weniger heisst: keine Grenze. Das ist der Ausweg für eine
 * Systemautomation, die auf jedes Ereignis reagieren muss.
 */
export async function pruefeRate(
  automationId: string,
  maxRunsPerMinute: number,
  jetzt = new Date(),
): Promise<boolean> {
  if (!Number.isFinite(maxRunsPerMinute) || maxRunsPerMinute <= 0) {
    return true;
  }

  const seit = new Date(jetzt.getTime() - RATE_FENSTER_MS);
  const bisher = await prisma.automationRun.count({
    where: { automationId, dryRun: false, createdAt: { gte: seit } },
  });

  if (bisher >= maxRunsPerMinute) {
    logger.warn('Ratengrenze erreicht', { automationId, bisher, grenze: maxRunsPerMinute });
    return false;
  }
  return true;
}

// --- Gleichzeitigkeit (§18) -------------------------------------------------

/** Die Zustände, in denen ein Lauf als «noch unterwegs» gilt. */
export const OFFENE_ZUSTAENDE = ['PENDING', 'RUNNING', 'WAITING', 'AWAITING_APPROVAL'] as const;

export type Gleichzeitigkeitsentscheid = 'START' | 'SKIP' | 'QUEUE';

/**
 * Den Gleichzeitigkeitsschlüssel eines Laufs auflösen.
 *
 * Die Vorlage darf Platzhalter enthalten - `{{payload.userId}}` etwa macht
 * aus einer Grenze je Automation eine Grenze je Mitglied. Ohne Vorlage zählt
 * die Automation als Ganzes; dann steht `null` in der Zeile, und das ist
 * derselbe Wert, den alle Läufe vor dieser Möglichkeit tragen.
 */
export function loeseSchluesselAuf(
  vorlage: string | null | undefined,
  context: AutomationContext,
): string | null {
  if (!vorlage || vorlage.trim() === '') {
    return null;
  }
  const aufgeloest = render(vorlage, context).text.trim();
  return aufgeloest === '' ? null : aufgeloest.slice(0, 200);
}

/**
 * Darf jetzt ein weiterer Durchgang beginnen?
 *
 * - `ALLOW` - immer. Der Normalfall: eine Willkommensnachricht je Beitritt.
 * - `SKIP_IF_RUNNING` - nur, wenn keiner offen ist. Für Automationen, deren
 *   zweiter Durchgang die Arbeit des ersten zunichtemachen würde.
 * - `QUEUE` - nicht jetzt, aber später. Der Aufrufer plant sie erneut ein,
 *   statt sie zu verwerfen.
 *
 * Ein Probelauf wird nie eingeschränkt: er wirkt nicht und kann niemandem in
 * die Quere kommen.
 */
export async function pruefeGleichzeitigkeit(
  automation: Pick<Automation, 'id' | 'concurrency'>,
  schluessel: string | null,
  optionen: { dryRun?: boolean } = {},
): Promise<Gleichzeitigkeitsentscheid> {
  if (optionen.dryRun || automation.concurrency === 'ALLOW') {
    return 'START';
  }

  const offen = await prisma.automationRun.count({
    where: {
      automationId: automation.id,
      dryRun: false,
      status: { in: [...OFFENE_ZUSTAENDE] },
      // `null` trifft in Prisma genau die Zeilen mit `NULL` - eine Automation
      // ohne Schlüssel zählt also gegen sich selbst und nicht gegen alle.
      concurrencyKey: schluessel,
    },
  });

  if (offen === 0) {
    return 'START';
  }
  return automation.concurrency === 'QUEUE' ? 'QUEUE' : 'SKIP';
}

// --- Ursachenkette (§17) ----------------------------------------------------

export interface Kettenbefund {
  erlaubt: boolean;
  grund?: string;
}

/**
 * Schliesst sich hier ein Kreis?
 *
 * Die Tiefe allein genügt nicht. Zwei Automationen, die sich gegenseitig
 * auslösen, brauchen fünf Ebenen, ehe die Tiefengrenze greift - fünf
 * ausgeführte Runden mit echten Wirkungen in Discord. Deshalb die zweite
 * Prüfung: **dieselbe Automation ein zweites Mal in derselben Ursachenkette**
 * ist ein Kreis, unabhängig von der Tiefe, und wird sofort abgewiesen.
 *
 * Die Kette ist über `correlationId` geklammert. Ein neuer Anlass bekommt
 * eine neue Kennung - eine Automation, die auf jeden Beitritt reagiert, wird
 * dadurch nie gebremst, denn jeder Beitritt beginnt eine eigene Kette.
 *
 * Bei einem Fehler gilt die Kette als erlaubt: die Prüfung ist ein
 * Zusatzschutz neben der Tiefengrenze, und ein Datenbankproblem soll nicht
 * alle Automationen anhalten.
 */
export async function pruefeKette(
  automationId: string,
  correlationId: string | null | undefined,
  tiefe: number,
): Promise<Kettenbefund> {
  if (tiefe > LIMITS.maxDepth) {
    return { erlaubt: false, grund: 'Die Ursachenkette ist zu tief.' };
  }
  // Der Beginn einer Kette kann sich nicht selbst wiederholt haben.
  if (!correlationId || tiefe === 0) {
    return { erlaubt: true };
  }

  try {
    const schon = await prisma.automationRun.findFirst({
      where: { automationId, correlationId, dryRun: false },
      select: { id: true },
    });
    if (schon) {
      logger.error('Kreis in der Ursachenkette abgewiesen', {
        automationId,
        correlationId,
        tiefe,
        vorlauf: schon.id,
      });
      return {
        erlaubt: false,
        grund: 'Diese Automation läuft bereits in derselben Ursachenkette - abgebrochen.',
      };
    }
  } catch (error) {
    logger.warn('Kettenprüfung nicht möglich - Tiefengrenze bleibt wirksam', {
      automationId,
      error,
    });
  }
  return { erlaubt: true };
}

/**
 * Darf dieser Lauf noch ein Ereignis auslösen? (§16)
 *
 * Ohne diese Grenze könnte eine einzige Automation in einem Durchgang
 * beliebig viele neue Ketten beginnen - jede mit eigener Tiefe, an der
 * Tiefengrenze vorbei. Der Zähler steht im Kontext und gilt je Lauf.
 */
export function darfEreignisAusloesen(context: AutomationContext): boolean {
  if (context.emitted >= LIMITS.maxEmittedEvents) {
    logger.warn('Ereignisgrenze eines Laufs erreicht', {
      runId: context.runId,
      automationId: context.automationId,
      bisher: context.emitted,
    });
    return false;
  }
  return true;
}
