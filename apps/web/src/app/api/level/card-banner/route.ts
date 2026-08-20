import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, assertPermission, verifyCsrfToken } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:level-card-banner');

/**
 * Hintergrundbilder der Levelkarte hochladen und entfernen.
 *
 * Route Handler statt Server Action, weil Dateien übertragen werden. Die
 * Sicherheitskette bleibt dieselbe: Session, Mitgliedschaft, CSRF, Rate Limit,
 * Berechtigung. Der Dateityp wird am Inhalt erkannt, der Dateiname
 * serverseitig erzeugt.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function authorize(form: FormData): Promise<{ discordId: string; username: string }> {
  const metadata = await getRequestMetadata();
  const context = await getActionAuthContext('critical');
  if (!context) {
    throw new AppError('UNAUTHENTICATED');
  }
  assertMembership(context, { ...metadata, path: 'level.card-banner' });

  const csrfToken = form.get('csrfToken');
  if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
    await recordSecurityEvent({
      type: SECURITY_EVENTS.CSRF_FAILED,
      severity: 'HIGH',
      discordId: context.user.discordId,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: 'level.card-banner',
    });
    throw new AppError('FORBIDDEN', {
      userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
    });
  }

  await enforceRateLimit('brandingUpload', context.user.discordId);
  await assertPermission(context, level.LEVEL_PERMISSIONS.settingsManage, {
    ...metadata,
    path: 'level.card-banner',
  });

  return { discordId: context.user.discordId, username: context.user.username };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const actor = await authorize(form);

    const slot = level.assertCardBannerSlot(String(form.get('slot') ?? ''));
    const file = form.get('image');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte ein Bild auswählen.' });
    }
    if (file.size > level.MAX_CARD_BANNER_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(level.MAX_CARD_BANNER_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const stored = await level.storeCardBanner(
      actor,
      slot,
      new Uint8Array(await file.arrayBuffer()),
      file.type || null,
    );

    return NextResponse.json(ok(stored));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Kartenhintergrund konnte nicht gespeichert werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const actor = await authorize(form);
    const slot = level.assertCardBannerSlot(String(form.get('slot') ?? ''));

    await level.clearCardBanner(actor, slot);
    return NextResponse.json(ok({ slot }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Kartenhintergrund konnte nicht entfernt werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
