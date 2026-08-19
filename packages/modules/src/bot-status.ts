import { jobConfig } from '@swisshub/config';
import { prisma } from '@swisshub/database';

/**
 * Laufzeitstatus des Bots.
 *
 * Der Bot schreibt regelmässig einen Heartbeat in die Datenbank; die WebApp
 * liest ihn. Dadurch braucht es keinen direkten Kanal zwischen den Prozessen
 * und der Status überlebt Neustarts der WebApp.
 */
export interface BotStatusView {
  online: boolean;
  wsPingMs: number | null;
  guildMemberCount: number | null;
  botUsername: string | null;
  lastHeartbeatAt: Date | null;
  lastConnectedAt: Date | null;
  /** True, wenn der letzte Heartbeat zu lange zurückliegt. */
  stale: boolean;
}

export async function readBotStatus(): Promise<BotStatusView> {
  const row = await prisma.botStatus.findUnique({ where: { id: 'singleton' } });
  if (!row) {
    return {
      online: false,
      wsPingMs: null,
      guildMemberCount: null,
      botUsername: null,
      lastHeartbeatAt: null,
      lastConnectedAt: null,
      stale: true,
    };
  }

  const stale = Date.now() - row.lastHeartbeatAt.getTime() > jobConfig.heartbeatStaleAfterMs;
  return {
    online: row.online && !stale,
    wsPingMs: row.wsPingMs,
    guildMemberCount: row.guildMemberCount,
    botUsername: row.botUsername,
    lastHeartbeatAt: row.lastHeartbeatAt,
    lastConnectedAt: row.lastConnectedAt,
    stale,
  };
}

export interface HeartbeatInput {
  online: boolean;
  wsPingMs?: number | null;
  guildMemberCount?: number | null;
  botUserId?: string | null;
  botUsername?: string | null;
  version?: string | null;
  connected?: boolean;
  lastError?: string | null;
}

export async function writeHeartbeat(input: HeartbeatInput): Promise<void> {
  const now = new Date();
  const data = {
    online: input.online,
    wsPingMs: input.wsPingMs ?? null,
    guildMemberCount: input.guildMemberCount ?? null,
    botUserId: input.botUserId ?? null,
    botUsername: input.botUsername ?? null,
    version: input.version ?? null,
    lastHeartbeatAt: now,
    lastError: input.lastError ?? null,
    ...(input.connected ? { lastConnectedAt: now } : {}),
  };

  await prisma.botStatus.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
  });
}
