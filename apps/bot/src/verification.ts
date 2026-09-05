import {
  ActionRowBuilder,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { bootstrapConfig } from '@swisshub/config';
import { hasPermission, loadRoleConfiguration, resolvePermissions } from '@swisshub/permissions';
import { isModuleEnabled, verification } from '@swisshub/modules';

const log = createLogger('bot:verification');

/**
 * Die Verifikation auf Discord.
 *
 * Drei Ereignisse: jemand tritt bei, jemand schreibt, jemand drueckt einen
 * Knopf. Alles Weitere entscheidet der Dienst - dieser Teil uebersetzt nur
 * zwischen Discord und dem Modul.
 *
 * Der Knopf ist die heikle Stelle. Seine Kennung sagt, worum es geht, aber
 * sie beweist nichts: sie steht im Klartext in der Nachricht und laesst sich
 * nachbauen. Deshalb wird beim Klick alles erneut geprueft - Server,
 * Handelnder, Berechtigung, Zustand des Vorgangs -, und zwar gegen die
 * Datenbank, nicht gegen den Inhalt des Knopfes.
 */

/** Berechtigungen des Klickenden - aus seinen echten Discord-Rollen. */
async function actorFuer(interaction: ButtonInteraction | ModalSubmitInteraction) {
  const roleIds =
    interaction.member && 'roles' in interaction.member && 'cache' in interaction.member.roles
      ? [...interaction.member.roles.cache.keys()]
      : [];

  const configuration = await loadRoleConfiguration();
  const resolution = resolvePermissions(
    {
      discordId: interaction.user.id,
      roleIds,
      isOwner: bootstrapConfig.ownerDiscordId === interaction.user.id,
    },
    configuration.mappings,
  );

  return {
    discordId: interaction.user.id,
    username: interaction.user.username,
    roleIds,
    isOwner: bootstrapConfig.ownerDiscordId === interaction.user.id,
    can: (permission: string) => hasPermission(resolution, permission),
    // Steht spaeter in der Meldung und in der Pruefspur. Entschieden wird
    // deswegen nicht anders - es ist derselbe Dienst wie im Dashboard.
    source: 'DISCORD' as const,
  };
}

export function registerVerification(client: Client): void {
  // --- Beitritt ----------------------------------------------------------
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) {
      return;
    }
    try {
      if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
        return;
      }
      const settings = await verification.verificationSettings();
      if (!settings.unverifiedRoleId || !settings.verificationChannelId) {
        log.warn('Verifikation ist unvollständig eingerichtet - Beitritt bleibt unbehandelt', {
          member: member.id,
        });
        return;
      }

      // Wer schon einmal geprueft wurde, muss nicht erneut antreten - sofern
      // das so eingestellt ist. Ein Bann greift ohnehin frueher: Discord
      // laesst die Person gar nicht erst herein.
      if (settings.trustReturningMembers) {
        const frueher = await verification.frueherVerifiziert(member.guild.id, member.id);
        if (frueher) {
          if (settings.memberRoleId) {
            await member.roles.add(settings.memberRoleId, 'Bereits früher verifiziert').catch(
              (error: unknown) =>
                log.warn('Mitgliederrolle beim Wiedereintritt nicht vergeben', {
                  member: member.id,
                  error,
                }),
            );
          }
          log.info('Wiedereintritt eines bereits verifizierten Mitglieds', { member: member.id });
          return;
        }
      }

      const request = await verification.startVerification({
        discordId: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatarHash: member.user.avatar,
        accountCreatedAt: member.user.createdAt,
        joinedAt: member.joinedAt ?? new Date(),
      });

      // Erst die Rolle, dann die Begruessung: waere es umgekehrt, saehe die
      // Person eine Aufforderung in einem Kanal, den sie gleich nicht mehr
      // sieht - oder schlimmer, sie stuende ohne Rolle im ganzen Server.
      try {
        await member.roles.add(settings.unverifiedRoleId, 'Verifikation ausstehend');
      } catch (error) {
        // Nicht stillschweigend freilassen. Der Vorgang wird als Fehler
        // gefuehrt und die Moderation erfaehrt davon - die Person bleibt
        // sonst unbemerkt mit vollem Zugriff im Server.
        log.error('Unverifiziert-Rolle konnte nicht vergeben werden', { member: member.id, error });
        await verification.entscheide(request.id, {
          status: 'ERROR',
          by: 'SYSTEM',
          reason:
            'Die Rolle «Noch nicht verifiziert» konnte nicht vergeben werden. Bitte die Rollenhierarchie prüfen.',
        });
        await verification.pushModNotice(request.id, settings, { erwaehnen: true });
        return;
      }

      await verification.sendGreeting(request, settings);
      log.info('Verifikation gestartet', { requestId: request.id, member: member.id });
    } catch (error) {
      log.error('Beitritt konnte nicht behandelt werden', { error, member: member.id });
    }
  });

  // --- Austritt ----------------------------------------------------------
  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
        return;
      }
      const geschlossen = await verification.markLeft(member.guild.id, member.id);
      if (geschlossen) {
        const settings = await verification.verificationSettings();
        await verification.pushModNotice(geschlossen.id, settings);
        log.info('Verifikation beim Austritt geschlossen', { requestId: geschlossen.id });
      }
    } catch (error) {
      log.error('Austritt konnte nicht behandelt werden', { error, member: member.id });
    }
  });

  // --- Nachricht ---------------------------------------------------------
  client.on(Events.MessageCreate, (nachricht) => {
    if (nachricht.author.bot || !nachricht.guild) {
      return;
    }
    void (async () => {
      try {
        if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
          return;
        }
        const settings = await verification.verificationSettings();
        if (nachricht.channelId !== settings.verificationChannelId) {
          return;
        }
        // Der Absender ist die einzige Quelle. Erwaehnungen, Antworten und
        // Kennungen im Text spielen keine Rolle - so laesst sich ueber diesen
        // Weg kein fremder Vorgang bewegen.
        const ergebnis = await verification.recordMessage({
          discordId: nachricht.author.id,
          messageId: nachricht.id,
          content: nachricht.content,
          createdAt: nachricht.createdAt,
        });
        if (!ergebnis || ergebnis.doppelt) {
          return;
        }

        // Die Moderation wird nur beim ersten Mal geweckt. Wer nachschiebt,
        // aktualisiert die bestehende Meldung.
        if (settings.notifyOnMessage) {
          await verification.pushModNotice(ergebnis.request.id, settings, {
            erwaehnen: ergebnis.erste,
          });
        }

        if (!ergebnis.erste || !settings.aiEnabled) {
          return;
        }

        const ai = await verification.aiPipeline(ergebnis.request.id);
        if (ai.freigeschaltet) {
          await verification.sendWelcome(ai.request, settings);
          await verification.writeLog(ai.request, settings);
        }
        // Ob freigeschaltet oder nicht: die Meldung wird nachgezogen, damit
        // die Moderation den Stand sieht.
        if (settings.notifyOnAiVerify || !ai.freigeschaltet) {
          await verification.pushModNotice(ergebnis.request.id, settings);
        }
      } catch (error) {
        log.error('Verifikationsnachricht konnte nicht behandelt werden', {
          error,
          author: nachricht.author.id,
        });
      }
    })();
  });

  // --- Knoepfe -----------------------------------------------------------
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const geparst = verification.parseButtonId(interaction.customId);
    if (!geparst) {
      return;
    }
    void behandleKnopf(interaction, geparst.art, geparst.requestId);
  });
}

