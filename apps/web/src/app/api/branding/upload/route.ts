import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { branding as brandingModule } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:branding-upload');

/**
 * Logo-Upload.
 *
 * Dateien lassen sich nicht über eine Server Action übertragen, deshalb ein
 * Route Handler - die Sicherheitskette bleibt aber dieselbe wie bei jeder
 * anderen schreibenden Aktion: Session, Mitgliedschaft, CSRF, Rate Limit,
 * Berechtigung. Die Prüfung der Datei selbst übernimmt `storeLogoUpload`
 * (Magic Bytes, Grösse, Abmessungen, zufälliger Dateiname).
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
    assertMembership(context, { ...metadata, path: 'branding.upload' });

    const form = await request.formData();
    const csrfToken = form.get('csrfToken');
    if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
      await recordSecurityEvent({
        type: SECURITY_EVENTS.CSRF_FAILED,
        severity: 'HIGH',
        discordId: context.user.discordId,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
        path: 'branding.upload',
      });
      throw new AppError('FORBIDDEN', {
        userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
      });
    }

    await enforceRateLimit('brandingUpload', context.user.discordId);
    await assertPermission(context, 'branding.manage', { ...metadata, path: 'branding.upload' });

    const file = form.get('logo');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte eine Datei auswählen.' });
    }
    if (file.size > brandingModule.MAX_UPLOAD_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(brandingModule.MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const config = await brandingModule.updateLogo(bytes, file.type || null, {
      discordId: context.user.discordId,
      username: context.user.username,
    });

    return NextResponse.json(ok({ version: config.version }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Logo-Upload fehlgeschlagen', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
