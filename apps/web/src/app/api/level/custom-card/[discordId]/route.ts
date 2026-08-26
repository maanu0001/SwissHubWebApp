import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { snowflakeSchema } from '@swisshub/shared';
import { getActionAuthContext } from '@/server/auth';

/**
 * Liefert eine persoenliche Levelkarte aus.
 *
 * Ueber einen Route Handler statt aus `public/`: das Upload-Verzeichnis bleibt
 * ausserhalb des statisch bedienten Bereichs, und der Content-Type wird hier
 * fest gesetzt - eine hochgeladene Datei kann dadurch nie als HTML oder
 * Skript ausgeliefert werden.
 *
 * Sichtbar ist die eigene Karte immer. Eine fremde nur mit der Berechtigung,
 * Levelprofile anderer einzusehen - das Bild gehoert zur Person.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ discordId: string }> },
): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context?.isMember) {
    return new NextResponse(null, { status: 401 });
  }

  const parsed = snowflakeSchema.safeParse((await params).discordId);
  if (!parsed.success) {
    return new NextResponse(null, { status: 404 });
  }

  const eigen = parsed.data === context.user.discordId;
  if (!eigen && !can(context, level.LEVEL_PERMISSIONS.membersView)) {
    return new NextResponse(null, { status: 403 });
  }

  const file = await level.readCustomCard(parsed.data);
  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, no-cache',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
