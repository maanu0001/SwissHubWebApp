import {
  ActionRowBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { tickets } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION, type CommandActor } from './commands/context';

const log = createLogger('bot:tickets');

/** Kennung des Modals - traegt die Kategorie, damit der Absender sie kennt. */
const MODAL_PREFIX = 'tickets:form:';
/** Kennung des Betreff-Felds im Modal. */
const FELD_BETREFF = 'betreff';
/** Kennung eines Kategorie-Felds; der Index verweist auf die Reihenfolge. */
const FELD_PREFIX = 'feld-';

/**
 * Die Discord-Seite des Ticket-Moduls.
 *
 * Alles laeuft ueber dieselben Services wie das Dashboard: `createTicket`,
 * `claimTicket`, `closeTicket`, `getTicketAccess`. Es gibt hier keine zweite
 * Berechtigungslogik und keinen zweiten Weg, ein Ticket anzulegen - genau das
 * waere der Punkt, an dem Discord und Dashboard auseinanderliefen.
 */
export function registerTicketInteractions(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith(tickets.PANEL_BUTTON_PREFIX)) {
        void zeigeFormular(interaction, interaction.customId.slice(tickets.PANEL_BUTTON_PREFIX.length));
        return;
      }
      if (
        interaction.customId === tickets.TICKET_BUTTON.claim ||
        interaction.customId === tickets.TICKET_BUTTON.close
      ) {
        void behandleTicketKnopf(interaction);
        return;
      }
      if (interaction.customId.startsWith(tickets.FEEDBACK_BUTTON_PREFIX)) {
        void behandleBewertung(
          interaction,
          Number.parseInt(interaction.customId.slice(tickets.FEEDBACK_BUTTON_PREFIX.length), 10),
        );
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) {
      void eroeffne(interaction, interaction.customId.slice(MODAL_PREFIX.length));
    }
  });
}

