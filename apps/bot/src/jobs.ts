import { writeFile } from 'node:fs/promises';
import { jobConfig } from '@swisshub/config';
import { createLogger } from '@swisshub/logger';
import { purgeExpiredIdempotencyKeys } from '@swisshub/database';
import { purgeExpiredSessions } from '@swisshub/auth';
import { tryResolveGuildId } from '@swisshub/discord';
import * as automationEngine from '@swisshub/automation';
import {
  analytics,
  appeals,
  automation,
  calendar,
  jail,
  level,
  logs,
  moderation,
  spielersuche,
  syncDiscord,
  writeHeartbeat,
  premium,
  tickets,
  tournaments,
  voice,
  verification,
  voiceHub,
  getModuleSettings,
} from '@swisshub/modules';


const log = createLogger('bot:jobs');

/**
 * Datei, an deren Alter Docker erkennt, ob der Bot noch arbeitet.
 *
 * Der Bot hat keine Schnittstelle, die man anfragen koennte - er redet mit
 * Discord und mit der Datenbank, sonst mit niemandem. Ein Gesundheitscheck
 * braucht aber etwas, das von aussen pruefbar ist.
 *
 * Nicht «laeuft der Prozess»: das waere er auch dann noch, wenn die
 * Verbindung zu Discord abgerissen und jeder Job stehengeblieben ist. Die
 * Datei entsteht im selben Durchgang wie der Herzschlag in der Datenbank -
 * ist sie frisch, dreht sich die Job-Schleife wirklich noch.
 *
 * `/tmp` und nicht das Upload-Verzeichnis: dort liegt der Bot nur lesend.
 */
export const LEBENSZEICHEN_DATEI = process.env.SWISSHUB_BOT_LIVENESS_FILE ?? '/tmp/swisshub-bot-alive';

