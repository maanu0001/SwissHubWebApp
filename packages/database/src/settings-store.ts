import type { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from './client';

/**
 * Typisierter Zugriff auf `SystemConfig`.
 *
 * Werte werden beim Lesen erneut validiert: eine manuell in der Datenbank
 * veraenderte Einstellung darf die Anwendung nicht in einen undefinierten
 * Zustand bringen (Fail Safe -> Default).
 */
export async function readConfigValue<TSchema extends z.ZodTypeAny>(
  key: string,
  schema: TSchema,
  fallback: z.infer<TSchema>,
): Promise<z.infer<TSchema>> {
  const row = await prisma.systemConfig.findUnique({ where: { key }, select: { value: true } });
  if (!row) {
    return fallback;
  }
  const parsed = schema.safeParse(row.value);
  return parsed.success ? parsed.data : fallback;
}

export async function writeConfigValue<TSchema extends z.ZodTypeAny>(
  key: string,
  schema: TSchema,
  value: unknown,
  updatedBy?: string | null,
): Promise<z.infer<TSchema>> {
  const parsed = schema.parse(value) as Prisma.InputJsonValue;
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: parsed, updatedBy: updatedBy ?? null },
    update: { value: parsed, updatedBy: updatedBy ?? null },
  });
  return parsed as z.infer<TSchema>;
}

/** Legt einen Wert nur an, wenn er noch nicht existiert (Bootstrap aus ENV). */
export async function ensureConfigValue<TSchema extends z.ZodTypeAny>(
  key: string,
  schema: TSchema,
  value: unknown,
): Promise<void> {
  const existing = await prisma.systemConfig.findUnique({ where: { key }, select: { key: true } });
  if (existing) {
    return;
  }
  const parsed = schema.parse(value) as Prisma.InputJsonValue;
  await prisma.systemConfig.create({ data: { key, value: parsed } }).catch((error: unknown) => {
    // Gleichzeitiger Start von Bot und WebApp - der andere Prozess war schneller.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      throw error;
    }
  });
}