/** Der Knopf im Panel oeffnet das Formular der gewaehlten Kategorie. */
async function zeigeFormular(interaction: ButtonInteraction, categoryId: string): Promise<void> {
  try {
    const kategorie = await tickets.getCategory(categoryId);
    if (!kategorie || !kategorie.active) {
      await interaction.reply({
        content: 'Diese Kategorie steht nicht mehr zur Verfügung.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const actor = await buildCommandActor(interaction);
    if (!actor.can(tickets.TICKET_PERMISSIONS.create)) {
      await interaction.reply({ content: NO_PERMISSION, flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${kategorie.id}`)
      .setTitle(`Ticket · ${kategorie.name}`.slice(0, 45));

    const zeilen: Array<ActionRowBuilder<TextInputBuilder>> = [
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(FELD_BETREFF)
          .setLabel('Betreff')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(100)
          .setRequired(true)
          .setPlaceholder('Kurz in einem Satz.'),
      ),
    ];

    // Ohne eigene Fragen bleibt ein Feld fuer das Anliegen - ein Ticket, das
    // nur aus einem Betreff besteht, hilft dem Team nicht weiter.
    const felder =
      kategorie.formFields.length > 0
        ? kategorie.formFields.map((feld, index) => ({
            id: `${FELD_PREFIX}${index}`,
            label: feld.label,
            lang: feld.kind === 'LONG_TEXT',
            pflicht: feld.required,
            min: feld.minLength,
            max: feld.maxLength,
            platzhalter: feld.placeholder,
          }))
        : [
            {
              id: `${FELD_PREFIX}0`,
              label: 'Dein Anliegen',
              lang: true,
              pflicht: true,
              min: null as number | null,
              max: 1000 as number | null,
              platzhalter: 'Beschreibe möglichst genau, worum es geht.',
            },
          ];

    for (const feld of felder) {
      const eingabe = new TextInputBuilder()
        .setCustomId(feld.id)
        .setLabel(feld.label.slice(0, 45))
        .setStyle(feld.lang ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(feld.pflicht)
        .setMaxLength(Math.min(feld.max ?? (feld.lang ? 1000 : 200), 1000));
      if (feld.min !== null && feld.min > 0) {
        eingabe.setMinLength(feld.min);
      }
      if (feld.platzhalter) {
        eingabe.setPlaceholder(feld.platzhalter.slice(0, 100));
      }
      zeilen.push(new ActionRowBuilder<TextInputBuilder>().addComponents(eingabe));
    }

    modal.addComponents(...zeilen);
    await interaction.showModal(modal);
  } catch (fehler) {
    log.error('Ticket-Formular konnte nicht geöffnet werden', { fehler, categoryId });
    await interaction
      .reply({
        content: 'Das Formular liess sich nicht öffnen. Bitte später erneut versuchen.',
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => undefined);
  }
}

/** Das abgeschickte Formular wird zum Ticket. */
async function eroeffne(interaction: ModalSubmitInteraction, categoryId: string): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const kategorie = await tickets.getCategory(categoryId);
    if (!kategorie || !kategorie.active) {
      await interaction.editReply({ content: 'Diese Kategorie steht nicht mehr zur Verfügung.' });
      return;
    }

    const actor = await buildCommandActor(interaction);
    if (!actor.can(tickets.TICKET_PERMISSIONS.create)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    const betreff = interaction.fields.getTextInputValue(FELD_BETREFF).trim();

    const formAnswers: Record<string, string> = {};
    if (kategorie.formFields.length > 0) {
      kategorie.formFields.forEach((feld, index) => {
        const wert = lieferWert(interaction, `${FELD_PREFIX}${index}`);
        if (wert.length > 0) {
          formAnswers[feld.label] = wert;
        }
      });
    } else {
      const wert = lieferWert(interaction, `${FELD_PREFIX}0`);
      if (wert.length > 0) {
        formAnswers['Anliegen'] = wert;
      }
    }

    const ticket = await tickets.createTicket({
      categoryId: kategorie.id,
      subject: betreff,
      creatorDiscordId: actor.discordId,
      creatorUsername: actor.username,
      formAnswers,
      source: 'DISCORD_PANEL',
      actor: { discordId: actor.discordId, username: actor.username, source: 'DISCORD' },
    });

    await interaction.editReply({
      content: ticket.discordChannelId
        ? `Dein Ticket **#${String(ticket.ticketNumber).padStart(4, '0')}** ist eröffnet: <#${ticket.discordChannelId}>`
        : `Dein Ticket **#${String(ticket.ticketNumber).padStart(4, '0')}** ist erfasst. Der Kanal folgt gleich.`,
    });
  } catch (fehler) {
    const meldung =
      fehler instanceof AppError
        ? fehler.userMessage
        : 'Das Ticket liess sich nicht eröffnen. Bitte später erneut versuchen.';
    if (!(fehler instanceof AppError)) {
      log.error('Ticket konnte nicht eröffnet werden', { fehler, categoryId });
    }
    await interaction.editReply({ content: meldung }).catch(() => undefined);
  }
}

function lieferWert(interaction: ModalSubmitInteraction, feldId: string): string {
  try {
    return interaction.fields.getTextInputValue(feldId).trim();
  } catch {
    // Nicht ausgefuellte optionale Felder liefert Discord gar nicht mit.
    return '';
  }
}

/** Übernehmen und Schliessen aus dem Ticket-Kanal heraus. */
async function behandleTicketKnopf(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { discordChannelId: interaction.channelId },
    });
    if (!ticket) {
      await interaction.editReply({
        content: 'Zu diesem Kanal gibt es kein Ticket mehr in der Datenbank.',
      });
      return;
    }

    const actor = await buildCommandActor(interaction);
    // Dieselbe Zugriffspruefung wie im Dashboard - ein Knopf im Kanal ist
    // keine Berechtigung, und wer den Kanal sieht, darf nicht automatisch
    // alles darin.
    const zugriff = await tickets.getTicketAccess(alsBetrachter(actor), ticket);

    if (interaction.customId === tickets.TICKET_BUTTON.claim) {
      if (!zugriff.asStaff || !actor.can(tickets.TICKET_PERMISSIONS.supportClaim)) {
        await interaction.editReply({ content: NO_PERMISSION });
        return;
      }
      const gelungen = await tickets.claimTicket(ticket.id, {
        discordId: actor.discordId,
        username: actor.username,
        source: 'DISCORD',
      });
      await interaction.editReply({
        content: gelungen
          ? 'Du bearbeitest dieses Ticket.'
          : 'Dieses Ticket wurde soeben von jemand anderem übernommen.',
      });
      return;
    }

    if (!zugriff.close) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }
    await tickets.closeTicket(ticket.id, null, {
      discordId: actor.discordId,
      username: actor.username,
      source: 'DISCORD',
    });
    await interaction.editReply({ content: 'Ticket geschlossen.' });
  } catch (fehler) {
    const meldung =
      fehler instanceof AppError
        ? fehler.userMessage
        : 'Das hat gerade nicht funktioniert. Bitte später erneut versuchen.';
    if (!(fehler instanceof AppError)) {
      log.error('Ticket-Knopf konnte nicht verarbeitet werden', { fehler });
    }
    await interaction.editReply({ content: meldung }).catch(() => undefined);
  }
}

/**
 * Eine Bewertung aus dem Ticket-Kanal.
 *
 * Wer bewerten darf, entscheidet der Service anhand des Erstellers - der
 * Kanal ist fuer alle Beteiligten sichtbar, und ein Klick darin sagt nichts
 * darueber aus, wessen Ticket es ist.
 */
async function behandleBewertung(interaction: ButtonInteraction, sterne: number): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { discordChannelId: interaction.channelId },
      select: { id: true },
    });
    if (!ticket) {
      await interaction.editReply({ content: 'Zu diesem Kanal gibt es kein Ticket mehr.' });
      return;
    }

    await tickets.recordFeedback({
      ticketId: ticket.id,
      discordId: interaction.user.id,
      rating: sterne,
    });
    await interaction.editReply({ content: 'Danke für die Rückmeldung.' });
  } catch (fehler) {
    const meldung =
      fehler instanceof AppError
        ? fehler.userMessage
        : 'Die Bewertung liess sich nicht speichern. Bitte später erneut versuchen.';
    if (!(fehler instanceof AppError)) {
      log.error('Bewertung konnte nicht gespeichert werden', { fehler });
    }
    await interaction.editReply({ content: meldung }).catch(() => undefined);
  }
}

function alsBetrachter(actor: CommandActor): tickets.TicketViewer {
  return {
    discordId: actor.discordId,
    roleIds: actor.roleIds,
    can: (permission: string) => actor.can(permission),
  };
}
