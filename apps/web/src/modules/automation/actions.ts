'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import { discord } from '@swisshub/discord';
import { automation as automationModul } from '@swisshub/modules';
import {
  AUDIT_ACTIONS,
  prisma,
  recordAudit,
} from '@swisshub/database';
import {
  aendere,
  archiviere,
  brichAb,
  conditionNodeSchema,
  entscheideFreigabe,
  getAction,
  getTemplate,
  holeAutomation,
  legeAn,
  pruefeAutomation,
  schalte,
  starte,
  stepsSchema,
} from '@swisshub/automation';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = automationModul.AUTOMATION_MODULE_ID;
const P = automationModul.AUTOMATION_PERMISSIONS;

/**
 * Server Actions der Automation Engine.
 *
 * Eine Server Action ist ein oeffentlicher Endpunkt. Dass ein Knopf im
 * Browser fehlt, ist Bequemlichkeit und keine Absicherung - jede Pruefung
 * steht deshalb hier und nicht in der Oberflaeche (§21).
 *
 * Zwei Pruefungen gehen ueber die uebliche Kette hinaus, weil sie sich aus
 * dem Inhalt der Automation ergeben und nicht aus ihrem Namen:
 *
 * 1. **Aktionsberechtigungen.** Eine Aktion darf eine eigene Berechtigung
 *    verlangen - XP vergeben etwa dieselbe wie der Griff von Hand. Wer sie
 *    nicht hat, darf keine Automation speichern, die sie enthaelt. Ohne
 *    diese Pruefung waere die Engine ein Weg, jede Berechtigung des Systems
 *    zu umgehen.
 * 2. **Die Gilde.** Sie kommt aus der Sitzung, nie aus der Eingabe. Eine
 *    Automation aus einer fremden Gilde ist damit nicht einmal lesbar.
 */

function revalidateAutomationen(): void {
  revalidatePath('/automationen');
  revalidatePath('/automationen/ausfuehrungen');
  revalidatePath('/automationen/fehler');
  revalidatePath('/dashboard');
}

const akteurVon = (ctx: AuthContext) => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

/** Die Gilde der Sitzung. Nie aus der Eingabe. */
async function guildIdVonSitzung(ctx: AuthContext): Promise<string> {
  void ctx;
  const { resolveGuildId } = await import('@swisshub/discord');
  return resolveGuildId();
}

/**
 * Darf dieser Mensch jede Aktion verwenden, die in der Schrittfolge steht?
 *
 * Rekursiv, weil eine Verzweigung Schritte enthaelt. Eine fehlende
 * Berechtigung bricht ab - nicht mit «gespeichert, aber der Schritt wurde
 * entfernt», sondern mit einer Meldung, die den Grund nennt.
 */
function pruefeAktionsrechte(ctx: AuthContext, schritte: unknown): void {
  const geprueft = stepsSchema.safeParse(schritte);
  if (!geprueft.success) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: geprueft.error.issues[0]?.message ?? 'Die Schrittfolge ist ungültig.',
    });
  }

  const pruefe = (liste: typeof geprueft.data): void => {
    for (const schritt of liste) {
      if (schritt.art === 'wenn') {
        pruefe(schritt.dann);
        pruefe(schritt.sonst);
        continue;
      }
      if (schritt.art !== 'aktion') {
        continue;
      }
      const definition = getAction(schritt.typ);
      if (!definition) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: `Die Aktion «${schritt.typ}» gibt es nicht.`,
        });
      }
      if (definition.requiredPermission && !can(ctx, definition.requiredPermission)) {
        throw new AppError('FORBIDDEN', {
          userMessage: `Für «${definition.label}» fehlt dir die Berechtigung.`,
        });
      }
    }
  };

  pruefe(geprueft.data);
}

const automationEingabeSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  triggerType: z.string().min(1).max(64),
  triggerConfig: z.record(z.unknown()),
  conditions: conditionNodeSchema.nullable().optional(),
  steps: stepsSchema,
  concurrency: z.enum(['ALLOW', 'SKIP_IF_RUNNING', 'QUEUE']).default('ALLOW'),
  concurrencyKey: z.string().trim().max(200).nullable().optional(),
  maxRunsPerMinute: z.number().int().min(0).max(600).default(60),
});

