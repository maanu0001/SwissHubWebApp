'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, prisma, recordAudit } from '@swisshub/database';
import { discord, resolveGuildId } from '@swisshub/discord';
import { migration } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = migration.MIGRATION_MODULE_ID;
const P = migration.MIGRATION_PERMISSIONS;

/**
 * Die Aktionen der Übertragung.
 *
 * Jeder Schritt hat seine eigene Berechtigung, und die Reihenfolge ist keine
 * Höflichkeit: exportieren, einlesen, zuordnen, rechnen, anwenden. Wer
 * anwenden will, braucht einen Lauf mit einem Probelauf darin - das erzwingt
 * der Server und nicht der Assistent, denn ein Assistent ist eine Abfolge
 * von Bildschirmen und keine Sicherung.
 */

const runIdSchema = z.object({ runId: z.string().cuid('Ungültige Kennung.') });

/** Die Guild der Sitzung. Nie aus der Eingabe - siehe Automationen. */
async function quellGuild(): Promise<string> {
  return resolveGuildId();
}

/**
 * Die Konfiguration als Paket.
 *
 * Liest und verändert nichts. Was zurückkommt, ist die Datei, die auch der
 * Download liefert - ohne Zugangsdaten, weil sie gar nicht erst gelesen
 * werden.
 */
export const erstellePaketAction = defineAction(
  {
    name: 'migration.export',
    module: MODULE_ID,
    permission: P.export,
    schema: z.object({}),
    rateLimit: 'migration',
    freshness: 'cached',
  },
  async ({ ctx }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await quellGuild();
    const guild = await discord.guild.get().catch(() => null);

    const paket = await migration.erstellePaket({
      id: guildId,
      name: guild?.name ?? 'SwissHub',
    });

    await recordAudit({
      action: AUDIT_ACTIONS.MIGRATION_EXPORTED,
      module: MODULE_ID,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: 'Konfiguration exportiert',
      metadata: { module: paket.modules.length, rollen: paket.roles.length },
    });

    return { paket };
  },
);

/**
 * Eine Übertragung anlegen.
 *
 * Entweder aus der eigenen Konfiguration oder aus einer hochgeladenen Datei.
 * Die Datei geht durch `lesePaket` - Grösse, Fassung, Schema, Geheimnissuche -
 * und nicht durch `JSON.parse` in ein `create`.
 */
export const legeUebertragungAnAction = defineAction(
  {
    name: 'migration.create',
    module: MODULE_ID,
    permission: P.import,
    schema: z.object({
      targetGuildId: z.string().regex(/^\d{17,20}$/u, 'Keine gültige Discord-ID.'),
      /** Fehlt sie, wird die eigene Konfiguration genommen. */
      paketJson: z.string().max(migration.MAX_PACKAGE_BYTES).optional(),
      /** Ausdrückliche Bestätigung, dass auf dieselbe Guild geschrieben wird. */
      gleicheGuildErlaubt: z.boolean().default(false),
    }),
    rateLimit: 'migration',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const quelle = await quellGuild();

    if (input.targetGuildId === quelle && !input.gleicheGuildErlaubt) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage:
          'Ziel und Quelle sind dieselbe Guild. Wenn das Absicht ist, muss es ausdrücklich bestätigt werden.',
      });
    }

    // Ist der Bot dort überhaupt? Eine freie Guild-ID ohne Prüfung wäre ein
    // Weg, die Konfiguration irgendwohin zu schreiben.
    await pruefeZielGuild(input.targetGuildId);

    const guild = await discord.guild.get().catch(() => null);
    const paket = input.paketJson
      ? migration.lesePaket(input.paketJson)
      : await migration.erstellePaket({ id: quelle, name: guild?.name ?? 'SwissHub' });

    if (input.paketJson) {
      await recordAudit({
        action: AUDIT_ACTIONS.MIGRATION_IMPORTED,
        module: MODULE_ID,
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetLabel: `Paket eingelesen (${paket.sourceGuild.name})`,
        metadata: { module: paket.modules.length, fassung: paket.schemaVersion },
      });
    }

    const lauf = await migration.legeLaufAn({
      sourceGuildId: quelle,
      sourceGuildName: guild?.name ?? 'SwissHub',
      targetGuildId: input.targetGuildId,
      paket,
      actor: { discordId: ctx.user.discordId, username: ctx.user.username },
    });

    revalidatePath('/migrate');
    return { runId: lauf.id };
  },
);

