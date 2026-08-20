import { NextResponse } from 'next/server';
import { level } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';
import { can } from '@swisshub/auth';

/**
 * Liefert einen hochgeladenen Kartenhintergrund aus.
 *
 * Bewusst über einen Route Handler statt aus `public/`: das Upload-Verzeichnis
 * bleibt ausserhalb des statisch bedienten Bereichs, und der Content-Type wird
 * hier fest gesetzt - eine hochgeladene Datei kann dadurch niemals als HTML
 * oder Skript ausgeliefert werden.
 *
 * Anders als das Logo ist dieses Bild nicht öffentlich: es erscheint nur in
 * der Dashboard-Vorschau, und auf Discord landet es als fertiges PNG.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slot: string }> },
): Promise<Response> {
  // Nur angemeldete Personen mit Einsicht in die Einstellungen - das Bild
  // gehört zur Konfiguration, nicht zur öffentlichen Oberfläche.
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, level.LEVEL_PERMISSIONS.settingsView)) {
    return new NextResponse(null, { status: 403 });
  }

  const { slot } = await params;
  if (!level.isCardBannerSlot(slot)) {
    return new NextResponse(null, { status: 404 });
  }

  const file = await level.readCardBanner(slot);
  if (!file) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      // Der Dateiname wechselt bei jedem Upload; die Seite hängt eine Version
      // an die Adresse.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
