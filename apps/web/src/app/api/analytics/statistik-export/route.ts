import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { can } from '@swisshub/auth';
import { analytics, isModuleEnabled } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { analyticsGuildId } from '@/server/analytics';
import { enforceRateLimit } from '@/server/rate-limit';

/**
 * CSV-Ausgabe der Statistik.
 *
 * Vier Auszuege, weil vier verschiedene Fragen: der Tagesverlauf, die
 * Rangliste der Mitglieder, die der Kanaele und das Mitgliederwachstum. Sie
 * in eine Datei zu pressen ergaebe eine Tabelle mit vielen leeren Spalten.
 *
 * Wie beim Verlaufsexport gilt: er ist keine Hintertuer. Wer die Statistik
 * nicht sehen darf, bekommt auch keine Datei, und jeder Export wird
 * protokolliert - er traegt Daten aus dem System heraus, und ab dann gilt
 * hier keine Berechtigung mehr.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  art: z.enum(['verlauf', 'mitglieder', 'kanaele', 'wachstum']).default('verlauf'),
  zeitraum: z.string().max(10).optional(),
  von: z.string().max(10).optional(),
  bis: z.string().max(10).optional(),
});

/** Neutralisiert Formeln und maskiert nach RFC 4180 - wie beim Verlaufsexport. */
function feld(wert: unknown): string {
  if (wert === null || wert === undefined) {
    return '';
  }
  let text = wert instanceof Date ? wert.toISOString() : String(wert);
  if (/^[=+\-@\t\r]/u.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(kopf: readonly string[], reihen: unknown[][]): string {
  const zeilen = [kopf.map(feld).join(','), ...reihen.map((reihe) => reihe.map(feld).join(','))];
  // BOM voran, damit Excel die Umlaute als UTF-8 liest. Als Escape
  // geschrieben - als unsichtbares Zeichen im Quelltext waere es ein Raetsel.
  return `\uFEFF${zeilen.join('\r\n')}\r\n`;
}

export async function GET(request: Request): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  // Beide Berechtigungen: die Statistik sehen und exportieren duerfen.
  if (
    !can(context, analytics.ANALYTICS_PERMISSIONS.statisticsView) ||
    !can(context, analytics.ANALYTICS_PERMISSIONS.export)
  ) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(analytics.ANALYTICS_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('analyticsExport', context.user.discordId);

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return new NextResponse(null, { status: 400 });
  }
  const query = parsed.data;

  const guildId = await analyticsGuildId();
  const stand = await analytics.trackingStand(guildId);
  const zeitraum = analytics.aufloesen({
    id: query.zeitraum,
    von: query.von,
    bis: query.bis,
    datenBeginn: stand?.startedAt ?? null,
  });
  const einstellungen = await analytics.statistik.statistikEinstellungen();
  const scope = { guildId, zeitraum, mitBots: einstellungen.mitBots };

  let inhalt: string;
  let zeilen: number;

  if (query.art === 'mitglieder') {
    const eintraege = await analytics.statistik.topMitglieder(scope, 'messages', 50);
    zeilen = eintraege.length;
    inhalt = csv(
      ['Discord-ID', 'Anzeigename', 'Benutzername', 'Nachrichten', 'Sprachsekunden', 'Sprachsitzungen'],
      eintraege.map((e) => [
        e.discordId,
        e.displayName,
        e.username,
        e.nachrichten,
        e.sprachSekunden,
        e.sprachSitzungen,
      ]),
    );
  } else if (query.art === 'kanaele') {
    const [text, sprache] = await Promise.all([
      analytics.statistik.topKanaele(scope, 'TEXT', 50),
      analytics.statistik.topKanaele(scope, 'VOICE', 50),
    ]);
    const alle = [...text, ...sprache];
    zeilen = alle.length;
    inhalt = csv(
      ['Kanal-ID', 'Name', 'Art', 'Nachrichten', 'Sprachsekunden', 'Anteil %'],
      alle.map((e) => [
        e.channelId,
        e.channelName,
        e.nachrichten > 0 ? 'TEXT' : 'VOICE',
        e.nachrichten,
        e.sprachSekunden,
        e.anteil,
      ]),
    );
  } else if (query.art === 'wachstum') {
    const punkte = await analytics.statistik.verlauf(scope);
    zeilen = punkte.length;
    inhalt = csv(
      ['Zeitpunkt', 'Beitritte', 'Austritte', 'Netto', 'Mitglieder'],
      punkte.map((p) => [p.zeit, p.beitritte, p.austritte, p.beitritte - p.austritte, p.mitglieder]),
    );
  } else {
    const punkte = await analytics.statistik.verlauf(scope);
    zeilen = punkte.length;
    inhalt = csv(
      ['Zeitpunkt', 'Nachrichten', 'Sprachsekunden', 'Aktive Mitglieder', 'Beitritte', 'Austritte'],
      punkte.map((p) => [p.zeit, p.nachrichten, p.sprachSekunden, p.aktive, p.beitritte, p.austritte]),
    );
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.ANALYTICS_EXPORT,
    module: analytics.ANALYTICS_MODULE_ID,
    actorDiscordId: context.user.discordId,
    actorUsername: context.user.username,
    success: true,
    metadata: { art: query.art, zeitraum: zeitraum.id, zeilen, statistik: true },
  });

  const datum = new Date().toISOString().slice(0, 10);
  return new NextResponse(inhalt, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="statistik-${query.art}-${datum}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
