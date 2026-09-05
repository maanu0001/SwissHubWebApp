import { prisma } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings, isModuleEnabled } from '../module-state';
import { AUTOMATION_MODULE_ID, type AutomationSettings } from './config';

const logger = createLogger('automation:meldungen');

/**
 * Meldungen an das Team.
 *
 * Der Fehler-Posteingang im Dashboard ist die vollständige Auskunft - aber er
 * wird nur gesehen, wenn jemand hinsieht. Eine Automation, die seit drei Tagen
 * scheitert, fällt sonst erst auf, wenn jemand nach ihr fragt (§26).
 *
 * Zwei Regeln, die beide aus demselben Grund gelten - eine Meldung darf nie
 * schlimmer sein als das Problem, über das sie meldet:
 *
 * 1. **Genau einmal je Lauf.** Der Zeitstempel `notifiedAt` wird unter
 *    Bedingung gesetzt; laufen zwei Bot-Prozesse, kommt einer durch.
 * 2. **Nur Frisches.** Gemeldet werden Läufe der letzten Stunde. Ohne diese
 *    Grenze löste die erste Ausführung nach einer längeren Störung - oder nach
 *    der Einführung dieser Funktion - eine Flut alter Meldungen aus.
 */

/** Wie weit zurück gemeldet wird. */
const FENSTER_MS = 60 * 60 * 1000;

/** Wie viele Meldungen ein Durchgang höchstens sendet. */
const HOECHSTENS = 10;

export interface MeldeErgebnis {
  fehler: number;
  freigaben: number;
}

export async function meldeOffenes(
  optionen: { gateway?: DiscordGateway; jetzt?: Date } = {},
): Promise<MeldeErgebnis> {
  if (!(await isModuleEnabled(AUTOMATION_MODULE_ID))) {
    return { fehler: 0, freigaben: 0 };
  }
  const settings = await getModuleSettings<AutomationSettings>(AUTOMATION_MODULE_ID);
  const gateway = optionen.gateway ?? defaultDiscord;
  const jetzt = optionen.jetzt ?? new Date();

  return {
    fehler: await meldeFehler(settings, gateway, jetzt),
    freigaben: await meldeFreigaben(settings, gateway),
  };
}

async function meldeFehler(
  settings: AutomationSettings,
  gateway: DiscordGateway,
  jetzt: Date,
): Promise<number> {
  if (!settings.meldeKanalId) {
    return 0;
  }

  const seit = new Date(jetzt.getTime() - FENSTER_MS);
  const laeufe = await prisma.automationRun.findMany({
    where: {
      status: { in: ['FAILED', 'DEAD_LETTER'] },
      notifiedAt: null,
      dryRun: false,
      createdAt: { gte: seit },
    },
    orderBy: { createdAt: 'asc' },
    take: HOECHSTENS,
    include: { automation: { select: { name: true } } },
  });

  let gemeldet = 0;
  for (const lauf of laeufe) {
    // Erst den Zuschlag holen, dann senden. Umgekehrt könnte ein verlorener
    // Wettlauf die Meldung bereits gesendet haben.
    const zugeteilt = await prisma.automationRun.updateMany({
      where: { id: lauf.id, notifiedAt: null },
      data: { notifiedAt: jetzt },
    });
    if (zugeteilt.count === 0) {
      continue;
    }

    const erwaehnung = settings.meldeRolleId ? `<@&${settings.meldeRolleId}>` : undefined;
    try {
      await gateway.channels.send(settings.meldeKanalId, {
        ...(erwaehnung ? { content: erwaehnung } : {}),
        embeds: [
          {
            title: 'Eine Automation ist gescheitert',
            description: [`**${lauf.automation.name}**`, lauf.error ?? 'Ohne nähere Angabe.'].join('\n'),
            color: 0xd93025,
            timestamp: lauf.createdAt.toISOString(),
            footer: { text: 'Automationen → Fehler' },
          },
        ],
        allowedMentions: settings.meldeRolleId
          ? { parse: [], roles: [settings.meldeRolleId] }
          : { parse: [] },
      });
      gemeldet += 1;
    } catch (error) {
      // Der Zeitstempel bleibt gesetzt: ein Kanal, in den der Bot nicht
      // schreiben darf, soll nicht bei jedem Durchgang erneut versucht
      // werden. Der Lauf steht ohnehin im Fehler-Posteingang.
      logger.warn('Fehlermeldung konnte nicht gesendet werden', { runId: lauf.id, error });
    }
  }

  return gemeldet;
}

/**
 * Offene Freigaben melden (§32).
 *
 * Ohne diese Meldung wartet ein angehaltener Lauf still im Dashboard - und
 * wer nicht hinsieht, lässt ihn tagelang stehen. Die Kennung der gesendeten
 * Nachricht steht an der Freigabe; sie ist zugleich die Marke, dass bereits
 * gemeldet wurde.
 */
async function meldeFreigaben(settings: AutomationSettings, gateway: DiscordGateway): Promise<number> {
  if (!settings.freigabeKanalId) {
    return 0;
  }

  const offene = await prisma.automationApproval.findMany({
    // Der Kanal ist die Marke, nicht die Nachricht: er wird vor dem Senden
    // gesetzt, die Nachrichtenkennung erst danach. Scheitert das Senden,
    // bleibt die Marke stehen und die Kennung `null` - kein erfundener Wert
    // in der Zeile, und kein Versuch im Minutentakt an einem Kanal, in den
    // der Bot ohnehin nicht schreiben darf.
    where: { status: 'PENDING', discordChannelId: null },
    orderBy: { requestedAt: 'asc' },
    take: HOECHSTENS,
    include: { run: { include: { automation: { select: { name: true } } } } },
  });

  let gemeldet = 0;
  for (const freigabe of offene) {
    const zugeteilt = await prisma.automationApproval.updateMany({
      where: { id: freigabe.id, discordChannelId: null },
      data: { discordChannelId: settings.freigabeKanalId },
    });
    if (zugeteilt.count === 0) {
      continue;
    }

    try {
      const gesendet = await gateway.channels.send(settings.freigabeKanalId, {
        embeds: [
          {
            title: 'Eine Automation wartet auf eine Freigabe',
            description: [`**${freigabe.run.automation.name}**`, freigabe.title, '', freigabe.summary].join(
              '\n',
            ),
            color: 0xf9ab00,
            timestamp: freigabe.requestedAt.toISOString(),
            footer: { text: 'Automationen → Fehler' },
          },
        ],
        // Bewusst ohne Knöpfe: freigegeben wird im Dashboard, wo die
        // Berechtigung geprüft und die Entscheidung protokolliert wird. Ein
        // Knopf auf Discord wäre ein zweiter Weg zur selben Wirkung - und der
        // zweite ist immer der, den niemand prüft.
        allowedMentions: { parse: [] },
      });
      await prisma.automationApproval.updateMany({
        where: { id: freigabe.id },
        data: { discordMessageId: gesendet.id },
      });
      gemeldet += 1;
    } catch (error) {
      logger.warn('Freigabemeldung konnte nicht gesendet werden', { approvalId: freigabe.id, error });
    }
  }

  return gemeldet;
}
