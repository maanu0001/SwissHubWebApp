import { env, sessionConfig } from '@swisshub/config';
import { prisma } from '@swisshub/database';
import { hmacSha256, randomToken } from '@swisshub/shared/crypto';
import type { Session, User } from '@swisshub/database';

/**
 * Serverseitige Sessions.
 *
 * Im Cookie liegt ein zufaelliges 256-Bit Token. Gespeichert wird nur dessen
 * HMAC - ein Datenbankleck erlaubt damit keine Session-Uebernahme.
 */
function hashToken(token: string): string {
  return hmacSha256(env.AUTH_SECRET, `session:${token}`);
}

export interface SessionMetadata {
  ipHash?: string | null;
  userAgent?: string | null;
}

export interface CreatedSession {
  /** Klartext-Token fuer das Cookie - wird nirgends gespeichert. */
  token: string;
  session: Session;
}

export async function createSession(userId: string, metadata: SessionMetadata = {}): Promise<CreatedSession> {
  const token = randomToken(32);
  const now = Date.now();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now + sessionConfig.absoluteTtlMs),
      idleExpiresAt: new Date(now + sessionConfig.idleTtlMs),
      ipHash: metadata.ipHash ?? null,
      userAgent: metadata.userAgent?.slice(0, 255) ?? null,
    },
  });
  return { token, session };
}

export interface ValidatedSession {
  session: Session;
  user: User;
  /** Gesetzt, wenn das Token rotiert wurde und das Cookie erneuert werden muss. */
  rotatedToken?: string;
}

/**
 * Prueft ein Session-Token und verlaengert das Inaktivitaetsfenster.
 *
 * Zusaetzlich wird das Token regelmaessig rotiert (Session Fixation Schutz).
 */
export interface ValidateOptions {
  /**
   * Token rotieren, wenn es alt genug ist. In React Server Components muss die
   * Rotation deaktiviert werden, weil dort keine Cookies gesetzt werden koennen.
   */
  rotate?: boolean;
}

export async function validateSessionToken(
  token: string,
  options: ValidateOptions = {},
): Promise<ValidatedSession | null> {
  if (!token || token.length < 16) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt) {
    return null;
  }

  const now = new Date();
  if (session.expiresAt <= now || session.idleExpiresAt <= now) {
    await prisma.session
      .update({ where: { id: session.id }, data: { revokedAt: now, revokedReason: 'EXPIRED' } })
      .catch(() => undefined);
    return null;
  }

  if (session.user.isBlocked) {
    await revokeSession(session.id, 'USER_BLOCKED');
    return null;
  }

  const shouldRotate =
    (options.rotate ?? true) && now.getTime() - session.rotatedAt.getTime() > sessionConfig.rotateAfterMs;
  const rotatedToken = shouldRotate ? randomToken(32) : undefined;

  const updated = await prisma.session.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + sessionConfig.idleTtlMs),
      ...(rotatedToken ? { tokenHash: hashToken(rotatedToken), rotatedAt: now } : {}),
    },
  });

  return { session: updated, user: session.user, rotatedToken };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.session
    .update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: reason.slice(0, 100) },
    })
    .catch(() => undefined);
}

export async function revokeSessionByToken(token: string, reason: string): Promise<void> {
  await prisma.session
    .updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason.slice(0, 100) },
    })
    .catch(() => undefined);
}

/** Beendet saemtliche Sessions eines Benutzers (z.B. bei Rechteentzug). */
export async function revokeAllSessions(userId: string, reason: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 100) },
  });
  return result.count;
}

/** Entfernt abgelaufene Sessions endgueltig (periodischer Job im Bot). */
export async function purgeExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}