/**
 * Ist das Ziel benutzbar?
 *
 * Der Bot muss dort sein, und die Guild muss antworten. Eine ID, hinter der
 * nichts steht, wird hier abgewiesen und nicht erst mitten in der
 * Übertragung.
 */
async function pruefeZielGuild(targetGuildId: string): Promise<void> {
  const eigene = await resolveGuildId();
  if (targetGuildId === eigene) {
    return;
  }

  // Der Bot spricht in dieser Installation mit genau einer Guild. Eine
  // fremde Guild-ID lässt sich von hier aus nicht prüfen - und was sich
  // nicht prüfen lässt, wird nicht angenommen.
  throw new AppError('VALIDATION_FAILED', {
    userMessage:
      'Der Bot ist auf dieser Guild nicht verbunden. Zuerst den Bot auf den Zielserver einladen und die Guild in den Einstellungen verbinden.',
  });
}

/** Vorschläge für die Zuordnung - nach Namen, exakt. */
export const schlageZuordnungVorAction = defineAction(
  {
    name: 'migration.suggest',
    module: MODULE_ID,
    permission: P.dryRun,
    schema: runIdSchema,
    rateLimit: 'migration',
    freshness: 'cached',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const lauf = await migration.holeLauf(input.runId, await quellGuild());
    const paket = migration.paketVon(lauf);

    const [zielRollen, zielKanaele] = await Promise.all([
      discord.roles.list({ force: true }).catch(() => []),
      discord.channels.list().catch(() => []),
    ]);

    const quellKanaele = migration.kanaeleImPaket(paket).map((id) => ({ id, name: id }));

    return {
      roles: migration.schlageRollenVor(paket.roles, zielRollen),
      channels: migration.schlageKanaeleVor(quellKanaele, zielKanaele),
      zielRollen: zielRollen.map((rolle) => ({ id: rolle.id, name: rolle.name })),
      zielKanaele: zielKanaele.map((kanal) => ({ id: kanal.id, name: kanal.name })),
    };
  },
);

const zuordnungSchema = z.object({
  runId: z.string().cuid(),
  roles: z
    .array(
      z.object({
        quelle: z.string().regex(/^\d{17,20}$/u),
        quellName: z.string().max(200),
        art: z.enum(['MAP', 'CREATE', 'SKIP']),
        ziel: z
          .string()
          .regex(/^\d{17,20}$/u)
          .nullable(),
        zielName: z.string().max(200).nullable(),
        vorschlag: z.boolean(),
      }),
    )
    .max(200),
  channels: z
    .array(
      z.object({
        quelle: z.string().regex(/^\d{17,20}$/u),
        quellName: z.string().max(200),
        art: z.enum(['MAP', 'CREATE', 'SKIP']),
        ziel: z
          .string()
          .regex(/^\d{17,20}$/u)
          .nullable(),
        zielName: z.string().max(200).nullable(),
        vorschlag: z.boolean(),
      }),
    )
    .max(500),
});

export const speichereZuordnungAction = defineAction(
  {
    name: 'migration.map',
    module: MODULE_ID,
    permission: P.dryRun,
    schema: zuordnungSchema,
    rateLimit: 'migration',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const lauf = await migration.speichereZuordnung(
      input.runId,
      await quellGuild(),
      { roles: input.roles, channels: input.channels },
      { discordId: ctx.user.discordId, username: ctx.user.username },
    );
    revalidatePath(`/migrate/${input.runId}`);
    return { status: lauf.status };
  },
);

/**
 * Der Probelauf.
 *
 * Rechnet und schreibt nicht. Das Ergebnis wird am Lauf gespeichert, damit
 * das Anwenden gleich darauf zeigen kann - und damit sich nachlesen lässt,
 * was jemand gesehen hat, bevor er zugestimmt hat.
 */
