import { PrismaClient } from '@prisma/client';
import { createLogger } from '@swisshub/logger';

const log = createLogger('database');

/**
 * Prisma client singleton.
 *
 * Next.js recreates modules on every hot reload in development, which would
 * exhaust the connection pool without this global cache.
 */
const globalForPrisma = globalThis as unknown as { swisshubPrisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('warn' as never, (event: { message: string }) => {
    log.warn(event.message);
  });
  client.$on('error' as never, (event: { message: string }) => {
    log.error(event.message);
  });

  return client;
}

export const prisma: PrismaClient = globalForPrisma.swisshubPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.swisshubPrisma = prisma;
}

/** Closes the connection pool - used by the graceful shutdown handlers. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}

/** Lightweight readiness probe used by `/api/health`. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    log.error('Datenbank-Healthcheck fehlgeschlagen', { error });
    return { ok: false, latencyMs: Date.now() - started };
  }
}
