import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { spielersuche } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:spielersuche-import');

/**
 * Upload und Analyse der alten Spielersuche-Datenbank.
 *
 * Route Handler statt Server Action, weil Dateien übertragen werden. Die
 * Sicherheitskette bleibt dieselbe: Session, Mitgliedschaft, CSRF, Rate Limit,
 * Berechtigung. Die Datei selbst wird nur gelesen und danach gelöscht - dieser
 * Aufruf legt noch keine Suche und kein Spiel an.
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
    assertMembership(context, { ...metadata, path: 'spielersuche.import' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'spielersuche.import',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('jailImport', context.user.discordId);
    await assertPermission(context, spielersuche.SPIELERSUCHE_PERMISSIONS.import, {
      ...metadata,
      path: 'spielersuche.import',
    });

    const file = form.get('database');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Bitte die Datei `matchmaking.db` auswählen.',
      });
    }
    if (file.size > spielersuche.MAX_LEGACY_DB_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${spielersuche.MAX_LEGACY_DB_BYTES / 1024 / 1024} MB).`,
      });
    }

    const guildValue = form.get('sourceGuildId');
    const sourceGuildId =
      typeof guildValue === 'string' && /^\d{17,20}$/u.test(guildValue) ? guildValue : null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await spielersuche.analyseLegacyImport(
      bytes,
      file.name,
      { discordId: context.user.discordId, username: context.user.username },
      { sourceGuildId },
    );

    return NextResponse.json(ok({ importId: result.importRecord.id }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Analyse der Spielersuche-Datenbank fehlgeschlagen', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
