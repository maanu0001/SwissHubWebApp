import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { jail } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:jail-import');

/**
 * Upload und Analyse der alten Jail-Datenbank.
 *
 * Dateien lassen sich nicht über eine Server Action übertragen, deshalb ein
 * Route Handler. Die Sicherheitskette ist dieselbe wie bei jeder schreibenden
 * Aktion: Session, Mitgliedschaft, CSRF, Rate Limit, Berechtigung.
 *
 * Die Datei selbst wird nur gelesen und nach der Analyse gelöscht - dieser
 * Aufruf legt noch keinen einzigen Jail an.
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
    assertMembership(context, { ...metadata, path: 'jail.import' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'jail.import',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('jailImport', context.user.discordId);
    await assertPermission(context, jail.JAIL_PERMISSIONS.import, { ...metadata, path: 'jail.import' });

    const file = form.get('database');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte die Datei `jail_data.db` auswählen.' });
    }
    if (file.size > jail.MAX_LEGACY_DB_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${jail.MAX_LEGACY_DB_BYTES / 1024 / 1024} MB).`,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await jail.analyseLegacyImport(bytes, file.name, {
      discordId: context.user.discordId,
      username: context.user.username,
    });

    return NextResponse.json(ok({ importId: result.importRecord.id }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Analyse der Legacy-Datenbank fehlgeschlagen', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
