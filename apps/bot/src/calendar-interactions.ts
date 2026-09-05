import { Events, MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { calendar, isModuleEnabled } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './commands/context';

const log = createLogger('bot:calendar');

/**
 * Anmelden und abmelden direkt unter der Ankündigung.
 *
 * Bisher führte der einzige Weg über die Webseite. Das ist genau ein Schritt
 * zu viel: die Ankündigung steht im Kanal, gelesen wird sie dort, und wer
 * dafür den Server verlassen soll, meldet sich am Ende gar nicht an.
 *
 * Gerechnet wird nichts hier. Beide Knöpfe rufen dieselben Funktionen auf wie
 * das Dashboard - Platzzahl, Warteliste und Fristen entscheidet die
 * Anmeldelogik, und zwar an genau einer Stelle. Ein zweiter Satz Regeln für
 * den Discord-Weg wäre der sichere Weg zu zwei verschiedenen Wartelisten.
 *
 * Antworten sind immer nur für die klickende Person sichtbar: wer sich
 * anmeldet, teilt das dem Kanal nicht zwangsläufig mit, und eine abgelehnte
 * Anmeldung schon gar nicht.
 */
export function registerCalendarInteractions(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const knopf = calendar.parseCalendarButtonId(interaction.customId);
    if (knopf) {
      void handleButton(interaction, knopf.eventId, knopf.aktion);
    }
  });
}

async function handleButton(
  interaction: ButtonInteraction,
  eventId: string,
  aktion: 'JOIN' | 'LEAVE',
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!(await isModuleEnabled(calendar.CALENDAR_MODULE_ID))) {
      await interaction.editReply({ content: 'De Kalender isch grad usgschaltet.' });
      return;
    }

    const actor = await buildCommandActor(interaction);
    if (!actor.can(calendar.CALENDAR_PERMISSIONS.participate)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    // Der Termin wird frisch gelesen. Das Embed im Kanal kann Tage alt sein -
    // ihm ist über den heutigen Stand nichts zu entnehmen.
    const event = await calendar.getEvent(eventId);
    if (!event) {
      await interaction.editReply({ content: 'De Termin git s nüme.' });
      return;
    }

    const text = aktion === 'JOIN' ? await melde(interaction, event) : await entmelde(interaction, event);
    await interaction.editReply({ content: text });

    // Die Ankündigung nachziehen, damit die Platzzahl im Kanal stimmt. Der
    // Aufruf sammelt: bei einem Ansturm wird einmal geschrieben, nicht
    // hundertmal.
    await calendar
      .scheduleRefresh(eventId)
      .catch((error: unknown) =>
        log.warn('Ankündigung konnte nach Anmeldung nicht aktualisiert werden', { eventId, error }),
      );
  } catch (error) {
    // Eine AppError trägt einen Text, der für die Person gedacht ist -
    // «Ausgebucht» oder «Frist abgelaufen». Alles andere ist ein Fehler von
    // uns und wird nicht im Wortlaut weitergereicht.
    const meldung =
      error instanceof AppError ? error.userMessage : 'Das het nid klappet. Bitte probier s über d Website.';
    if (!(error instanceof AppError)) {
      log.error('Kalender-Knopf fehlgeschlagen', { error, eventId, aktion });
    }
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: meldung }).catch(() => undefined);
    }
  }
}

async function melde(
  interaction: ButtonInteraction,
  event: Awaited<ReturnType<typeof calendar.requireEvent>>,
): Promise<string> {
  const ergebnis = await calendar.register(
    {
      discordId: interaction.user.id,
      username: interaction.user.username,
      displayName:
        interaction.member && 'displayName' in interaction.member ? interaction.member.displayName : null,
    },
    event.id,
  );

  if (ergebnis.registration.status === 'WAITLIST') {
    return [
      `Du bisch uf de Warteliste für **${event.title}** - Platz ${ergebnis.registration.waitlistPosition ?? '?'}.`,
      'Wenn öpper absprigt, rutschsch automatisch nah.',
      calendar.eventUrl(event),
    ].join('\n');
  }

  return [`Du bisch debii bi **${event.title}**.`, calendar.eventUrl(event)].join('\n');
}

async function entmelde(
  interaction: ButtonInteraction,
  event: Awaited<ReturnType<typeof calendar.requireEvent>>,
): Promise<string> {
  const ergebnis = await calendar.unregister(interaction.user.id, event.id);
  return ergebnis.nachgerueckt
    ? `Du bisch abgmeldet vo **${event.title}**. Din Platz isch a die erst Person uf de Warteliste gange.`
    : `Du bisch abgmeldet vo **${event.title}**.`;
}
