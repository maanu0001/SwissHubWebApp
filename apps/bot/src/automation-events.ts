import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { automation } from '@swisshub/modules';

const log = createLogger('bot:automation');

/**
 * Discord-Ereignisse für die Automation Engine.
 *
 * Was auf Discord geschieht - jemand tritt bei, bekommt eine Rolle, betritt
 * einen Sprachkanal -, erfährt nur der Bot: er hält die Gateway-Verbindung.
 * Diese Datei ist die Stelle, an der daraus ein Ereignis in der Datenbank
 * wird, auf das eine Automation zeigen kann.
 *
 * Drei Regeln, und sie gelten für jeden Zuhörer hier:
 *
 * 1. **Nichts darf den Bot anhalten.** `meldeEreignis` wirft nie; trotzdem
 *    steht jeder Aufruf in einem Fang. Ein misslungenes Ereignis darf keine
 *    andere Verarbeitung verschlucken.
 * 2. **Nur die aktive Gilde.** Steht der Bot auf mehreren Servern, ist genau
 *    einer der verbundene. Alles andere zu melden hiesse, Automationen auf
 *    fremde Server reagieren zu lassen.
 * 3. **Bots melden, nicht ausschliessen.** Ob ein Bot-Beitritt interessiert,
 *    entscheidet die Bedingung in der Automation - nicht diese Datei. Wer
 *    hier filtert, nimmt eine Entscheidung vorweg, die dem Server gehört.
 */
export function registerAutomationEvents(client: Client, guildIdAktiv: (candidate: string) => boolean): void {
  const sicher = (was: string, arbeit: () => Promise<void>): void => {
    void arbeit().catch((error: unknown) => {
      log.warn('Automations-Ereignis nicht gemeldet', { was, error });
    });
  };

  // --- Mitglieder -----------------------------------------------------------

  client.on(Events.GuildMemberAdd, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    sicher('Beitritt', async () => {
      const alterTage = Math.floor((Date.now() - member.user.createdAt.getTime()) / (24 * 3600_000));
      await automation.meldeEreignis(
        'member.joined',
        {
          discordId: member.id,
          username: member.user.username,
          displayName: member.displayName,
          kontoAlterTage: Number.isFinite(alterTage) ? alterTage : null,
          istBot: member.user.bot,
        },
        { guildId: member.guild.id, subjectId: member.id },
      );
    });
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    sicher('Austritt', async () => {
      await automation.meldeEreignis(
        'member.left',
        {
          discordId: member.id,
          username: member.user.username,
          displayName: member.displayName ?? member.user.username,
        },
        { guildId: member.guild.id, subjectId: member.id },
      );
    });
  });

  /**
   * Rollen.
   *
   * Discord meldet keine einzelne Rollenänderung, sondern den Zustand davor
   * und danach. Der Unterschied ist die Änderung - und bei einem
   * Massen-Update sind es mehrere auf einmal.
   */
  client.on(Events.GuildMemberUpdate, (vorher: GuildMember | PartialGuildMember, nachher) => {
    if (!guildIdAktiv(nachher.guild.id)) {
      return;
    }
    const alt = new Set(vorher.roles?.cache.keys() ?? []);
    const neu = new Set(nachher.roles.cache.keys());

    const dazu = [...neu].filter((id) => !alt.has(id));
    const weg = [...alt].filter((id) => !neu.has(id));
    if (dazu.length === 0 && weg.length === 0) {
      return;
    }

    sicher('Rollenänderung', async () => {
      for (const roleId of dazu) {
        await automation.meldeEreignis(
          'member.role_added',
          {
            discordId: nachher.id,
            displayName: nachher.displayName,
            roleId,
            roleName: nachher.guild.roles.cache.get(roleId)?.name ?? 'Unbekannt',
          },
          { guildId: nachher.guild.id, subjectId: nachher.id },
        );
      }
      for (const roleId of weg) {
        await automation.meldeEreignis(
          'member.role_removed',
          {
            discordId: nachher.id,
            displayName: nachher.displayName,
            roleId,
            roleName: vorher.guild.roles.cache.get(roleId)?.name ?? 'Unbekannt',
          },
          { guildId: nachher.guild.id, subjectId: nachher.id },
        );
      }
    });
  });

  // --- Sprachkanäle ---------------------------------------------------------

  client.on(Events.VoiceStateUpdate, (vorher, nachher) => {
    const guild = nachher.guild ?? vorher.guild;
    if (!guild || !guildIdAktiv(guild.id)) {
      return;
    }
    // Ein Wechsel ist beides: verlassen und betreten. Beide Ereignisse zu
    // melden ist richtig - eine Automation auf «betritt Kanal X» soll auch
    // dann greifen, wenn jemand aus Kanal Y herüberwechselt.
    const verlassen = vorher.channelId && vorher.channelId !== nachher.channelId ? vorher : null;
    const betreten = nachher.channelId && vorher.channelId !== nachher.channelId ? nachher : null;
    if (!verlassen && !betreten) {
      return;
    }

    sicher('Sprachkanal', async () => {
      if (verlassen?.channelId) {
        await automation.meldeEreignis(
          'voice.left',
          {
            discordId: verlassen.id,
            displayName: verlassen.member?.displayName ?? verlassen.id,
            channelId: verlassen.channelId,
            channelName: verlassen.channel?.name ?? 'Unbekannt',
          },
          { guildId: guild.id, subjectId: verlassen.id },
        );
      }
      if (betreten?.channelId) {
        await automation.meldeEreignis(
          'voice.joined',
          {
            discordId: betreten.id,
            displayName: betreten.member?.displayName ?? betreten.id,
            channelId: betreten.channelId,
            channelName: betreten.channel?.name ?? 'Unbekannt',
          },
          { guildId: guild.id, subjectId: betreten.id },
        );
      }
    });
  });
}