export const probelaufAction = defineAction(
  {
    name: 'migration.dryRun',
    module: MODULE_ID,
    permission: P.dryRun,
    schema: runIdSchema,
    rateLimit: 'migration',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const lauf = await migration.holeLauf(input.runId, await quellGuild());
    if (!migration.istAenderbar(lauf.status)) {
      throw new AppError('CONFLICT', { userMessage: 'Diese Übertragung wurde bereits angewendet.' });
    }

    const plan = await migration.berechnePlan(migration.paketVon(lauf), migration.zuordnungVon(lauf));
    await migration.speicherePlan(input.runId, plan, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    revalidatePath(`/migrate/${input.runId}`);
    return { plan };
  },
);

/**
 * Anwenden.
 *
 * Drei Bedingungen, alle serverseitig: die Berechtigung, ein Probelauf, der
 * vorliegt, und eine ausdrückliche Bestätigung. Die letzte ist kein
 * Häkchen zur Zierde - danach stehen die Berechtigungen einer ganzen
 * Installation anders da.
 */
export const wendeAnAction = defineAction(
  {
    name: 'migration.execute',
    module: MODULE_ID,
    permission: P.execute,
    schema: z.object({
      runId: z.string().cuid(),
      bestaetigt: z.literal(true, {
        errorMap: () => ({ message: 'Die Übertragung muss ausdrücklich bestätigt werden.' }),
      }),
    }),
    rateLimit: 'migration',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const quelle = await quellGuild();
    const lauf = await migration.holeLauf(input.runId, quelle);

    if (!migration.istAenderbar(lauf.status)) {
      throw new AppError('CONFLICT', {
        userMessage: 'Diese Übertragung läuft bereits oder ist abgeschlossen.',
      });
    }
    if (migration.planVon(lauf) === null) {
      throw new AppError('CONFLICT', {
        userMessage: 'Vor dem Anwenden muss ein Probelauf gemacht werden.',
      });
    }

    // Beanspruchen, ehe gearbeitet wird: zwei Klicks duerfen nicht zwei
    // Uebertragungen anstossen.
    const beansprucht = await prisma.migrationRun.updateMany({
      where: { id: input.runId, status: { in: ['DRAFT', 'VALIDATING', 'READY'] } },
      data: { status: 'RUNNING', startedAt: new Date(), error: null },
    });
    if (beansprucht.count === 0) {
      throw new AppError('CONFLICT', { userMessage: 'Diese Übertragung läuft bereits.' });
    }

    await recordAudit({
      action: AUDIT_ACTIONS.MIGRATION_STARTED,
      module: MODULE_ID,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: `Übertragung nach ${lauf.targetGuildId}`,
      metadata: { runId: input.runId },
    });

    const ergebnis = await migration.wendeAn(
      input.runId,
      migration.paketVon(lauf),
      migration.zuordnungVon(lauf),
      { discordId: ctx.user.discordId, username: ctx.user.username },
    );

    await prisma.migrationRun.update({
      where: { id: input.runId },
      data: {
        status: ergebnis.status,
        report: ergebnis as never,
        finishedAt: new Date(),
        error: ergebnis.status === 'COMPLETED' ? null : 'Nicht alle Phasen sind durchgelaufen.',
      },
    });

    await recordAudit({
      action:
        ergebnis.status === 'COMPLETED' ? AUDIT_ACTIONS.MIGRATION_COMPLETED : AUDIT_ACTIONS.MIGRATION_FAILED,
      module: MODULE_ID,
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: `Übertragung ${ergebnis.status}`,
      metadata: { runId: input.runId, phasen: ergebnis.phasen.length },
    });

    revalidatePath('/migrate');
    revalidatePath(`/migrate/${input.runId}`);
    return ergebnis;
  },
);

/**
 * Zurücknehmen.
 *
 * Dreht die Konfiguration auf den Stand zurück, der vor dem Anwenden
 * gesichert wurde. Discord-Objekte bleiben, wie sie sind - was dort entstand,
 * könnte inzwischen benutzt werden, und Löschen wäre die Vermutung, dass
 * niemand sonst gearbeitet hat.
 */
export const nimmZurueckAction = defineAction(
  {
    name: 'migration.rollback',
    module: MODULE_ID,
    permission: P.rollback,
    schema: runIdSchema,
    rateLimit: 'migration',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const lauf = await migration.holeLauf(input.runId, await quellGuild());

    const snapshot = lauf.snapshot as unknown as migration.Snapshot | null;
    if (!snapshot) {
      throw new AppError('CONFLICT', {
        userMessage: 'Zu dieser Übertragung gibt es keinen gesicherten Stand.',
      });
    }

    const zurueck = await migration.stelleWiederHer(snapshot, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    await prisma.migrationRun.update({
      where: { id: input.runId },
      data: { status: 'ROLLED_BACK', finishedAt: new Date() },
    });

    revalidatePath('/migrate');
    revalidatePath(`/migrate/${input.runId}`);
    return { zurueckgedreht: zurueck };
  },
);
