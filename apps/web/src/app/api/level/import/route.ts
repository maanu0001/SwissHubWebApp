import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:level-import');

/**
 * Upload und Analyse der alten `levels.db`.
 *
 * Route Handler statt Server Action, weil Dateien übertragen werden. Die
 * Sicherheitskette bleibt dieselbe: Session, Mitgliedschaft, CSRF, Rate Limit,
 * Berechtigung. Die Datei wird nur gelesen und danach gelöscht - dieser Aufruf
 * ändert noch keinen einzigen XP-Stand.
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
    assertMembership(context, { ...metadata, path: 'level.import' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'level.import',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('jailImport', context.user.discordId);
    await assertPermission(context, level.LEVEL_PERMISSIONS.import, {
      ...metadata,
      path: 'level.import',
    });

    const file = form.get('database');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Bitte die Datei `levels.db` auswählen.',
      });
    }
    if (file.size > level.MAX_LEGACY_DB_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${level.MAX_LEGACY_DB_BYTES / 1024 / 1024} MB).`,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const analysis = await level.analyseLevelImport(
      { discordId: context.user.discordId, username: context.user.username },
      { name: file.name, data: bytes },
    );

    return NextResponse.json(
      ok({
        importId: analysis.importId,
        counts: analysis.counts,
        totalXp: analysis.totalXp,
        highestLevel: analysis.highestLevel,
      }),
    );
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Analyse der Level-Datenbank fehlgeschlagen', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
