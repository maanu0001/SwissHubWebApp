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
import { tournaments } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION, type CommandActor } from './commands/context';

const log = createLogger('bot:tournaments');

/** Kennung des Resultat-Modals; die Matchkennung haengt hinten dran. */
const MODAL_PREFIX = 'tournaments:result:';
const FELD_A = 'score-a';
const FELD_B = 'score-b';
const FELD_KOMMENTAR = 'kommentar';

/**
 * Die Discord-Seite des Turniermoduls.
 *
 * Alles laeuft ueber dieselben Dienste wie das Dashboard: `checkIn`,
 * `reportResult`, `setReady`. Es gibt hier keine zweite Berechtigungslogik
 * und keinen zweiten Weg, ein Resultat zu melden - genau das waere der Punkt,
 * an dem Discord und Dashboard auseinanderliefen und ein Team je nach Weg als
 * eingecheckt gilt oder nicht.
 */
export function registerTournamentInteractions(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId.startsWith(tournaments.TOURNAMENT_BUTTON.checkinPrefix)) {
        void behandleCheckin(
          interaction,
          customId.slice(tournaments.TOURNAMENT_BUTTON.checkinPrefix.length),
        );
        return;
      }
      if (customId === tournaments.TOURNAMENT_BUTTON.ready) {
        void behandleBereit(interaction);
        return;
      }
      if (customId === tournaments.TOURNAMENT_BUTTON.report) {
        void zeigeResultatFormular(interaction);
        return;
      }
      if (customId === tournaments.TOURNAMENT_BUTTON.callAdmin) {
        void rufeAdmin(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_PREFIX)) {
      void meldeResultat(interaction, interaction.customId.slice(MODAL_PREFIX.length));
    }
  });
}

// --- Check-in --------------------------------------------------------------

async function behandleCheckin(
  interaction: ButtonInteraction,
  tournamentId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const actor = await buildCommandActor(interaction);
    if (!actor.can(tournaments.TOURNAMENT_PERMISSIONS.participate)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    const ergebnis = await tournaments.checkIn(tournamentId, actor.discordId, {
      discordId: actor.discordId,
      username: actor.username,
      source: 'DISCORD',
    });
    await interaction.editReply({ content: ergebnis.message });
  } catch (fehler) {
    await meldeFehler(interaction, fehler, 'Der Check-in hat gerade nicht funktioniert.');
  }
}

// --- Match-Knoepfe ---------------------------------------------------------

/**
 * Das Match zu diesem Kanal - samt der Seite, fuer die der Klickende spricht.
 *
 * Ein Knopf im Kanal ist keine Berechtigung: wer den Kanal sieht, darf
 * deswegen noch lange kein Resultat melden. Die Seite bestimmt der Server aus
 * der Teamzugehoerigkeit, nie der Browser oder der Klick.
 */
async function ladeMatchUndSeite(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  matchId?: string,
): Promise<{ match: Awaited<ReturnType<typeof tournaments.getMatch>>; slot: 'A' | 'B' | null; actor: CommandActor }> {
  const match = matchId
    ? await tournaments.getMatch(matchId)
    : await (async () => {
        const gefunden = await prisma.tournamentMatch.findUnique({
          where: { discordChannelId: interaction.channelId ?? '' },
          select: { id: true },
        });
        return gefunden ? tournaments.getMatch(gefunden.id) : null;
      })();

  if (!match) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Zu diesem Kanal gibt es kein Match mehr in der Datenbank.',
    });
  }

  const actor = await buildCommandActor(interaction);
  const slot = await tournaments.getMatchSlot(match.id, actor.discordId);

  return { match, slot, actor };
}

async function behandleBereit(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const { match, slot } = await ladeMatchUndSeite(interaction);
    if (!match) {
      return;
    }
    if (!slot) {
      await interaction.editReply({
        content: 'Nur die Captains der beiden Teams können sich bereit melden.',
      });
      return;
    }

    const aktualisiert = await tournaments.setReady(match.id, slot, true);
    await interaction.editReply({
      content:
        aktualisiert.readyA && aktualisiert.readyB
          ? 'Beide Seiten sind bereit - das Match läuft.'
          : 'Bereit gemeldet. Wir warten noch auf die Gegenseite.',
    });

    if (aktualisiert.readyA && aktualisiert.readyB) {
      await tournaments.matchMeldung(match.id, '✅ Beide Teams sind bereit. Viel Erfolg!');
    }
  } catch (fehler) {
    await meldeFehler(interaction, fehler, 'Das hat gerade nicht funktioniert.');
  }
}

/**
 * Das Resultatformular oeffnen.
 *
 * Bewusst ein Modal und keine Knopfreihe: bei Best of 3 gibt es zu viele
 * moegliche Resultate fuer Knoepfe, und ein falsch gedruecktes Resultat
 * loest einen Einspruch aus.
 */
