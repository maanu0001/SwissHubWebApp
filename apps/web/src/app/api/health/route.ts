import { NextResponse } from 'next/server';
import { checkDatabase } from '@swisshub/database';
import { readBotStatus } from '@swisshub/modules';

export const dynamic = 'force-dynamic';

/**
 * Health Check fuer Monitoring/Container-Orchestrierung.
 * Gibt bewusst keine internen Details preis (keine Fehlermeldungen, keine
 * Versionsnummern von Abhaengigkeiten, keine IDs).
 */
export async function GET(): Promise<NextResponse> {
  const [database, bot] = await Promise.all([checkDatabase(), readBotStatus().catch(() => null)]);

  const healthy = database.ok;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks: {
        web: 'ok',
        database: database.ok ? 'ok' : 'error',
        bot: bot?.online ? 'ok' : 'offline',
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
