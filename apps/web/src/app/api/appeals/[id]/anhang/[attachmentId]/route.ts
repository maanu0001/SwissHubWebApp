import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { can } from '@swisshub/auth';
import { resolveGuildId } from '@swisshub/discord';
import { appeals, isModuleEnabled } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

/**
 * Ausgabe eines Anhangs (§33).
 *
 * Der einzige Weg zu einer hochgeladenen Datei. Das Verzeichnis liegt
 * ausserhalb des statisch bedienten Bereichs; ohne diese Route kommt niemand
 * an die Bytes, auch nicht mit dem Speichernamen.
 *
 * **Zwei Zugänge, eine Route.** Sehen darf die Datei, wem der Antrag gehört -
 * und wer im Team die Berechtigung hat. Der erste Fall ist der Grund, weshalb
 * hier nicht `context.isMember` verlangt wird: der Antragsteller ist keines.
 *
 * Dieselben Vorkehrungen wie beim Medienarchiv:
 *
 * - `Content-Disposition: attachment` - nie im Browser dargestellt. Was hier
 *   liegt, stammt von jemandem, der gerade gebannt ist; im Browser angezeigt
 *   liefe es im Ursprung dieser Anwendung.
 * - `nosniff` und fester Content-Type. Der Browser soll nicht raten.
 * - Jeder Abruf durch das Team wird protokolliert.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new NextResponse(null, { status: 401 });
  }
  if (!(await isModuleEnabled(appeals.APPEALS_MODULE_ID))) {
    return new NextResponse(null, { status: 404 });
  }

  await enforceRateLimit('appealDownload', context.user.discordId);

  const { id, attachmentId } = await params;
  if (!/^[a-z0-9]{20,40}$/iu.test(id) || !/^[a-z0-9]{20,40}$/iu.test(attachmentId)) {
    return new NextResponse(null, { status: 404 });
  }

  const guildId = await resolveGuildId();
  const appeal = await appeals.holeAppeal(guildId, id);
  if (!appeal) {
    return new NextResponse(null, { status: 404 });
  }

  const istEigener = appeal.applicantDiscordId === context.user.discordId;
  const istTeam =
    can(context, appeals.APPEALS_PERMISSIONS.viewAll) ||
    (can(context, appeals.APPEALS_PERMISSIONS.view) &&
      (appeal.assignedToDiscordId === null ||
        appeal.assignedToDiscordId === context.user.discordId));

  if (!istEigener && !istTeam) {
    // 404 und nicht 403: ein anderer Code verriete, dass es die Datei gibt.
    return new NextResponse(null, { status: 404 });
  }

  const datei = await appeals.leseAnhang(id, attachmentId);
  if (!datei) {
    return new NextResponse(null, { status: 404 });
  }

  // Nur der Zugriff des Teams auf fremde Dateien wird protokolliert. Wer
  // seinen eigenen Anhang herunterlaedt, hinterlaesst keine Spur - das waere
  // eine Bewegungsakte ueber jemanden, der ohnehin schon gebannt ist.
  if (!istEigener) {
    await safeRecordAudit({
      action: AUDIT_ACTIONS.APPEAL_ATTACHMENT_DOWNLOADED,
      module: appeals.APPEALS_MODULE_ID,
      actorDiscordId: context.user.discordId,
      actorUsername: context.user.username,
      targetDiscordId: appeal.applicantDiscordId,
      targetLabel: appeals.formatFallnummer(appeal.caseYear, appeal.caseNumber),
      metadata: { appealId: id, attachmentId },
    });
  }

  return new NextResponse(new Uint8Array(datei.daten), {
    status: 200,
    headers: {
      'content-type': datei.contentType,
      'content-length': String(datei.daten.byteLength),
      'content-disposition': `attachment; filename="${datei.fileName}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
