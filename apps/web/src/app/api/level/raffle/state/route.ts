import { NextResponse } from 'next/server';
import { can } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { getActionAuthContext } from '@/server/auth';

/**
 * Aktueller Stand der hervorgehobenen Verlosung.
 *
 * Die öffentliche Seite fragt hier im Sekundentakt nach, solange etwas läuft.
 * Bewusst eine schlichte Abfrage statt einer dauerhaften Verbindung: eine
 * Verlosung ändert sich selten, und eine Abfrage alle paar Sekunden übersteht
 * jeden Neustart und jeden Proxy ohne Sonderbehandlung.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const context = await getActionAuthContext('cached');
  if (!context) {
    return new NextResponse(null, { status: 401 });
  }
  if (!can(context, level.LEVEL_PERMISSIONS.raffleView)) {
    return new NextResponse(null, { status: 403 });
  }

  const raffle = await level.raffle.getFeaturedRaffle();
  if (!raffle) {
    return NextResponse.json({ raffle: null });
  }

  const draw = await level.raffle.latestDraw(raffle.id);

  return NextResponse.json({
    raffle: {
      id: raffle.id,
      status: raffle.status,
      entryCount: raffle.entryCount,
      potXp: raffle.potXp,
      entryEndsAt: raffle.entryEndsAt?.toISOString() ?? null,
    },
    // Der Gewinner steht hier bereits fest - das Rad zeigt ihn nur noch.
    draw: draw
      ? {
          id: draw.id,
          version: draw.version,
          winnerEntryId: draw.winnerEntryId,
          winnerDiscordId: draw.winnerDiscordId,
          animationSeed: draw.animationSeed,
          confirmedAt: draw.confirmedAt?.toISOString() ?? null,
        }
      : null,
  });
}
