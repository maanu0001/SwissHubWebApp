import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:level-env');

/**
 * Vorschau und Übernahme einzelner Werte aus der alten `.env`.
 *
 * Gelesen wird ausschliesslich, was auf der Positivliste des Moduls steht.
 * `BOT_TOKEN`, `AUTH_SECRET`, `DATABASE_URL` und `REDIS_URL` stehen nicht
 * darauf: sie werden nicht ausgewertet, nicht zurückgegeben und nicht
 * protokolliert. Die Datei selbst wird nirgends abgelegt.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const metadata = await getRequestMetadata();

  try {
    const context = await getActionAuthContext('critical');
    if (!context) {
      throw new AppError('UNAUTHENTICATED');
    }
    assertMembership(context, { ...metadata, path: 'level.env-import' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'level.env-import',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('jailImport', context.user.discordId);
    await assertPermission(context, level.LEVEL_PERMISSIONS.import, {
      ...metadata,
      path: 'level.env-import',
    });

    const file = form.get('env');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine `.env`-Datei auswählen.' });
    }
    if (file.size > level.MAX_ENV_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${level.MAX_ENV_BYTES / 1024} KB).`,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const apply = form.get('apply') === 'true';

    if (!apply) {
      return NextResponse.json(ok(level.analyseLegacyEnv(bytes)));
    }

    const rawKeys = form.get('keys');
    const keys =
      typeof rawKeys === 'string'
        ? rawKeys
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0 && entry.length <= 64)
        : [];

    const result = await level.applyLegacyEnv(
      { discordId: context.user.discordId, username: context.user.username },
      bytes,
      keys,
    );

    return NextResponse.json(ok(result));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      // Ohne Details: eine `.env` kann Zugangsdaten enthalten, und die haben
      // in keinem Protokoll etwas verloren.
      log.error('Übernahme aus der alten .env fehlgeschlagen');
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
