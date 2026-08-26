import { NextResponse, type NextRequest } from 'next/server';
import { SECURITY_EVENTS, recordSecurityEvent } from '@swisshub/database';
import { assertMembership, can, verifyCsrfToken } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import { createLogger } from '@swisshub/logger';
import { AppError, fail, ok, snowflakeSchema, toAppError } from '@swisshub/shared';
import { getActionAuthContext, getRequestMetadata } from '@/server/auth';
import { enforceRateLimit } from '@/server/rate-limit';

const log = createLogger('web:level-custom-card');

/**
 * Die persoenliche Levelkarte hochladen und entfernen.
 *
 * Route Handler statt Server Action, weil eine Datei uebertragen wird - genau
 * wie beim Kartenhintergrund und beim Logo. Die Sicherheitskette bleibt
 * dieselbe: Sitzung, Mitgliedschaft, CSRF, Rate Limit, Berechtigung.
 *
 * Die Berechtigung prueft der Dienst noch einmal selbst. Das ist keine
 * Doppelung aus Unsicherheit: der Dienst wird auch von anderen Stellen
 * aufgerufen und darf sich nicht darauf verlassen, dass jemand vorher
 * nachgesehen hat.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function autorisiere(form: FormData) {
  const metadata = await getRequestMetadata();
  const context = await getActionAuthContext('critical');
  if (!context) {
    throw new AppError('UNAUTHENTICATED');
  }
  assertMembership(context, { ...metadata, path: 'level.custom-card' });

  const csrfToken = form.get('csrfToken');
  if (typeof csrfToken !== 'string' || !verifyCsrfToken(context.sessionId, csrfToken)) {
    await recordSecurityEvent({
      type: SECURITY_EVENTS.CSRF_FAILED,
      severity: 'HIGH',
      discordId: context.user.discordId,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      path: 'level.custom-card',
    });
    throw new AppError('FORBIDDEN', {
      userMessage: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden.',
    });
  }

  await enforceRateLimit('brandingUpload', context.user.discordId);

  return {
    viewer: {
      discordId: context.user.discordId,
      can: (permission: string) => can(context, permission),
    },
    actor: { discordId: context.user.discordId, username: context.user.username },
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const { viewer, actor } = await autorisiere(form);

    const file = form.get('image');
    if (!(file instanceof File)) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Bitte ein Bild auswählen.' });
    }
    if (file.size > level.MAX_CUSTOM_CARD_BYTES) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die Datei ist zu gross (maximal ${Math.round(level.MAX_CUSTOM_CARD_BYTES / 1024 / 1024)} MB).`,
      });
    }

    const stored = await level.storeCustomCard(
      viewer,
      actor,
      new Uint8Array(await file.arrayBuffer()),
      file.type || null,
    );

    return NextResponse.json(ok(stored));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Eigene Levelkarte konnte nicht gespeichert werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  try {
    const form = await request.formData();
    const { viewer, actor } = await autorisiere(form);

    // Ohne Angabe die eigene. Eine fremde verlangt die Verwaltungsberechtigung
    // des Levelmoduls - das prueft der Dienst.
    const roh = form.get('discordId');
    const ziel =
      typeof roh === 'string' && roh !== ''
        ? snowflakeSchema.parse(roh)
        : viewer.discordId;

    await level.clearCustomCard(viewer, actor, ziel);
    return NextResponse.json(ok({ discordId: ziel }));
  } catch (error) {
    const appError = toAppError(error);
    if (appError.code === 'INTERNAL') {
      log.error('Eigene Levelkarte konnte nicht entfernt werden', { error });
    }
    return NextResponse.json(fail(appError), { status: appError.code === 'FORBIDDEN' ? 403 : 400 });
  }
}
