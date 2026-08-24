import { NextResponse, type NextRequest } from 'next/server';
import { tickets } from '@swisshub/modules';
import { can } from '@swisshub/auth';
import { AppError, fail, toAppError } from '@swisshub/shared';
import { getActionAuthContext } from '@/server/auth';
import { ladeTicketMitZugriff } from '@/server/tickets';

export const dynamic = 'force-dynamic';

/**
 * Ein Ticket-Transcript herunterladen.
 *
 * Bewusst eine autorisierte Route und keine offene Adresse: ein Verlauf
 * enthaelt alles, was jemand dem Support anvertraut hat. Wer die Datei
 * bekommt, entscheidet dieselbe Zugriffspruefung wie fuer das Ticket selbst -
 * und fuer die Team-Fassung zusaetzlich die Berechtigung, interne Notizen zu
 * lesen.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
): Promise<Response> {
  try {
    const { ticketId } = await params;
    const context = await getActionAuthContext('cached');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    const { ticket, zugriff } = await ladeTicketMitZugriff(context, ticketId);

    const gewuenscht = request.nextUrl.searchParams.get('fassung');
    const intern = gewuenscht === 'intern';

    if (intern && !zugriff.notes) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Die interne Fassung ist dem Team vorbehalten.',
      });
    }
    // Wer das Ticket nur als Ersteller oder Teilnehmer sieht, bekommt seinen
    // eigenen Verlauf. Fuer fremde Tickets braucht es die ausdrueckliche
    // Berechtigung - `view` allein genuegt dafuer nicht.
    if (
      !zugriff.asStaff &&
      ticket.creatorDiscordId !== context.user.discordId &&
      !can(context, tickets.TICKET_PERMISSIONS.transcriptView)
    ) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Du darfst diesen Verlauf nicht herunterladen.',
      });
    }

    const inhalt = await tickets.loadTranscript(ticket.id, intern ? 'STAFF' : 'USER');

    return new NextResponse(inhalt.html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="${inhalt.downloadName}"`,
        // Ein Verlauf gehoert in keinen Zwischenspeicher, den jemand anderes
        // erreichen koennte.
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (fehler) {
    const appError = toAppError(fehler);
    return NextResponse.json(fail(appError), { status: appError.status });
  }
}