export const erstelleAutomationAction = defineAction(
  {
    name: 'automation.create',
    module: MODULE_ID,
    permission: P.create,
    schema: automationEingabeSchema,
    rateLimit: 'automationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    pruefeAktionsrechte(ctx, input.steps);

    const guildId = await guildIdVonSitzung(ctx);
    const automation = await legeAn(
      {
        guildId,
        name: input.name,
        description: input.description ?? null,
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig,
        conditions: input.conditions ?? null,
        steps: input.steps,
        concurrency: input.concurrency,
        concurrencyKey: input.concurrencyKey ?? null,
        maxRunsPerMinute: input.maxRunsPerMinute,
      },
      akteurVon(ctx),
    );

    revalidateAutomationen();
    return { id: automation.id };
  },
);

export const aendereAutomationAction = defineAction(
  {
    name: 'automation.update',
    module: MODULE_ID,
    permission: P.edit,
    schema: automationEingabeSchema.extend({ id: z.string().min(1) }),
    rateLimit: 'automationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    pruefeAktionsrechte(ctx, input.steps);

    const guildId = await guildIdVonSitzung(ctx);
    const automation = await aendere(
      guildId,
      input.id,
      {
        guildId,
        name: input.name,
        description: input.description ?? null,
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig,
        conditions: input.conditions ?? null,
        steps: input.steps,
        concurrency: input.concurrency,
        concurrencyKey: input.concurrencyKey ?? null,
        maxRunsPerMinute: input.maxRunsPerMinute,
      },
      akteurVon(ctx),
    );

    revalidateAutomationen();
    return { id: automation.id, version: automation.version };
  },
);

/**
 * Ein- und Ausschalten.
 *
 * Vor dem Einschalten wird geprueft (§22) - und zwar hier, wo ein
 * Discord-Zugang zur Verfuegung steht. Ein Fehler verhindert das
 * Einschalten; eine Warnung nicht, denn sie ist ein Hinweis und kein Mangel.
 */
export const schalteAutomationAction = defineAction(
  {
    name: 'automation.toggle',
    module: MODULE_ID,
    permission: P.enable,
    schema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
    rateLimit: 'automationToggle',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await guildIdVonSitzung(ctx);
    const automation = await holeAutomation(guildId, input.id);
    if (!automation) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Automation gibt es nicht.' });
    }
    if (automation.kind === 'SYSTEM' && !can(ctx, P.systemManage)) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Systemautomationen darf nur verwalten, wer die Berechtigung dafür hat.',
      });
    }

    if (input.enabled) {
      pruefeAktionsrechte(ctx, automation.steps);

      const grenze = (await automationSettings()).maxAktive;
      const aktive = await prisma.automation.count({
        where: { guildId, enabled: true, archivedAt: null },
      });
      if (aktive >= grenze) {
        throw new AppError('CONFLICT', {
          userMessage: `Es sind bereits ${grenze} Automationen eingeschaltet. Schalte zuerst eine aus.`,
        });
      }

      const bericht = await pruefeAutomation({
        guildId,
        triggerType: automation.triggerType,
        triggerConfig: automation.triggerConfig,
        conditions: automation.conditions,
        steps: automation.steps,
        gateway: discord,
      });
      if (!bericht.einschaltbar) {
        return { eingeschaltet: false, probleme: bericht.probleme };
      }
    }

    await schalte(guildId, input.id, input.enabled, akteurVon(ctx));
    revalidateAutomationen();
    return { eingeschaltet: input.enabled, probleme: [] };
  },
);

export const loescheAutomationAction = defineAction(
  {
    name: 'automation.delete',
    module: MODULE_ID,
    permission: P.delete,
    schema: z.object({ id: z.string().min(1) }),
    rateLimit: 'automationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await guildIdVonSitzung(ctx);
    await archiviere(guildId, input.id, akteurVon(ctx));
    revalidateAutomationen();
    return { ok: true };
  },
);

/**
 * Pruefen, ohne zu speichern.
 *
 * Der Bericht ist dasselbe, was das Einschalten verlangt - deshalb kann
 * niemand ueberrascht werden: was hier gruen ist, laesst sich einschalten.
 */
export const pruefeAutomationAction = defineAction(
  {
    name: 'automation.validate',
    module: MODULE_ID,
    permission: P.view,
    schema: z.object({
      triggerType: z.string().min(1).max(64),
      triggerConfig: z.record(z.unknown()),
      conditions: conditionNodeSchema.nullable().optional(),
      steps: stepsSchema,
    }),
    rateLimit: 'automationWrite',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await guildIdVonSitzung(ctx);
    const bericht = await pruefeAutomation({
      guildId,
      triggerType: input.triggerType,
      triggerConfig: input.triggerConfig,
      conditions: input.conditions ?? null,
      steps: input.steps,
      gateway: discord,
    });
    return bericht;
  },
);

