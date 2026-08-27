import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { getOptionalAuthContext } from '@/server/auth';

/**
 * Ein Event als iCalendar-Datei.
 *
 * Serverseitig abgesichert wie jede Seite: ohne Anmeldung und ohne
 * Kalenderberechtigung gibt es nichts, und ein Entwurf ist nur fuer die
 * Verwaltung vorhanden. Ein ungeschuetzter Export waere ein Weg, Termine zu
 * lesen, die man auf der Webseite nicht sehen darf.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 });
  }
  const P = calendar.CALENDAR_PERMISSIONS;
  if (!can(context, P.view) && !can(context, P.manageOwn) && !can(context, P.edit)) {
    return NextResponse.json({ error: 'Keine Berechtigung.' }, { status: 403 });
  }
  if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
    return NextResponse.json({ error: 'Modul deaktiviert.' }, { status: 404 });
  }

  const { slug } = await params;
  const event = await calendar.findEvent(slug);
  if (!event) {
    return NextResponse.json({ error: 'Event nicht gefunden.' }, { status: 404 });
  }

  const darfVerwalten =
    can(context, P.edit) ||
    (can(context, P.manageOwn) && calendar.istZustaendig(event, context.user.discordId));
  if (event.status === 'DRAFT' && !darfVerwalten) {
    // Wie auf der Detailseite: ein Entwurf ist nicht «gesperrt», sondern für
    // diese Person nicht vorhanden.
    return NextResponse.json({ error: 'Event nicht gefunden.' }, { status: 404 });
  }

  const settings = await calendar.calendarSettings();
  const inhalt = calendar.buildIcs(event, {
    defaultDurationMinutes: settings.defaultDurationMinutes,
  });

  return new NextResponse(inhalt, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${calendar.icsDateiname(event)}"`,
      // Kein Zwischenspeicher: eine verschobene Zeit soll beim naechsten
      // Abruf die neue sein.
      'Cache-Control': 'no-store',
    },
  });
}
