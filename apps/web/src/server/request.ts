import { headers } from 'next/headers';
import { env } from '@swisshub/config';
import { hashIp } from '@swisshub/shared/crypto';

/**
 * Request-Metadaten für Audit- und Sicherheitsereignisse.
 * IP-Adressen werden ausschliesslich pseudonymisiert (HMAC) gespeichert.
 */
export interface RequestMetadata {
  ipHash: string | null;
  userAgent: string | null;
}

export async function getRequestMetadata(): Promise<RequestMetadata> {
  const headerList = await headers();
  const forwarded = env.TRUST_PROXY ? headerList.get('x-forwarded-for') : null;
  const ip = forwarded?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null;

  return {
    ipHash: hashIp(env.AUTH_SECRET, ip),
    userAgent: headerList.get('user-agent')?.slice(0, 255) ?? null,
  };
}

/** Client-IP (bzw. ein stabiler Ersatz) für Rate-Limit-Buckets. */
export async function getRateLimitIdentity(): Promise<string> {
  const metadata = await getRequestMetadata();
  return metadata.ipHash ?? 'unknown';
}