async function zeigeResultatFormular(interaction: ButtonInteraction): Promise<void> {
  try {
    const { match, slot } = await ladeMatchUndSeite(interaction);
    if (!match) {
      return;
    }
    if (!slot) {
      await interaction.reply({
        content: 'Nur die Captains der beiden Teams können ein Resultat melden.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (match.status === 'COMPLETED' || match.status === 'FORFEIT') {
      await interaction.reply({
        content: 'Für dieses Match steht das Resultat bereits fest.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nameA = teilnehmerName(match.participantA) ?? 'Team A';
    const nameB = teilnehmerName(match.participantB) ?? 'Team B';

    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${match.id}`)
      .setTitle(`Match #${match.matchNumber} · Resultat`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(FELD_A)
            .setLabel(nameA.slice(0, 45))
            .setStyle(TextInputStyle.Short)
            .setMaxLength(2)
            .setRequired(true)
            .setPlaceholder('Gewonnene Maps'),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(FELD_B)
            .setLabel(nameB.slice(0, 45))
            .setStyle(TextInputStyle.Short)
            .setMaxLength(2)
            .setRequired(true)
            .setPlaceholder('Gewonnene Maps'),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(FELD_KOMMENTAR)
            .setLabel('Anmerkung')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(false)
            .setPlaceholder('Freiwillig - etwa ein Link zum Screenshot.'),
        ),
      );

    await interaction.showModal(modal);
  } catch (fehler) {
    const meldung =
      fehler instanceof AppError
        ? fehler.userMessage
        : 'Das Formular liess sich nicht öffnen. Bitte später erneut versuchen.';
    if (!(fehler instanceof AppError)) {
      log.error('Resultatformular konnte nicht geöffnet werden', { fehler });
    }
    await interaction
      .reply({ content: meldung, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }
}

async function meldeResultat(
  interaction: ModalSubmitInteraction,
  matchId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const { match, slot, actor } = await ladeMatchUndSeite(interaction, matchId);
    if (!match) {
      return;
    }
    if (!slot) {
      await interaction.editReply({
        content: 'Nur die Captains der beiden Teams können ein Resultat melden.',
      });
      return;
    }

    const scoreA = Number.parseInt(interaction.fields.getTextInputValue(FELD_A).trim(), 10);
    const scoreB = Number.parseInt(interaction.fields.getTextInputValue(FELD_B).trim(), 10);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
      await interaction.editReply({ content: 'Bitte zwei Zahlen eintragen.' });
      return;
    }

    const kommentar = lieferWert(interaction, FELD_KOMMENTAR);

    const ergebnis = await tournaments.reportResult(
      {
        matchId: match.id,
        slot,
        reportedByDiscordId: actor.discordId,
        reportedByUsername: actor.username,
        scoreA,
        scoreB,
        ...(kommentar.length > 0 ? { comment: kommentar } : {}),
      },
      { discordId: actor.discordId, username: actor.username, source: 'DISCORD' },
    );

    if (ergebnis.bestaetigt) {
      await interaction.editReply({ content: 'Resultat bestätigt - beide Seiten sind sich einig.' });
      await tournaments.matchMeldung(
        match.id,
        `📊 Resultat steht fest: **${scoreA}:${scoreB}**.`,
      );
      return;
    }
    if (ergebnis.strittig) {
      await interaction.editReply({
        content:
          'Deine Meldung weicht von der Gegenseite ab. Das Match ist jetzt strittig - die Turnierleitung entscheidet.',
      });
      await tournaments.matchMeldung(
        match.id,
        '⚠️ Die beiden Meldungen widersprechen sich. Die Turnierleitung schaut sich das an.',
      );
      return;
    }

    await interaction.editReply({
      content: 'Resultat gemeldet. Es gilt, sobald die Gegenseite es bestätigt.',
    });
    await tournaments.matchMeldung(
      match.id,
      `📊 **${actor.username}** meldet **${scoreA}:${scoreB}**. Die Gegenseite bestätigt über «Resultat melden».`,
    );
  } catch (fehler) {
    await meldeFehler(interaction, fehler, 'Das Resultat liess sich nicht speichern.');
  }
}

/**
 * Die Turnierleitung rufen.
 *
 * Bewusst kein eigener Kanal und kein Ticket: die Leitung liest im
 * Match-Kanal mit, und ein zweiter Ort fuer dasselbe Gespraech hilft
 * niemandem.
 */
async function rufeAdmin(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  try {
    const { match, actor } = await ladeMatchUndSeite(interaction);
    if (!match) {
      return;
    }

    const leitung = await prisma.tournamentStaff.findMany({
      where: {
        tournamentId: match.tournamentId,
        role: { in: ['OWNER', 'ADMIN', 'REFEREE'] },
      },
      select: { discordId: true },
    });

    const erwaehnungen = leitung
      .map((eintrag) => eintrag.discordId)
      .filter((id) => id !== 'system');

    await tournaments.matchMeldungMitErwaehnung(
      match.id,
      `🚨 **${actor.username}** bittet die Turnierleitung um Hilfe.`,
      erwaehnungen,
    );

    await interaction.editReply({
      content:
        erwaehnungen.length > 0
          ? 'Die Turnierleitung ist benachrichtigt.'
          : 'Gemeldet. Für dieses Turnier ist allerdings niemand als Leitung eingetragen.',
    });
  } catch (fehler) {
    await meldeFehler(interaction, fehler, 'Die Meldung ist nicht durchgekommen.');
  }
}

// --- Hilfen ----------------------------------------------------------------

function teilnehmerName(
  teilnehmer: { username: string | null; team: { name: string } | null } | null | undefined,
): string | null {
  if (!teilnehmer) {
    return null;
  }
  return teilnehmer.team?.name ?? teilnehmer.username;
}

function lieferWert(interaction: ModalSubmitInteraction, feldId: string): string {
  try {
    return interaction.fields.getTextInputValue(feldId).trim();
  } catch {
    // Nicht ausgefuellte optionale Felder liefert Discord gar nicht mit.
    return '';
  }
}

async function meldeFehler(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  fehler: unknown,
  ersatz: string,
): Promise<void> {
  const meldung = fehler instanceof AppError ? fehler.userMessage : ersatz;
  if (!(fehler instanceof AppError)) {
    log.error('Turnier-Interaktion fehlgeschlagen', { fehler });
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: meldung }).catch(() => undefined);
  } else {
    await interaction
      .reply({ content: meldung, flags: MessageFlags.Ephemeral })
      .catch(() => undefined);
  }
}
