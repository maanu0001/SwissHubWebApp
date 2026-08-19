import { z } from 'zod';

/** Discord epoch (2015-01-01T00:00:00.000Z) used to decode snowflake IDs. */
export const DISCORD_EPOCH = 1_420_070_400_000n;

export const SNOWFLAKE_REGEX = /^\d{17,20}$/u;

export const snowflakeSchema = z.string().trim().regex(SNOWFLAKE_REGEX, 'Ungültige Discord ID');

export const optionalSnowflakeSchema = z
  .union([snowflakeSchema, z.literal('')])
  .optional()
  .transform((value) => (value ? value : undefined));

/** Prüft, ob ein Wert wie eine Discord Snowflake aussieht. */
export const isSnowflake = (value: unknown): boolean =>
  typeof value === 'string' && SNOWFLAKE_REGEX.test(value);

/** Creation timestamp encoded inside a Discord snowflake. */
export function snowflakeToDate(id: string): Date | null {
  if (!isSnowflake(id)) {
    return null;
  }
  try {
    return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
  } catch {
    return null;
  }
}
