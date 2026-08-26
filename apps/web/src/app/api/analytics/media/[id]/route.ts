import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { can } from '@swisshub/auth';
import { analytics, isModuleEnabled } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { analyticsGuildId } from '@/server/analytics';
import { enforceRateLimit } from '@/server/rate-limit';

/**
 * Ausgabe einer archivierten Datei.
 *
 * Der einzige Weg zu einer Datei des Medienarchivs. Das Verzeichnis liegt
 * ausserhalb des statisch bedienten Bereichs; ohne diese Route kommt niemand
 * an die Bytes, auch nicht mit dem Speichernamen.
 *
 * Drei Vorkehrungen, die zusammengehoeren:
 *
 * - **`Content-Disposition: attachment`.** Eine archivierte Datei wird nie im
 *   Browser dargestellt. Was hier liegt, stammt von Fremden; im Browser
 *   angezeigt liefe es im Ursprung dieser Anwendung.
 * - **`nosniff` und fester Content-Type.** Der Browser soll nicht raten.
 * - **Jeder Abruf wird protokolliert.** Wer eine geloeschte Nachricht eines
 *   anderen oeffnet, hinterlaesst eine Spur - das ist der Gegenwert dafuer,
 *   dass es diese Moeglichkeit ueberhaupt gibt.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, analytics.ANALYTICS_PERMISSIONS.mediaDownload)) {
    return new NextResponse(null, { status: 403 });
  }
  if (!(await isModuleEnabled(analytics.ANALYTICS_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('analyticsDownload', context.user.discordId);

  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/iu.test(id)) {
    return new NextResponse(null, { status: 404 });
  }

  const guildId = await analyticsGuildId();
  const datei = await analytics.readArchivedMedia(guildId, id);
  if (!datei) {
    // Auch fuer eine abgelaufene Datei: 404. Ein anderer Code verriete, dass
    // es sie einmal gab.
    return new NextResponse(null, { status: 404 });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.ANALYTICS_MEDIA_DOWNLOAD,
    module: analytics.ANALYTICS_MODULE_ID,
    actorDiscordId: context.user.discordId,
    actorUsername: context.user.username,
    targetLabel: datei.displayName,
    success: true,
    metadata: { mediaId: id, byteSize: datei.byteSize },
  });

  return new NextResponse(new Uint8Array(datei.bytes), {
    headers: {
      'Content-Type': datei.mimeType,
      'Content-Length': String(datei.byteSize),
      // Immer als Download, nie zur Anzeige - siehe oben.
      'Content-Disposition': `attachment; filename="${datei.displayName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
