import { prisma } from '@swisshub/database';
import type { PremiumPayment, PremiumSubscriptionStatus } from '@swisshub/database';
import { LIVE_STATUSES } from './entitlements';
import type { SubscriptionWithProduct } from './service';

/** Kennzahlen der Uebersicht. */
export interface PremiumOverview {
  activeSubscriptions: number;
  mrrMinor: number;
  premiumMembers: number;
  stuebliMembers: number;
  bundleMembers: number;
  failedPayments: number;
  cancellations: number;
  syncErrors: number;
  activeStuebli: number;
}

export async function getPremiumOverview(): Promise<PremiumOverview> {
  const laufend = await prisma.premiumSubscription.findMany({
    where: { status: { in: [...LIVE_STATUSES] } },
    include: { product: true },
  });

  // Der monatlich wiederkehrende Umsatz zaehlt nur, was auch bezahlt wird -
  // eine offene Zahlung gehoert nicht dazu.
  const zahlend = laufend.filter(
    (eintrag) => eintrag.status === 'ACTIVE' || eintrag.status === 'CANCEL_AT_PERIOD_END',
  );

  const [failedPayments, syncErrors, activeStuebli] = await Promise.all([
    prisma.premiumPayment.count({ where: { status: 'FAILED' } }),
    prisma.premiumSubscription.count({ where: { discordSyncStatus: 'FAILED' } }),
    prisma.premiumDiscordResource.count({
      where: { resourceType: 'PREMIUM_STUEBLI_VOICE', state: 'ACTIVE' },
    }),
  ]);

  const hat = (eintrag: (typeof laufend)[number], anspruch: string): boolean =>
    eintrag.product.entitlements.includes(anspruch as never);

  return {
    activeSubscriptions: laufend.length,
    mrrMinor: zahlend.reduce((summe, eintrag) => summe + eintrag.product.priceMinor, 0),
    premiumMembers: laufend.filter((eintrag) => hat(eintrag, 'PREMIUM_ROLE')).length,
    stuebliMembers: laufend.filter((eintrag) => hat(eintrag, 'PRIVATE_VOICE')).length,
    bundleMembers: laufend.filter(
      (eintrag) => hat(eintrag, 'PREMIUM_ROLE') && hat(eintrag, 'PRIVATE_VOICE'),
    ).length,
    failedPayments,
    cancellations: laufend.filter((eintrag) => eintrag.status === 'CANCEL_AT_PERIOD_END').length,
    syncErrors,
    activeStuebli,
  };
}

export interface SubscriptionQuery {
  search?: string;
  productId?: string;
  status?: PremiumSubscriptionStatus;
  syncFailed?: boolean;
  withStuebli?: boolean;
  page: number;
  pageSize: number;
}

export interface SubscriptionRow {
  subscription: SubscriptionWithProduct;
  username: string;
  avatarHash: string | null;
  stuebliChannelId: string | null;
  stuebliName: string | null;
}

export interface SubscriptionPage {
  rows: SubscriptionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSubscriptions(query: SubscriptionQuery): Promise<SubscriptionPage> {
  const where: Record<string, unknown> = {};
  if (query.productId) {
    where.productId = query.productId;
  }
  if (query.status) {
    where.status = query.status;
  }
  if (query.syncFailed) {
    where.discordSyncStatus = 'FAILED';
  }
  if (query.search) {
    where.OR = [
      { discordId: { contains: query.search } },
      { user: { username: { contains: query.search, mode: 'insensitive' } } },
    ];
  }

  const [eintraege, total] = await Promise.all([
    prisma.premiumSubscription.findMany({
      where,
      include: { product: true, user: { select: { username: true, avatarHash: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.premiumSubscription.count({ where }),
  ]);

  const stuebli = await prisma.premiumDiscordResource.findMany({
    where: {
      userId: { in: eintraege.map((eintrag) => eintrag.userId) },
      resourceType: 'PREMIUM_STUEBLI_VOICE',
    },
  });
  const nachBenutzer = new Map(stuebli.map((eintrag) => [eintrag.userId, eintrag]));

  const rows = eintraege
    .map((eintrag) => {
      const kanal = nachBenutzer.get(eintrag.userId);
      return {
        subscription: eintrag,
        username: eintrag.user.username,
        avatarHash: eintrag.user.avatarHash,
        stuebliChannelId: kanal?.state === 'ACTIVE' ? kanal.discordResourceId : null,
        stuebliName: kanal?.state === 'ACTIVE' ? kanal.name : null,
      };
    })
    .filter((row) => (query.withStuebli ? row.stuebliChannelId !== null : true));

  return { rows, total, page: query.page, pageSize: query.pageSize };
}

export async function listPayments(options: {
  userId?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: Array<PremiumPayment & { productName: string | null; username: string | null }>; total: number }> {
  const where = options.userId ? { userId: options.userId } : {};
  const [zahlungen, total] = await Promise.all([
    prisma.premiumPayment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      include: { subscription: { include: { product: true } } },
    }),
    prisma.premiumPayment.count({ where }),
  ]);

  const benutzer = await prisma.user.findMany({
    where: { id: { in: zahlungen.map((eintrag) => eintrag.userId) } },
    select: { id: true, username: true },
  });
  const namen = new Map(benutzer.map((eintrag) => [eintrag.id, eintrag.username]));

  return {
    rows: zahlungen.map((eintrag) => ({
      ...eintrag,
      productName: eintrag.subscription?.product.name ?? null,
      username: namen.get(eintrag.userId) ?? null,
    })),
    total,
  };
}

/** Alle Stuebli - fuer die Verwaltung. */
export async function listStuebli(): Promise<
  Array<{
    id: string;
    userId: string;
    discordId: string;
    username: string | null;
    avatarHash: string | null;
    channelId: string | null;
    channelName: string | null;
    categoryId: string | null;
    state: string;
    lastSyncAt: Date | null;
    lastSyncError: string | null;
    productName: string | null;
  }>
> {
  const eintraege = await prisma.premiumDiscordResource.findMany({
    where: { resourceType: 'PREMIUM_STUEBLI_VOICE' },
    orderBy: { updatedAt: 'desc' },
    include: { subscription: { include: { product: true } } },
  });

  const benutzer = await prisma.user.findMany({
    where: { id: { in: eintraege.map((eintrag) => eintrag.userId) } },
    select: { id: true, username: true, avatarHash: true },
  });
  const nachId = new Map(benutzer.map((eintrag) => [eintrag.id, eintrag]));

  return eintraege.map((eintrag) => ({
    id: eintrag.id,
    userId: eintrag.userId,
    discordId: eintrag.discordId,
    username: nachId.get(eintrag.userId)?.username ?? null,
    avatarHash: nachId.get(eintrag.userId)?.avatarHash ?? null,
    channelId: eintrag.discordResourceId,
    channelName: eintrag.name,
    categoryId: eintrag.discordCategoryId,
    state: eintrag.state,
    lastSyncAt: eintrag.lastSyncAt,
    lastSyncError: eintrag.lastSyncError,
    productName: eintrag.subscription?.product.name ?? null,
  }));
}
