import { NextResponse } from 'next/server';
import { branding as brandingModule } from '@swisshub/modules';

/**
 * Liefert das hochgeladene Logo aus.
 *
 * Bewusst über einen Route Handler statt aus `public/`: das Upload-Verzeichnis
 * bleibt damit ausserhalb des statisch bedienten Bereichs, und der Content-Type
 * wird hier fest gesetzt - nicht aus der Datei abgeleitet. Eine hochgeladene
 * Datei kann dadurch niemals als HTML oder Skript ausgeliefert werden.
 *
 * Die Route ist absichtlich öffentlich: das Logo erscheint auch auf der
 * Login-Seite, und es ist keine geschützte Information.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const config = await brandingModule.getBrandingConfig();
  if (!config.logoPath) {
    return new NextResponse(null, { status: 404 });
  }

  const file = await brandingModule.readUpload(config.logoPath);
  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': brandingModule.CONTENT_TYPE[file.format],
      // Der Dateiname wechselt bei jedem Upload und die URL trägt eine
      // Version - lange Cachezeiten sind deshalb unproblematisch.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