async function behandleKnopf(
  interaction: ButtonInteraction,
  art: 'approve' | 'reject',
  requestId: string,
): Promise<void> {
  try {
    // Alles wird erneut geprueft - die Knopf-Kennung ist ein Hinweis, keine
    // Vollmacht.
    if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
      await interaction.reply({ content: 'Die Verifikation ist derzeit ausgeschaltet.', ephemeral: true });
      return;
    }

    const settings = await verification.verificationSettings();
    const request = await verification.getRequest(requestId);
    if (!request) {
      await interaction.reply({ content: 'Diesen Vorgang gibt es nicht.', ephemeral: true });
      return;
    }
    // Ein Knopf aus einem anderen Server bewegt hier nichts.
    if (!interaction.guildId || interaction.guildId !== request.guildId) {
      await interaction.reply({ content: 'Dieser Vorgang gehört zu einem anderen Server.', ephemeral: true });
      return;
    }
    if (request.decidedAt) {
      await interaction.reply({
        content: `Dieser Vorgang wurde bereits entschieden (${verification.statusLabel(request.status)}).`,
        ephemeral: true,
      });
      await verification.pushModNotice(requestId, settings);
      return;
    }

    const actor = await actorFuer(interaction);

    if (art === 'approve') {
      if (!actor.can(verification.VERIFICATION_PERMISSIONS.approve)) {
        await interaction.reply({ content: 'Dir fehlt die Berechtigung zum Freischalten.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const ergebnis = await verification.humanVerify(actor, requestId);
      await verification.pushModNotice(requestId, settings);
      if (ergebnis.gewonnen) {
        await verification.sendWelcome(ergebnis.request, settings);
        await verification.writeLog(ergebnis.request, settings);
      }
      await interaction.editReply({
        content: ergebnis.gewonnen
          ? ergebnis.rollenFehler
            ? `Freigeschaltet - aber: ${ergebnis.rollenFehler}`
            : 'Mitglied freigeschaltet.'
          : 'Dieser Vorgang war bereits entschieden.',
      });
      return;
    }

    // --- Ablehnen ---------------------------------------------------------
    //
    // Ein Bann ist nicht rueckgaengig zu machen, deshalb zwei Schritte: der
    // Knopf oeffnet die Auswahl des Grundes, erst deren Bestaetigung bannt.
    if (!actor.can(verification.VERIFICATION_PERMISSIONS.reject)) {
      await interaction.reply({
        content: 'Dir fehlt die Berechtigung zum Ablehnen. Ablehnen bedeutet einen Bann.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      content: [
        `**Möchtest du <@${request.discordId}> wirklich vom SwissHub Server bannen?**`,
        'Ein Bann lässt sich nicht mit einem Klick zurücknehmen. Wähle einen Grund - er steht später in der Akte.',
      ].join('\n'),
      ephemeral: true,
      allowedMentions: { parse: [] },
      components: [
        {
          type: 1,
          components: verification.ABLEHNUNGSGRUENDE.slice(0, 4).map((grund, index) => ({
            type: 2 as const,
            style: 4 as const,
            label: grund,
            custom_id: `verification:confirm:${index}:${requestId}`,
          })),
        },
        {
          type: 1,
          components: [
            {
              // Ein eigener Grund. Discord laesst ein Modal nur aus einer
              // noch unbeantworteten Interaktion oeffnen - der Knopf hier ist
              // genau das.
              type: 2 as const,
              style: 2 as const,
              label: 'Anderer Grund …',
              custom_id: `verification:reason:${requestId}`,
            },
            {
              type: 2 as const,
              style: 2 as const,
              label: 'Abbrechen',
              custom_id: `verification:cancel:${requestId}`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    log.error('Verifikations-Knopf fehlgeschlagen', { error, requestId, art });
    const meldung = 'Das hat nicht geklappt. Bitte im Dashboard prüfen.';
    if (interaction.deferred) {
      await interaction.editReply({ content: meldung }).catch(() => undefined);
    } else if (!interaction.replied) {
      await interaction.reply({ content: meldung, ephemeral: true }).catch(() => undefined);
    }
  }
}

const REASON_MODAL = 'verification:reasonModal:';

/**
 * Der zweite Schritt der Ablehnung.
 *
 * Ein Bann ist nicht mit einem Klick zurueckzunehmen, deshalb ist er auch
 * nicht mit einem Klick auszusprechen: der rote Knopf oeffnet nur eine
 * Rueckfrage, die nur der Klickende sieht. Erst was dort bestaetigt wird,
 * geht in den Moderationsdienst.
 *
 * Alle drei Wege - vorgegebener Grund, eigener Grund, Abbrechen - pruefen die
 * Berechtigung erneut. Zwischen dem ersten und dem zweiten Klick koennen
 * Minuten liegen, und in denen kann jemand eine Rolle verloren haben.
 */
export function registerRejectConfirmation(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isModalSubmit() && interaction.customId.startsWith(REASON_MODAL)) {
      const requestId = interaction.customId.slice(REASON_MODAL.length);
      const grund = interaction.fields.getTextInputValue('grund').trim();
      void fuehreAblehnungAus(interaction, requestId, grund || 'Verifikation abgelehnt');
      return;
    }

    if (!interaction.isButton()) {
      return;
    }

    if (interaction.customId.startsWith('verification:cancel:')) {
      void interaction
        .update({ content: 'Abgebrochen. Es wurde niemand gebannt.', components: [] })
        .catch(() => undefined);
      return;
    }

    if (interaction.customId.startsWith('verification:reason:')) {
      const requestId = interaction.customId.slice('verification:reason:'.length);
      void zeigeGrundModal(interaction, requestId).catch((error: unknown) =>
        log.error('Grund-Modal fehlgeschlagen', { error, requestId }),
      );
      return;
    }

    if (!interaction.customId.startsWith('verification:confirm:')) {
      return;
    }

    const teile = interaction.customId.split(':');
    const grund = verification.ABLEHNUNGSGRUENDE[Number(teile[2])];
    const requestId = teile.slice(3).join(':');
    if (!grund || !requestId) {
      return;
    }
    void fuehreAblehnungAus(interaction, requestId, grund);
  });
}

/** Freitext als Grund - Discords Modal, ein Feld, nichts weiter. */
async function zeigeGrundModal(interaction: ButtonInteraction, requestId: string): Promise<void> {
  const actor = await actorFuer(interaction);
  if (!actor.can(verification.VERIFICATION_PERMISSIONS.reject)) {
    await interaction.update({ content: 'Dir fehlt die Berechtigung zum Ablehnen.', components: [] });
    return;
  }

  const eingabe = new TextInputBuilder()
    .setCustomId('grund')
    .setLabel('Grund für den Bann')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(300)
    .setRequired(true)
    .setPlaceholder('Steht später in der Akte und im Ban-Log.');

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(REASON_MODAL + requestId)
      .setTitle('Ablehnen und bannen')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(eingabe)),
  );
}

/**
 * Die Ablehnung ausfuehren.
 *
 * Eine Stelle fuer beide Wege: `humanReject` bannt ueber den zentralen
 * Moderationsdienst, mit dessen Policy, Akte und Protokoll. Hier steht kein
 * `guild.members.ban` - und soll auch keines stehen.
 */
async function fuehreAblehnungAus(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  requestId: string,
  grund: string,
): Promise<void> {
  try {
    const actor = await actorFuer(interaction);
    if (!actor.can(verification.VERIFICATION_PERMISSIONS.reject)) {
      await antworteStill(interaction, 'Dir fehlt die Berechtigung zum Ablehnen.');
      return;
    }

    await interaction.deferUpdate();
    const settings = await verification.verificationSettings();
    const ergebnis = await verification.humanReject(actor, requestId, grund);
    await verification.pushModNotice(requestId, settings);
    if (ergebnis.gewonnen && settings.notifyOnReject) {
      await verification.writeLog(ergebnis.request, settings);
    }
    await interaction.editReply({
      content: ergebnis.gewonnen
        ? ergebnis.rollenFehler
          ? `Abgelehnt - aber: ${ergebnis.rollenFehler}`
          : `Abgelehnt und gebannt (${grund}).`
        : 'Dieser Fall wurde bereits bearbeitet.',
      components: [],
    });
  } catch (error) {
    log.error('Ablehnung fehlgeschlagen', { error, requestId });
    await interaction
      .editReply({ content: 'Das hat nicht geklappt.', components: [] })
      .catch(() => undefined);
  }
}

/** Eine Antwort, die nur der Klickende sieht - egal ob Knopf oder Modal. */
async function antworteStill(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  text: string,
): Promise<void> {
  if (interaction.isButton()) {
    await interaction.update({ content: text, components: [] }).catch(() => undefined);
    return;
  }
  await interaction.reply({ content: text, ephemeral: true }).catch(() => undefined);
}
