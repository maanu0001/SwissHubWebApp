import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { can } from '@swisshub/auth';
import { analytics, isModuleEnabled } from '@swisshub/modules';
import { sanitizeText } from '@swisshub/shared';
import { getActionAuthContext } from '@/server/auth';
import { analyticsAbilities, analyticsGuildId } from '@/server/analytics';
import { enforceRateLimit } from '@/server/rate-limit';
import type { DiscordEventCategory } from '@swisshub/database';

/**
 * CSV-Export des gefilterten Verlaufs.
 *
 * Der Export ist keine Hintertuer um die Berechtigungen herum: wer die
 * Nachrichteninhalte nicht sehen darf, bekommt eine Datei ohne diese Spalten -
 * nicht eine mit leeren Feldern, sondern eine ohne die Spalten, damit
 * niemand aus einer leeren Zelle schliesst, es habe nichts darin gestanden.
 *
 * Jeder Export wird protokolliert. Er nimmt Daten aus dem System heraus, und
 * ab dann gilt hier keine Berechtigung mehr.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Obergrenze einer Ausgabe. Ein Export ist ein Ausschnitt, kein Abzug. */
const MAX_ZEILEN = 5000;

const querySchema = z.object({
  kategorie: z.string().optional(),
  akteur: z.string().optional(),
  betroffen: z.string().optional(),
  suche: z.string().max(100).optional(),
  von: z.string().max(10).optional(),
  bis: z.string().max(10).optional(),
});

function alsDatum(wert: string | undefined, endeDesTages = false): Date | undefined {
  if (!wert || !/^\d{4}-\d{2}-\d{2}$/u.test(wert)) {
    return undefined;
  }
  const datum = new Date(`${wert}T${endeDesTages ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(datum.getTime()) ? undefined : datum;
}

const KATEGORIEN: DiscordEventCategory[] = ['MESSAGE', 'VOICE', 'MEMBER', 'ROLE', 'CHANNEL', 'SERVER'];

export async function GET(request: Request): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, analytics.ANALYTICS_PERMISSIONS.export)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(analytics.ANALYTICS_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('analyticsExport', context.user.discordId);

  const roh = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(roh);
  if (!parsed.success) {
    return new NextResponse(null, { status: 400 });
  }
  const query = parsed.data;

  const abilities = analyticsAbilities(context);
  const guildId = await analyticsGuildId();

  const kategorie = KATEGORIEN.find((eintrag) => eintrag === query.kategorie);
  const { zeilen } = await analytics.timeline({
    guildId,
    category: kategorie ? [kategorie] : undefined,
    actorDiscordId: /^\d{17,20}$/u.test(query.akteur ?? '') ? query.akteur : undefined,
    subjectDiscordId: /^\d{17,20}$/u.test(query.betroffen ?? '') ? query.betroffen : undefined,
    suche: query.suche ? sanitizeText(query.suche, 100) : undefined,
    von: alsDatum(query.von),
    bis: alsDatum(query.bis, true),
    pageSize: MAX_ZEILEN,
    mitInhalten: abilities.content,
  });

  const csv = analytics.toCsv(zeilen, abilities.content);

  await safeRecordAudit({
    action: AUDIT_ACTIONS.ANALYTICS_EXPORT,
    module: analytics.ANALYTICS_MODULE_ID,
    actorDiscordId: context.user.discordId,
    actorUsername: context.user.username,
    success: true,
    metadata: {
      zeilen: zeilen.length,
      mitInhalten: abilities.content,
      // Der Filter gehoert ins Protokoll: er sagt, welcher Ausschnitt das
      // Haus verlassen hat.
      filter: query,
      // Wurde die Obergrenze erreicht, ist der Export unvollstaendig - und das
      // muss im Protokoll stehen, nicht nur im Kopf dessen, der ihn ausloeste.
      abgeschnitten: zeilen.length >= MAX_ZEILEN,
    },
  });

  const datum = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="analytics-${datum}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