async function beruehreLebenszeichen(): Promise<void> {
  try {
    await writeFile(LEBENSZEICHEN_DATEI, new Date().toISOString(), 'utf8');
  } catch (error) {
    // Kein Grund, den Durchgang scheitern zu lassen - der Herzschlag in der
    // Datenbank ist die eigentliche Auskunft.
    log.debug('Lebenszeichen konnte nicht geschrieben werden', { error });
  }
}

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
        await beruehreLebenszeichen();
      },
    },
    {
      /**
       * Kann der Bot Discords Audit Log lesen?
       *
       * Ohne dieses Recht bleiben direkt in Discord ergriffene Massnahmen
       * ohne Handelnden, und Kicks werden gar nicht erkannt. Der Bot laeuft
       * dann weiter - aber der Systemstatus soll es sagen, statt dass es
       * jemandem irgendwann an einer luecken Akte auffaellt.
       */
      name: 'moderation-audit-zugang',
      intervalMs: jobConfig.auditAccessCheckIntervalMs,
      runOnStart: true,
      async run() {
        const befund = await moderation.pruefeUndVermerkeAuditZugang();
        if (befund.zugang === 'kein-recht') {
          log.warn(
            'Dem Bot fehlt die Berechtigung «Audit-Log anzeigen» - Moderationsaktionen direkt aus Discord können nicht vollständig erkannt werden.',
          );
        }
      },
    },
    {
      /**
       * Was der Bot verpasst hat, waehrend er nicht verbunden war.
       *
       * Discord liefert Gateway-Ereignisse nicht nach. Ohne diesen Lauf
       * fehlte in der Akte genau das, was waehrend eines Neustarts geschah -
       * und niemand wuesste, dass es fehlt.
       */
      name: 'moderation-audit-abgleich',
      intervalMs: jobConfig.auditReconcileIntervalMs,
      async run() {
        const ergebnis = await moderation.gleicheAuditLogAb();
        if (ergebnis.erfasst > 0) {
          log.info('Nachgetragene Massnahmen aus Discord', { anzahl: ergebnis.erfasst });
        }
      },
    },
    {
      /**
       * Die eingereihten Discord-Logs zustellen.
       *
       * Getrennt vom Einreihen, weil die beiden verschiedene Anforderungen
       * haben: wer jemanden bannt, soll nicht darauf warten, dass Discord
       * einen Embed annimmt.
       */
      name: 'logs-zustellung',
      intervalMs: jobConfig.logDeliveryIntervalMs,
      async run() {
        await logs.holeSteckengebliebeneZurueck();
        const ergebnis = await logs.stelleZu();
        if (ergebnis.gescheitert > 0) {
          log.warn('Discord-Logs konnten nicht zugestellt werden', {
            anzahl: ergebnis.gescheitert,
          });
        }
      },
    },
    {
      /**
       * Taugen die eingerichteten Log-Kanaele noch?
       *
       * Ein geloeschter Kanal oder ein entzogenes Recht faellt sonst erst
       * auf, wenn jemand ein fehlendes Log sucht.
       */
      name: 'logs-kanalpruefung',
      intervalMs: jobConfig.logHealthIntervalMs,
      runOnStart: true,
      async run() {
        const ergebnis = await logs.pruefeAlleZiele();
        if (ergebnis.ungueltig > 0) {
          log.warn('Log-Kanäle nicht mehr nutzbar', { anzahl: ergebnis.ungueltig });
        }
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
      name: 'calendar-schedule',
      // Zeitsteuerung des Community-Kalenders: Events auf «läuft» und
      // «beendet» fortschreiben, wenn ihre Zeiten erreicht sind.
      //
      // Der Zustand steht in der Datenbank, nicht in Zeitgebern - ein
      // Neustart verliert deshalb keine Frist, und nach einem Ausfall über
      // Nacht wird nachgeholt, was fällig geworden ist.
      intervalMs: 60 * 1000,
      async run() {
        const { isModuleEnabled } = await import('@swisshub/modules');
        if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
          return;
        }
        const ergebnis = await calendar.runCalendarTick();
        if (ergebnis.gestartet.length > 0 || ergebnis.beendet.length > 0) {
          log.info('Kalender fortgeschrieben', {
            gestartet: ergebnis.gestartet.length,
            beendet: ergebnis.beendet.length,
          });
        }
      },
    },
    {
      name: 'calendar-reminders',
      // Fällige Erinnerungen verschicken.
      //
      // Häufiger als die Zeitsteuerung: eine Erinnerung «15 Minuten vorher»
      // soll auf die Minute genau kommen, nicht irgendwann danach. Der Lauf
      // selbst ist billig - ohne fällige Zeile liest er nichts.
      //
      // Doppelte Nachrichten verhindert der Lauf selbst: er belegt jede
      // Erinnerung unter einer Bedingung, die nur einmal zutrifft. Auch bei
      // mehreren Bot-Instanzen sendet damit genau eine.
      intervalMs: 30 * 1000,
      async run() {
        const { isModuleEnabled } = await import('@swisshub/modules');
        if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
          return;
        }
        await calendar.runReminderTick();
      },
    },
    {
      name: 'verification-sweep',
      // Verifikationen ablaufen lassen und alte Nachrichtentexte entfernen.
      //
      // Selten genug: es geht um Stunden-Fristen und um eine
      // Aufbewahrungsgrenze in Tagen. Ein Lauf alle fünf Minuten reicht
      // dafür bei weitem.
      intervalMs: 5 * 60 * 1000,
      async run() {
        const { isModuleEnabled } = await import('@swisshub/modules');
        if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
          return;
        }
        const ergebnis = await verification.runVerificationTick();
        if (ergebnis.abgelaufen > 0 || ergebnis.bereinigt > 0) {
          log.info('Verifikationen fortgeschrieben', { ...ergebnis });
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
       * Geschlossene Ticket-Kanaele abraeumen.
       *
       * Eigener, sehr kurzer Durchgang - getrennt vom grossen Ticket-Lauf,
       * weil er etwas anderes leistet. Nach dem Schliessen soll der Kanal
       * nach fuenf Sekunden verschwinden; den Regelfall erledigt ein Wecker
       * im schliessenden Prozess. Faellt der aus - Neustart, Deployment,
       * Absturz zwischen Abschluss und Loeschung -, bliebe der Kanal bis zum
       * naechsten grossen Lauf stehen, und das sind fuenf Minuten.
       *
       * Dieser Durchgang macht daraus fuenfzehn Sekunden. Er ist billig: die
       * Faelligkeit steht in der Datenbank und ist indiziert, und fast immer
       * findet er nichts.
       */
      name: 'ticket-kanaele',
      intervalMs: 15 * 1000,
      async run() {
        const { isModuleEnabled } = await import('@swisshub/modules');
        if (!(await isModuleEnabled(tickets.TICKETS_MODULE_ID))) {
          return;
        }
        await tickets.purgeDueChannels();
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
    {
      // Der Herzschlag der Automation Engine.
      //
      // Ereignisse werden geschrieben, sobald etwas geschieht - verteilt
      // werden sie hier. Fuenf Sekunden sind der Kompromiss: schnell genug,
      // dass eine Willkommensnachricht als sofort empfunden wird, selten
      // genug, dass ein leerer Server keine Last erzeugt.
      name: 'automation-dispatch',
      intervalMs: 5 * 1000,
      runOnStart: true,
      async run() {
        const ergebnis = await automationEngine.verteileEreignisse({ limit: 50 });
        if (ergebnis.laeufe > 0) {
          log.info('Automationen ausgeloest', {
            ereignisse: ergebnis.ereignisse,
            laeufe: ergebnis.laeufe,
            uebersprungen: ergebnis.uebersprungen,
          });
        }
      },
    },
    {
      // Faellige Wecker: Fortsetzungen nach einem Wait, Zeitplaene und
      // eingereihte Laeufe. Getrennt vom Verteiler, damit ein langsamer
      // Wait-Schritt die Ereignisverteilung nicht aufhaelt.
      name: 'automation-jobs',
      intervalMs: 10 * 1000,
      runOnStart: true,
      async run() {
        // Zuerst die verwaisten zurueckholen: ein Job, den ein abgestuerzter
        // Prozess in der Hand hielt, liefe sonst nie wieder an.
        await automationEngine.holeVerwaisteZurueck();
        const ergebnis = await automationEngine.verarbeiteJobs({ limit: 20 });
        if (ergebnis.gescheitert > 0) {
          log.warn('Automations-Aufgaben gescheitert', {
            bearbeitet: ergebnis.bearbeitet,
            gescheitert: ergebnis.gescheitert,
          });
        }
      },
    },
    {
      // Kommende Termine sichern. Der Verteiler plant nach jedem Lauf den
      // naechsten; dieser Durchgang faengt den Fall ab, dass ein Wecker
      // verlorenging - etwa weil der Prozess zwischen Ausfuehrung und
      // Neuplanung endete.
      name: 'automation-schedule',
      intervalMs: 5 * 60 * 1000,
      runOnStart: true,
      async run() {
        const geplant = await automationEngine.planeZeitTrigger();
        if (geplant > 0) {
          log.info('Zeitgesteuerte Automationen eingeplant', { anzahl: geplant });
        }
      },
    },
    {
      // Entbannungsantraege: was ausserhalb des Antrags geschieht.
      //
      // Zwei Dinge muessen im Antrag ankommen, obwohl sie woanders passieren:
      // ein von Hand aufgehobener Bann macht ihn gegenstandslos, und ein
      // Antragsteller, der nicht antwortet, laesst ihn ablaufen. Beides steht
      // in der Datenbank und ueberlebt damit einen Neustart.
      name: 'appeals-wartung',
      intervalMs: 10 * 60 * 1000,
      async run() {
        const ergebnis = await appeals.wartung();
        if (ergebnis.externAufgehoben > 0 || ergebnis.abgelaufen > 0) {
          log.info('Entbannungsantraege gewartet', {
            externAufgehoben: ergebnis.externAufgehoben,
            abgelaufen: ergebnis.abgelaufen,
            anhaengeEntfernt: ergebnis.anhaengeEntfernt,
          });
        }
      },
    },
    {
      // Meldungen an das Team (§26, §32).
      //
      // Der Fehler-Posteingang im Dashboard ist die vollstaendige Auskunft -
      // aber er wird nur gesehen, wenn jemand hinsieht. Eine Automation, die
      // seit drei Tagen scheitert, faellt sonst erst auf, wenn jemand nach ihr
      // fragt.
      name: 'automation-meldungen',
      intervalMs: 60 * 1000,
      async run() {
        const ergebnis = await automation.meldeOffenes();
        if (ergebnis.fehler > 0 || ergebnis.freigaben > 0) {
          log.info('Automations-Meldungen gesendet', {
            fehler: ergebnis.fehler,
            freigaben: ergebnis.freigaben,
          });
        }
      },
    },
    {
      // Aufbewahrung (§34). Einmal pro Stunde genuegt: es geht um Tage, nicht
      // um Minuten.
      name: 'automation-retention',
      intervalMs: 60 * 60 * 1000,
      async run() {
        const guildId = await tryResolveGuildId();
        if (!guildId) {
          return;
        }
        const settings = await getModuleSettings<automation.AutomationSettings>('automation');
        const [laeufe, ereignisse, aufgaben] = await Promise.all([
          automationEngine.raeumeLaeufe(settings.verlaufTage),
          automationEngine.raeumeEreignisse(settings.ereignisseTage),
          automationEngine.raeumeJobs(settings.ereignisseTage),
        ]);
        if (laeufe + ereignisse + aufgaben > 0) {
          log.info('Automations-Aufbewahrung durchgesetzt', { laeufe, ereignisse, aufgaben });
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
