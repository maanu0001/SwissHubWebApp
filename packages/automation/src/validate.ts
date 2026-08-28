import type { DiscordGateway } from '@swisshub/discord';
import { sammleTypen, type ConditionNode } from './conditions';
import { LIMITS, getEventDefinition } from './contract';
import { getAction, getCondition, getTrigger, type ValidationEnvironment, type ValidationIssue } from './registry';
import { stepsSchema, zaehleSchritte, type StepNode } from './steps';

/**
 * Die Prüfung vor dem Einschalten (§22).
 *
 * Eine Automation, die auf einen gelöschten Kanal schreibt, scheitert erst
 * dann - wenn sie läuft, oft nachts, und niemand hinsieht. Die Prüfung holt
 * diesen Moment nach vorne: sie fragt jede Aktion und jede Bedingung, ob ihre
 * Voraussetzungen noch stimmen.
 *
 * Zwei Schweregrade, und der Unterschied ist wichtig:
 *
 * - **Fehler** verhindern das Einschalten. Etwas ist unstimmig, und die
 *   Automation täte nicht, was dasteht.
 * - **Warnung** verhindert nichts. Etwas ist auffällig, aber vielleicht
 *   beabsichtigt - eine Automation ohne Bedingungen etwa läuft bei jedem
 *   Ereignis, und manchmal ist genau das gewollt.
 *
 * Die Prüfung fragt die Registries, nicht eine Liste in dieser Datei. Ein
 * neues Modul bringt seine Prüfungen selbst mit.
 */

export interface Pruefeingabe {
  guildId: string;
  triggerType: string;
  triggerConfig: unknown;
  conditions: unknown;
  steps: unknown;
  gateway: DiscordGateway;
}

export interface Pruefbericht {
  /** `true`, wenn kein Fehler vorliegt. Warnungen stehen dem nicht entgegen. */
  einschaltbar: boolean;
  probleme: ValidationIssue[];
}

/**
 * Rollen und Kanäle einmal laden.
 *
 * Ohne das fragte jede Aktion einzeln nach - bei zwanzig Schritten zwanzig
 * Mal dieselbe Liste.
 */
async function umgebung(guildId: string, gateway: DiscordGateway): Promise<ValidationEnvironment> {
  const [rollen, kanaele] = await Promise.all([
    gateway.roles.list().catch(() => []),
    gateway.channels.list().catch(() => []),
  ]);
  return {
    guildId,
    gateway,
    rollenIds: new Set(rollen.map((rolle) => rolle.id)),
    kanalIds: new Set(kanaele.map((kanal) => kanal.id)),
  };
}

export async function pruefeAutomation(eingabe: Pruefeingabe): Promise<Pruefbericht> {
  const probleme: ValidationIssue[] = [];
  const feld = await umgebung(eingabe.guildId, eingabe.gateway);

  // --- Trigger --------------------------------------------------------------
  const trigger = getTrigger(eingabe.triggerType);
  if (!trigger) {
    probleme.push({
      severity: 'error',
      message: `Den Auslöser «${eingabe.triggerType}» gibt es nicht (mehr).`,
      path: 'trigger',
    });
  } else {
    const geprueft = trigger.configSchema.safeParse(eingabe.triggerConfig);
    if (!geprueft.success) {
      probleme.push({
        severity: 'error',
        message: geprueft.error.issues[0]?.message ?? 'Der Auslöser ist unvollständig.',
        path: 'trigger',
      });
    } else if (trigger.validate) {
      probleme.push(...(await sicher(() => trigger.validate!(geprueft.data, feld), 'trigger')));
    }
  }

  // --- Bedingungen ----------------------------------------------------------
  const bedingungen = (eingabe.conditions ?? null) as ConditionNode | null;
  for (const typ of sammleTypen(bedingungen)) {
    const definition = getCondition(typ);
    if (!definition) {
      probleme.push({
        severity: 'error',
        message: `Die Bedingung «${typ}» gibt es nicht (mehr).`,
        path: 'conditions',
      });
    }
  }
  probleme.push(...(await pruefeBedingungsbaum(bedingungen, feld, 'conditions')));

  // --- Schritte -------------------------------------------------------------
  const geprueft = stepsSchema.safeParse(eingabe.steps);
  if (!geprueft.success) {
    probleme.push({
      severity: 'error',
      message: geprueft.error.issues[0]?.message ?? 'Die Schrittfolge ist ungültig.',
      path: 'steps',
    });
    return { einschaltbar: false, probleme };
  }

  const schritte = geprueft.data;
  const anzahl = zaehleSchritte(schritte);
  if (anzahl === 0) {
    probleme.push({ severity: 'error', message: 'Die Automation tut nichts.', path: 'steps' });
  }
  if (anzahl > LIMITS.maxSteps) {
    probleme.push({
      severity: 'error',
      message: `Höchstens ${LIMITS.maxSteps} Schritte - diese hat ${anzahl}.`,
      path: 'steps',
    });
  }

  probleme.push(...(await pruefeSchritte(schritte, feld, 'steps')));

  // --- Hinweise -------------------------------------------------------------
  if (trigger && !bedingungen && trigger.id === 'event') {
    probleme.push({
      severity: 'warning',
      message: 'Ohne Bedingung läuft diese Automation bei jedem passenden Ereignis.',
      path: 'conditions',
    });
  }

  return {
    einschaltbar: !probleme.some((problem) => problem.severity === 'error'),
    probleme,
  };
}

