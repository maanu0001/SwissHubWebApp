'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { logs } from '@swisshub/modules';
import { defineAction } from '@/server/action';

/**
 * Server Actions der Discord-Log-Kanäle.
 *
 * Drei Berechtigungen, drei Aktionen - und die Trennung ist Absicht:
 *
 * - **`manage`** ändert, wohin Logs gehen. Das ist eine Entscheidung mit
 *   Reichweite: ein falsch gesetzter Kanal schreibt Moderationsvorgänge in
 *   einen Raum, den womöglich der halbe Server liest.
 * - **`test`** schreibt eine sichtbare Nachricht in einen fremden Kanal. Wer
 *   die Einrichtung nur ansehen darf, soll das nicht ungefragt können.
 *
 * Geprüft wird beides serverseitig über `defineAction` - die Oberfläche
 * versteckt nur, was ohnehin abgewiesen würde.
 */

const KATEGORIEN = logs.LOG_KATEGORIE_IDS as [string, ...string[]];

const kategorieSchema = z.enum(KATEGORIEN);
/** Eine Discord-Snowflake, oder ausdrücklich keine. */
const kanalSchema = z
  .string()
  .regex(/^\d{17,20}$/u)
  .nullable();

function aktualisiere(): void {
  revalidatePath('/system/log-kanaele');
}

export const setzeLogKanalAction = defineAction(
  {
    name: 'setzeLogKanal',
    permission: 'logs.discord.manage',
    freshness: 'critical',
    schema: z.object({ category: kategorieSchema, channelId: kanalSchema }),
  },
  async ({ ctx, input }) => {
    await logs.setzeZiel({
      category: input.category as never,
      channelId: input.channelId,
      actor: { discordId: ctx.user.discordId, username: ctx.user.username },
    });
    aktualisiere();
    return { ok: true };
  },
);

/**
 * Alle Kategorien auf einen Kanal legen.
 *
 * Setzt schlicht jede einzelne Zuweisung - es entsteht **kein** zweiter
 * «globaler Kanal» neben den Kategorien. Wer danach eine Kategorie umhängt,
 * hängt genau diese um, und die übrigen bleiben stehen.
 */
export const setzeAlleLogKanaeleAction = defineAction(
  {
    name: 'setzeAlleLogKanaele',
    permission: 'logs.discord.manage',
    freshness: 'critical',
    schema: z.object({ channelId: kanalSchema }),
  },
  async ({ ctx, input }) => {
    const actor = { discordId: ctx.user.discordId, username: ctx.user.username };
    for (const category of logs.LOG_KATEGORIE_IDS) {
      await logs.setzeZiel({ category, channelId: input.channelId, actor });
    }
    aktualisiere();
    return { ok: true };
  },
);

export const sendeLogTestAction = defineAction(
  {
    name: 'sendeLogTest',
    permission: 'logs.discord.test',
    schema: z.object({ category: kategorieSchema }),
  },
  async ({ ctx, input }) => {
    await logs.sendeTestnachricht(input.category as never, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    return { ok: true };
  },
);
