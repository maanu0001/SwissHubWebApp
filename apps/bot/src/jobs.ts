import { jobConfig } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { purgeExpiredIdempotencyKeys } from '@swisshub/database';
import { purgeExpiredSessions } from '@swisshub/auth';
import { jail, spielersuche, syncDiscord, writeHeartbeat } from '@swisshub/modules';

const log = createLogger('bot:jobs');

export interface JobRunner {
  start(): void;
  stop(): Promise<void>;
}

interface JobDefinition {
  name: string;
  intervalMs: number;
  /** Direkt beim Start einmal ausführen. */
  runOnStart?: boolean;
  run(): Promise<void>;
}

/**
 * Wiederkehrende Hintergrundjobs des Bots.
 *
 * Alle Jobs sind idempotent und überlappungsfrei: läuft ein Durchgang noch,
 * wird der nächste Tick übersprungen. Die Datenbank bleibt Source of Truth,
 * damit ein Neustart nichts verliert.
 */
export function createJobRunner(
  getStatus: () => {
    wsPingMs: number | null;
    online: boolean;
    memberCount: number | null;
    botUserId: string | null;
    botUsername: string | null;
  },
): JobRunner {
  const timers: NodeJS.Timeout[] = [];
  const running = new Set<string>();

  const jobs: JobDefinition[] = [
    {
      name: 'heartbeat',
      intervalMs: jobConfig.heartbeatIntervalMs,
      runOnStart: true,
      async run() {
        const status = getStatus();
        await writeHeartbeat({
          online: status.online,
          wsPingMs: status.wsPingMs,
          guildMemberCount: status.memberCount,
          botUserId: status.botUserId,
          botUsername: status.botUsername,
          version: process.env.npm_package_version ?? '1.0.0',
        });
      },
    },
    {
      name: 'jail-sweep',
      intervalMs: jobConfig.jailSweepIntervalMs,
      runOnStart: true,
      async run() {
        await jail.recoverStuckJails();
        await jail.releaseExpiredJails();
      },
    },
    {
      name: 'reconciliation',
      intervalMs: jobConfig.reconcileIntervalMs,
      async run() {
        await jail.reconcileJails({ mode: 'AUTOMATIC', repair: true });
      },
    },
    {
      name: 'vote-jail-expiry',
      // Abgelaufene Abstimmungen beenden. Die Datenbank ist Source of Truth -
      // ein Neustart verliert dadurch keine laufende Abstimmung.
      intervalMs: 30 * 1000,
      runOnStart: true,
      async run() {
        await jail.expireVoteJails();
      },
    },
    {
      name: 'spielersuche-expiry',
      // Abgelaufene Suchen beenden. Die Datenbank ist Source of Truth - ein
      // Neustart verliert dadurch keine Ablaufzeit.
      intervalMs: 60 * 1000,
      runOnStart: true,
      async run() {
        await spielersuche.expireSearches();
      },
    },
    {
      name: 'spielersuche-onboarding',
      // Minütlich prüfen, ob die tägliche Hinweisnachricht fällig ist. Der
      // Versand selbst merkt sich den Tag und passiert höchstens einmal.
      intervalMs: 60 * 1000,
      async run() {
        await spielersuche.runDailyOnboarding();
      },
    },
    {
      name: 'discord-sync',
      // Sicherheitsnetz: Discord-Ereignisse können ausfallen (Neustart,
      // verpasste Gateway-Events). Ein regelmässiger Abgleich hält die
      // Auswahllisten trotzdem aktuell.
      intervalMs: 15 * 60 * 1000,
      async run() {
        await syncDiscord({ trigger: 'scheduled' });
      },
    },
    {
      name: 'cleanup',
      intervalMs: 60 * 60 * 1000,
      async run() {
        const [sessions, keys, cooldowns] = await Promise.all([
          purgeExpiredSessions(),
          purgeExpiredIdempotencyKeys(),
          jail.purgeExpiredVoteCooldowns(),
        ]);
        if (sessions > 0 || keys > 0 || cooldowns > 0) {
          log.info('Aufräumen abgeschlossen', { sessions, idempotencyKeys: keys, voteCooldowns: cooldowns });
        }
      },
    },
  ];

  async function execute(job: JobDefinition): Promise<void> {
    if (running.has(job.name)) {
      log.debug('Job läuft noch - Tick übersprungen', { job: job.name });
      return;
    }
    running.add(job.name);
    try {
      await job.run();
    } catch (error) {
      log.error('Job fehlgeschlagen', { job: job.name, error });
    } finally {
      running.delete(job.name);
    }
  }

  return {
    start() {
      for (const job of jobs) {
        if (job.runOnStart) {
          void execute(job);
        }
        // Bewusst ohne `unref()`: die Jobs sind die eigentliche Arbeit des
        // Bots und müssen den Prozess am Leben halten - auch dann, wenn keine
        // Gateway-Verbindung besteht (z.B. im Mock-Modus).
        const timer = setInterval(() => void execute(job), job.intervalMs);
        timers.push(timer);
        log.info('Job gestartet', { job: job.name, intervalMs: job.intervalMs });
      }
    },
    async stop() {
      for (const timer of timers) {
        clearInterval(timer);
      }
      timers.length = 0;
      // Laufende Durchgänge kurz auslaufen lassen, damit keine Aktion
      // halb ausgeführt zurückbleibt.
      const deadline = Date.now() + 5000;
      while (running.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}
