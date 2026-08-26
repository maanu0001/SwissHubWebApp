import { jobConfig } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { purgeExpiredIdempotencyKeys } from '@swisshub/database';
import { purgeExpiredSessions } from '@swisshub/auth';
import { tryResolveGuildId } from '@swisshub/discord';
import {
  analytics,
  jail,
  level,
  spielersuche,
  syncDiscord,
  writeHeartbeat,
  premium,
  tickets,
  tournaments,
  voice,
  voiceHub,
} from '@swisshub/modules';

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
  /**
   * Ein Durchgang XP für Zeit im Sprachkanal. Wird von aussen übergeben, weil
   * dafür der Discord-Client gebraucht wird - die übrigen Jobs kommen ohne aus.
   */
  runVoiceXp?: () => Promise<{ checked: number; granted: number; xp: number }>,
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
      name: 'level-voice-xp',
      // Wie beim Vorgänger zählt jeder Durchgang als eine Minute im Voice.
      // Ausgefallene Durchgänge werden bewusst nicht nachgeholt - sonst
      // entstünde nach einer Störung ein XP-Schub.
      intervalMs: 60 * 1000,
      async run() {
        if (!runVoiceXp) {
          return;
        }
        const result = await runVoiceXp();
        if (result.granted > 0) {
          log.debug('Voice-XP vergeben', { ...result });
        }
      },
    },
    {
      name: 'level-decay',
      // Inaktivitäts-Abzug. Das Intervall steht in den Moduleinstellungen;
      // hier wird häufiger geprüft, der Lauf selbst rechnet in vollen Tagen
      // und kann deshalb nicht zu viel abziehen.
      intervalMs: 5 * 60 * 1000,
      async run() {
        const result = await level.runDecaySweep();
        if (result.changed > 0) {
          log.info('Inaktivitäts-Abzug verrechnet', { ...result });
        }
      },
    },
    {
      name: 'xp-raffle-schedule',
      // Zeitsteuerung der Verlosungen: Teilnahme öffnen und schliessen, wenn
      // die hinterlegten Zeitpunkte erreicht sind. Bewusst hier statt über
      // Zeitgeber im Arbeitsspeicher - ein Neustart würde die sonst
      // verlieren, und eine Verlosung stünde nach einem Ausfall über Nacht
      // immer noch offen.
      intervalMs: 30 * 1000,
      async run() {
        const result = await level.raffle.runRaffleTick();
        for (const raffleId of [...result.opened, ...result.closed]) {
          await level.raffle.refreshAnnouncement(raffleId).catch(() => undefined);
        }

        // Verlosungen, bei denen die Verwaltung die Ziehung selbsttätig
        // wünscht. Der Gewinner entsteht auch hier ausschliesslich im
        // Server-Verfahren - die Zeitsteuerung drückt nur den Knopf.
        for (const raffle of result.readyToDraw) {
          try {
            await level.raffle.startDraw({ discordId: 'system', username: 'Zeitsteuerung' }, raffle.id);
            log.info('Ziehung selbsttätig gestartet', { raffleId: raffle.id });
          } catch (error) {
            log.warn('Selbsttätige Ziehung nicht möglich', { raffleId: raffle.id, error });
          }
        }
      },
    },
    {
      name: 'voice-hub-reconcile',
      // Temporäre Talks: fällige leere löschen, verwaiste übergeben, Zeilen
      // ohne Discord-Kanal schliessen.
      //
      // Bewusst häufig: die Schonfrist eines leeren Talks liegt bei
      // Voreinstellung bei dreissig Sekunden, und ein Lauf alle fünf Minuten
      // liesse ihn viereinhalb Minuten zu lange stehen. Der Lauf selbst ist
      // billig - er liest eine Handvoll Zeilen.
      intervalMs: 20 * 1000,
      async run() {
        await voice.reconcileTemporaryVoices();
      },
    },
    {
      name: 'voice-hub-retention',
      // Geschlossene Talks und ihren Verlauf nach der eingestellten Frist
      // entfernen. Die Statistik braucht sie eine Weile, aber nicht ewig.
      intervalMs: 6 * 60 * 60 * 1000,
      async run() {
        const { getModuleSettings, isModuleEnabled } = await import('@swisshub/modules');
        if (!(await isModuleEnabled(voiceHub.VOICE_HUB_MODULE_ID))) {
          return;
        }
        const settings = await getModuleSettings<voiceHub.VoiceHubSettings>(voiceHub.VOICE_HUB_MODULE_ID);
        await voice.raeumeAlteTalks(settings.historyRetentionDays);
      },
    },
    {
      name: 'level-game-cleanup',
      // Partien freigeben, die nie zu Ende gespielt wurden. Ohne das blieben
      // beide Beteiligten für neue Spiele gesperrt.
      intervalMs: 60 * 1000,
      async run() {
        await level.runGameCleanup();
      },
    },
    {
      /**
       * Tickets: erinnern, selbsttaetig schliessen, aufraeumen.
       *
       * Fuenf Minuten sind fein genug - Fristen zaehlen in Tagen. Der
       * Durchgang prueft selbst, ob das Modul eingeschaltet ist; ein
       * ausgeschaltetes Modul soll im Hintergrund nichts loeschen.
       */
      name: 'tickets-tick',
      intervalMs: 5 * 60 * 1000,
      async run() {
        await tickets.runTicketTick();
      },
    },
    {
      /**
       * Turniere: Phasen wechseln, erinnern, aufraeumen.
       *
       * Eine Minute, weil Check-in-Fenster in Minuten zaehlen: ein Check-in,
       * der fuenf Minuten zu spaet oeffnet, kostet die Haelfte der Zeit, die
       * er hat. Der Durchgang prueft selbst, ob das Modul eingeschaltet ist.
       */
      name: 'tournaments-tick',
      intervalMs: 60 * 1000,
      async run() {
        await tournaments.runTournamentTick();
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
      /**
       * Premium: abgelaufene Abonnements beenden und Discord nachziehen.
       *
       * Bewusst im bestehenden Job-Runner - es gibt keinen zweiten
       * Zeitplaner. Fuenf Minuten sind fein genug: eine Schonfrist zaehlt in
       * Tagen, und ein fehlgeschlagener Abgleich soll nicht stundenlang
       * stehen bleiben.
       */
      name: 'premium-reconcile',
      intervalMs: 5 * 60 * 1000,
      async run() {
        const ergebnis = await premium.reconcilePremium();
        if (ergebnis.expired > 0 || ergebnis.failed > 0) {
          log.info('Premium abgeglichen', { ...ergebnis });
        }
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
    {
      /**
       * Aggregate aus vorhandenen Ereignissen nachziehen.
       *
       * Laeuft **nicht** beim Start: bei vielen Ereignissen wuerde der Bot
       * sonst minutenlang nicht auf Discord reagieren. Stattdessen ein
       * gewoehnlicher Job, der stapelweise arbeitet und aufhoert, sobald er
       * aufgeholt hat. Zweimal laufen lassen ergibt dieselben Zahlen, nicht
       * die doppelten.
       */
      name: 'analytics-backfill',
      intervalMs: 5 * 60 * 1000,
      runOnStart: false,
      async run() {
        const guildId = await tryResolveGuildId();
        if (!guildId) {
          return;
        }
        const stand = await analytics.trackingStand(guildId);
        // Schon aufgeholt: nichts zu tun. Der Job kostet dann eine Abfrage.
        if (stand?.backfilledUntil && stand.backfilledUntil >= new Date(Date.now() - 60_000)) {
          return;
        }
        const ergebnis = await analytics.backfill(guildId, { maxStapel: 20 });
        if (ergebnis.ereignisse > 0 || ergebnis.sprachAbschnitte > 0) {
          log.info('Analytics-Aggregate nachgezogen', {
            ereignisse: ergebnis.ereignisse,
            beitritte: ergebnis.beitritte,
            austritte: ergebnis.austritte,
            sprachAbschnitte: ergebnis.sprachAbschnitte,
          });
        }
      },
    },
    {
      /**
       * Mitgliederzahl des Tages festhalten.
       *
       * Der Mitgliederverlauf entsteht aus diesen Momentaufnahmen. Aus Bei-
       * und Austritten allein liesse er sich nur rekonstruieren, wenn man den
       * Anfangsstand kennte - und den kennt niemand fuer die Zeit vor Beginn
       * der Aufzeichnung.
       */
      name: 'analytics-member-count',
      intervalMs: 60 * 60 * 1000,
      runOnStart: false,
      async run() {
        const guildId = await tryResolveGuildId();
        const anzahl = getStatus().memberCount;
        if (!guildId || anzahl === null) {
          return;
        }
        await analytics.haltMitgliederzahlFest(guildId, anzahl);
      },
    },
    {
      /**
       * Aufbewahrungsfristen des Ereignisprotokolls durchsetzen.
       *
       * Läuft auch, wenn das Modul inzwischen ausgeschaltet wurde: sonst bliebe
       * liegen, was bei eingeschaltetem Modul entstanden ist, und die
       * zugesagte Frist wäre keine. Ohne verbundenen Server gibt es nichts
       * aufzuräumen.
       */
      name: 'analytics-retention',
      intervalMs: 6 * 60 * 60 * 1000,
      async run() {
        const guildId = await tryResolveGuildId();
        if (!guildId) {
          return;
        }
        const ergebnis = await analytics.enforceRetention(guildId);
        if (ergebnis.ereignisse > 0 || ergebnis.medien > 0) {
          log.info('Analytics-Aufbewahrung durchgesetzt', {
            ereignisse: ergebnis.ereignisse,
            medien: ergebnis.medien,
            bytes: ergebnis.bytes,
          });
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