/**
 * Von Hand starten - echt oder als Probelauf.
 *
 * Der Probelauf prueft Bedingungen echt und beschreibt Aktionen, statt sie
 * auszufuehren (§23). Das ist die einzige Moeglichkeit, eine Automation
 * gefahrlos anzusehen - und deshalb darf er nichts auslassen, was die
 * Antwort verfaelschen wuerde.
 */
export const starteAutomationAction = defineAction(
  {
    name: 'automation.execute',
    module: MODULE_ID,
    permission: P.execute,
    schema: z.object({ id: z.string().min(1), dryRun: z.boolean().default(true) }),
    rateLimit: 'automationExecute',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await guildIdVonSitzung(ctx);
    const automation = await holeAutomation(guildId, input.id);
    if (!automation) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Automation gibt es nicht.' });
    }

    // Auch von Hand gilt die Berechtigung je Aktion. Sonst waere «starten»
    // ein Weg, eine Aktion auszufuehren, die man nicht bauen duerfte.
    pruefeAktionsrechte(ctx, automation.steps);

    const ergebnis = await starte({
      automation,
      trigger: 'manual',
      guildId,
      gateway: discord,
      dryRun: input.dryRun,
      actorId: ctx.user.discordId,
    });

    if (!input.dryRun) {
      await recordAudit({
        action: AUDIT_ACTIONS.AUTOMATION_EXECUTED,
        module: MODULE_ID,
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetLabel: automation.name,
        metadata: { automationId: automation.id, runId: ergebnis.runId, status: ergebnis.status },
      });
      revalidateAutomationen();
    }

    return ergebnis;
  },
);

export const brichLaufAbAction = defineAction(
  {
    name: 'automation.run.cancel',
    module: MODULE_ID,
    permission: P.execute,
    schema: z.object({ runId: z.string().min(1) }),
    rateLimit: 'automationExecute',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await guildIdVonSitzung(ctx);
    const ok = await brichAb(guildId, input.runId, akteurVon(ctx));
    revalidateAutomationen();
    return { ok };
  },
);

/**
 * Eine angehaltene Aktion freigeben oder ablehnen (§32).
 *
 * Eine eigene, kritische Berechtigung: wer freigibt, laesst genau die Aktion
 * geschehen, die die Engine bewusst nicht selbst ausfuehren wollte.
 */
export const entscheideFreigabeAction = defineAction(
  {
    name: 'automation.approval.decide',
    module: MODULE_ID,
    permission: P.approve,
    schema: z.object({
      approvalId: z.string().min(1),
      genehmigt: z.boolean(),
      grund: z.string().trim().max(300).optional(),
    }),
    rateLimit: 'automationExecute',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await guildIdVonSitzung(ctx);
    const ergebnis = await entscheideFreigabe(
      guildId,
      input.approvalId,
      input.genehmigt,
      akteurVon(ctx),
      { ...(input.grund ? { grund: input.grund } : {}), gateway: discord },
    );
    revalidateAutomationen();
    return ergebnis;
  },
);

/**
 * Eine Vorlage uebernehmen.
 *
 * Entsteht als gewoehnlicher Entwurf - ausgeschaltet, versioniert, mit
 * derselben Pruefung wie jede andere. Eine Vorlage ist eine Abkuerzung beim
 * Anlegen und kein Sonderfall im Ausfuehrer.
 */
export const uebernimmVorlageAction = defineAction(
  {
    name: 'automation.template.apply',
    module: MODULE_ID,
    permission: P.create,
    schema: z.object({ vorlageId: z.string().min(1), name: z.string().trim().max(120).optional() }),
    rateLimit: 'automationWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const vorlage = getTemplate(input.vorlageId);
    if (!vorlage) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Vorlage gibt es nicht.' });
    }
    pruefeAktionsrechte(ctx, vorlage.steps);

    const guildId = await guildIdVonSitzung(ctx);
    const automation = await legeAn(
      {
        guildId,
        name: input.name?.trim() || vorlage.name,
        description: vorlage.description,
        triggerType: vorlage.triggerType,
        triggerConfig: vorlage.triggerConfig,
        conditions: vorlage.conditions ?? null,
        steps: vorlage.steps,
      },
      akteurVon(ctx),
    );

    revalidateAutomationen();
    return { id: automation.id, auszufuellen: vorlage.auszufuellen ?? [] };
  },
);

async function automationSettings(): Promise<automationModul.AutomationSettings> {
  const { getModuleSettings } = await import('@swisshub/modules');
  return getModuleSettings<automationModul.AutomationSettings>(MODULE_ID);
}
