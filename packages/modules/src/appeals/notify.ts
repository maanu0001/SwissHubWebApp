import { prisma } from '@swisshub/database';
import type { Appeal } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { meldeEreignis } from '../automation/emit';
import { APPEALS_MODULE_ID, type AppealsSettings } from './config';
import { formatFallnummer } from './numbering';

const logger = createLogger('appeals:notify');

/**
 * Meldungen an das Team (§35).
 *
 * Zwei Wege, und beide bestehen bereits - es entsteht keiner dazu:
 *
 * 1. **Der Meldekanal.** Dasselbe Muster wie bei der Verifikation und den
 *    Automationen: ein Kanal aus den Moduleinstellungen, eine Einbettung, eine
 *    Erwähnung nur, wenn eine Rolle hinterlegt ist.
 * 2. **Die Automation Engine.** Jedes Ereignis geht zusätzlich über den
 *    bestehenden Ereignisbus; wer eine eigene Reaktion will, baut eine
 *    Automation. Ein zweites Benachrichtigungssystem gäbe es damit nicht.
 *
 * **Es gibt keine Team Inbox in SwissHub.** Die Aufgabenstellung sieht eine
 * Integration vor, falls es sie gibt - es gibt sie nicht, und ein zweites
 * Posteingangs-Datenmodell zu bauen wäre genau die Parallelarchitektur, die
 * hier nicht entstehen soll (§18). Der Meldekanal und die Übersichtsseite
 * erfüllen denselben Zweck mit dem, was da ist.
 */

const FARBE = {
  neu: 0x83060a,
  antwort: 0x5865f2,
  fehler: 0xd93025,
} as const;

async function sendeMeldung(
  titel: string,
  beschreibung: string,
  farbe: number,
  optionen: { erwaehnen?: boolean; gateway?: DiscordGateway } = {},
): Promise<void> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  if (!settings.meldeKanalId) {
    return;
  }
  const gateway = optionen.gateway ?? defaultDiscord;
  const erwaehnung = optionen.erwaehnen && settings.meldeRolleId ? `<@&${settings.meldeRolleId}>` : null;

  try {
    await gateway.channels.send(settings.meldeKanalId, {
      ...(erwaehnung ? { content: erwaehnung } : {}),
      embeds: [
        {
          title: titel,
          description: beschreibung,
          color: farbe,
          timestamp: new Date().toISOString(),
          footer: { text: 'Entbannungsanträge' },
        },
      ],
      // Nur die eine, ausdrücklich gewählte Rolle darf pingen.
      allowedMentions:
        erwaehnung && settings.meldeRolleId ? { parse: [], roles: [settings.meldeRolleId] } : { parse: [] },
    });
  } catch (error) {
    // Eine misslungene Meldung darf den Vorgang nicht umwerfen: der Antrag
    // steht bereits, und im Dashboard ist er sichtbar.
    logger.warn('Meldung konnte nicht gesendet werden', { error });
  }
}

function kopf(appeal: Appeal): string {
  return `**${formatFallnummer(appeal.caseYear, appeal.caseNumber)}** · ${appeal.applicantUsername}`;
}

/** Ein neuer Antrag ist da. */
export async function meldeNeuerAntrag(
  appeal: Appeal,
  optionen: { gateway?: DiscordGateway } = {},
): Promise<void> {
  const fruehere = await prisma.appeal
    .count({
      where: {
        guildId: appeal.guildId,
        applicantDiscordId: appeal.applicantDiscordId,
        id: { not: appeal.id },
        status: { not: 'DRAFT' },
      },
    })
    .catch(() => 0);

  await sendeMeldung(
    'Neuer Entbannungsantrag',
    [
      kopf(appeal),
      `Discord-ID: \`${appeal.applicantDiscordId}\``,
      fruehere > 0 ? `**${fruehere} frühere Anträge**` : null,
    ]
      .filter((zeile): zeile is string => zeile !== null)
      .join('\n'),
    FARBE.neu,
    { erwaehnen: true, ...optionen },
  );

  const snapshot = appeal.banSnapshot as { quelle?: string };
  await meldeEreignis(
    'appeal.submitted',
    {
      appealId: appeal.id,
      fallnummer: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      discordId: appeal.applicantDiscordId,
      displayName: appeal.applicantUsername,
      quelle: snapshot.quelle === 'swisshub' ? 'swisshub' : 'discord',
      fruehereAntraege: fruehere,
    },
    { guildId: appeal.guildId, subjectId: appeal.applicantDiscordId, entityId: appeal.id },
  );
}

/** Der Antragsteller hat geantwortet. */
export async function meldeAntwort(
  appeal: Appeal,
  optionen: { gateway?: DiscordGateway } = {},
): Promise<void> {
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  if (settings.meldeBeiAntwort) {
    await sendeMeldung('Antwort im Entbannungsantrag', kopf(appeal), FARBE.antwort, optionen);
  }

  await meldeEreignis(
    'appeal.message_received',
    {
      appealId: appeal.id,
      fallnummer: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      discordId: appeal.applicantDiscordId,
      displayName: appeal.applicantUsername,
    },
    { guildId: appeal.guildId, subjectId: appeal.applicantDiscordId, entityId: appeal.id },
  );
}

/** Eine Entscheidung ist gefallen. */
export async function meldeEntscheidung(
  appeal: Appeal,
  art: 'APPROVE' | 'REJECT',
  zusatz: { entbannt?: boolean; erneutErlaubt?: boolean } = {},
): Promise<void> {
  const gemeinsam = {
    appealId: appeal.id,
    fallnummer: formatFallnummer(appeal.caseYear, appeal.caseNumber),
    discordId: appeal.applicantDiscordId,
    displayName: appeal.applicantUsername,
  };

  if (art === 'APPROVE') {
    await meldeEreignis(
      'appeal.approved',
      { ...gemeinsam, entbannt: zusatz.entbannt ?? false },
      { guildId: appeal.guildId, subjectId: appeal.applicantDiscordId, entityId: appeal.id },
    );
    return;
  }

  await meldeEreignis(
    'appeal.rejected',
    {
      ...gemeinsam,
      erneutErlaubt: zusatz.erneutErlaubt ?? false,
      naechsteMoeglichkeitAm: appeal.nextEligibleAt?.toISOString() ?? null,
    },
    { guildId: appeal.guildId, subjectId: appeal.applicantDiscordId, entityId: appeal.id },
  );
}

/**
 * Die Entbannung ist gescheitert.
 *
 * Die dringlichste Meldung des Moduls: der Antrag ist genehmigt, aber jemand
 * wartet weiter draussen. Ohne diese Meldung fiele es erst auf, wenn er
 * nachfragt.
 */
export async function meldeEntbannungGescheitert(
  appeal: Appeal,
  grund: string,
  optionen: { gateway?: DiscordGateway } = {},
): Promise<void> {
  await sendeMeldung(
    'Entbannung nach Genehmigung gescheitert',
    [kopf(appeal), grund, 'Der Antrag ist genehmigt - die Entbannung fehlt noch.'].join('\n'),
    FARBE.fehler,
    { erwaehnen: true, ...optionen },
  );

  await meldeEreignis(
    'appeal.unban_failed',
    {
      appealId: appeal.id,
      fallnummer: formatFallnummer(appeal.caseYear, appeal.caseNumber),
      discordId: appeal.applicantDiscordId,
      displayName: appeal.applicantUsername,
      grund: grund.slice(0, 300),
    },
    { guildId: appeal.guildId, subjectId: appeal.applicantDiscordId, entityId: appeal.id },
  );
}