async function pruefeBedingungsbaum(
  knoten: ConditionNode | null | undefined,
  feld: ValidationEnvironment,
  pfad: string,
): Promise<ValidationIssue[]> {
  if (!knoten) {
    return [];
  }
  if (knoten.art === 'gruppe') {
    const alle: ValidationIssue[] = [];
    for (const [index, kind] of knoten.kinder.entries()) {
      alle.push(...(await pruefeBedingungsbaum(kind, feld, `${pfad}.${index}`)));
    }
    return alle;
  }

  const definition = getCondition(knoten.typ);
  if (!definition) {
    return [];
  }
  const geprueft = definition.configSchema.safeParse(knoten.config);
  if (!geprueft.success) {
    return [
      {
        severity: 'error',
        message: `«${definition.label}»: ${geprueft.error.issues[0]?.message ?? 'unvollständig'}`,
        path: pfad,
      },
    ];
  }
  if (!definition.validate) {
    return [];
  }
  return sicher(() => definition.validate!(geprueft.data, feld), pfad);
}

async function pruefeSchritte(
  schritte: StepNode[],
  feld: ValidationEnvironment,
  pfad: string,
): Promise<ValidationIssue[]> {
  const alle: ValidationIssue[] = [];

  for (const [index, schritt] of schritte.entries()) {
    const eigenerPfad = `${pfad}.${index}`;

    if (schritt.art === 'warten') {
      continue;
    }

    if (schritt.art === 'wenn') {
      alle.push(...(await pruefeBedingungsbaum(schritt.bedingung, feld, `${eigenerPfad}.bedingung`)));
      alle.push(...(await pruefeSchritte(schritt.dann, feld, `${eigenerPfad}.dann`)));
      alle.push(...(await pruefeSchritte(schritt.sonst, feld, `${eigenerPfad}.sonst`)));
      if (schritt.dann.length === 0 && schritt.sonst.length === 0) {
        alle.push({ severity: 'warning', message: 'Diese Verzweigung hat keine Zweige.', path: eigenerPfad });
      }
      continue;
    }

    const definition = getAction(schritt.typ);
    if (!definition) {
      alle.push({
        severity: 'error',
        message: `Die Aktion «${schritt.typ}» gibt es nicht (mehr).`,
        path: eigenerPfad,
      });
      continue;
    }

    const geprueft = definition.configSchema.safeParse(schritt.config);
    if (!geprueft.success) {
      alle.push({
        severity: 'error',
        message: `«${definition.label}»: ${geprueft.error.issues[0]?.message ?? 'unvollständig'}`,
        path: eigenerPfad,
      });
      continue;
    }

    if (definition.validate) {
      alle.push(...(await sicher(() => definition.validate!(geprueft.data, feld), eigenerPfad)));
    }
  }

  return alle;
}

/**
 * Eine Prüfung, die selbst scheitern darf.
 *
 * Wenn Discord gerade nicht antwortet, soll das eine Warnung sein und kein
 * Fehler: die Automation ist deswegen nicht kaputt, sie liess sich nur nicht
 * vollständig prüfen. Ein Fehler daraus zu machen hiesse, dass niemand
 * einschalten kann, solange Discord hakt.
 */
async function sicher(
  pruefung: () => Promise<ValidationIssue[]>,
  pfad: string,
): Promise<ValidationIssue[]> {
  try {
    const ergebnis = await pruefung();
    return ergebnis.map((problem) => ({ ...problem, path: problem.path ?? pfad }));
  } catch {
    return [
      {
        severity: 'warning',
        message: 'Dieser Teil liess sich gerade nicht prüfen.',
        path: pfad,
      },
    ];
  }
}

/**
 * Welche Ereignisse eine Automation auslösen kann - für die Anzeige.
 *
 * Zeigt im Builder, welche Variablen zur Verfügung stehen: die eines
 * Ereignisses stehen nur dann bereit, wenn die Automation auch von ihm
 * ausgelöst wird.
 */
export function ereignisEinerAutomation(
  triggerType: string,
  triggerConfig: unknown,
): ReturnType<typeof getEventDefinition> {
  if (triggerType !== 'event') {
    return undefined;
  }
  const typ = (triggerConfig as { eventType?: unknown })?.eventType;
  return typeof typ === 'string' ? getEventDefinition(typ) : undefined;
}
