import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { moderation } from '@swisshub/modules';

const log = createLogger('bot:moderation');

/**
 * Massnahmen erkennen, die nicht ueber SwissHub liefen.
 *
 * Bannt jemand direkt in der Discord-App, erfaehrt SwissHub davon nur ueber
 * das Gateway. Diese Datei hoert zu; entschieden wird nichts hier, sondern in
 * `moderation.erfasseExterneMassnahme` - hier steht ausschliesslich, welches
 * Discord-Ereignis welchem Vorgang entspricht.
 *
 * ## Warum eigene Handler und nicht die der Analytics
 *
 * Weil die Akte nicht davon abhaengen darf, ob das Analytics-Modul
 * eingeschaltet ist. `recordEvent` gibt bei abgeschaltetem Modul `null`
 * zurueck - die Statistik verzichtet dann auf einen Eintrag, was in Ordnung
 * ist. Die Moderationsakte darf aber nicht luecken haben, weil jemand eine
 * Statistik abgeschaltet hat.
 *
 * Beide hoeren deshalb auf dieselben Ereignisse und beantworten verschiedene
 * Fragen: die Statistik zaehlt, die Akte haelt fest.
 *
 * ## Nichts hier darf den Bot anhalten
 *
 * Jeder Aufruf ist gefangen. Faellt Discords Audit-Schnittstelle aus oder
 * fehlt dem Bot das Recht, sie zu lesen, bleibt die Massnahme unerkannt -
 * das ist bedauerlich und wird gemeldet, aber es ist kein Grund, den Bot
 * abzuschiessen.
 */
export function registerModerationEvents(client: Client, guildIdAktiv: (candidate: string) => boolean): void {
  const sicher = (was: string, arbeit: () => Promise<unknown>): void => {
    void arbeit().catch((error: unknown) => log.warn(`${was} konnte nicht erfasst werden`, { error }));
  };

  /** Die eigene Kennung - ohne sie liesse sich SwissHub nicht von fremd unterscheiden. */
  const eigeneBotId = (): string | null => client.user?.id ?? null;

  const melde = (ergebnis: Awaited<ReturnType<typeof moderation.erfasseExterneMassnahme>>): void => {
    if (ergebnis.ergebnis === 'erfasst') {
      log.info('Massnahme aus Discord erfasst', {
        id: ergebnis.massnahme.id,
        art: ergebnis.massnahme.type,
      });
    }
  };

  // --- Bann ----------------------------------------------------------------

  client.on(Events.GuildBanAdd, (bann) => {
    if (!guildIdAktiv(bann.guild.id)) {
      return;
    }
    sicher('Bann', async () => {
      melde(
        await moderation.erfasseExterneMassnahme({
          vorgang: { art: 'BAN' },
          targetDiscordId: bann.user.id,
          targetUsername: bann.user.username,
          occurredAt: new Date(),
          eigeneBotId: eigeneBotId(),
        }),
      );
    });
  });

  client.on(Events.GuildBanRemove, (bann) => {
    if (!guildIdAktiv(bann.guild.id)) {
      return;
    }
    sicher('Bannaufhebung', async () => {
      melde(
        await moderation.erfasseExterneMassnahme({
          vorgang: { art: 'UNBAN' },
          targetDiscordId: bann.user.id,
          targetUsername: bann.user.username,
          occurredAt: new Date(),
          eigeneBotId: eigeneBotId(),
        }),
      );
    });
  });

  // --- Austritt: Kick oder freiwillig? -------------------------------------

  /**
   * Discord sendet dasselbe Ereignis, ob jemand gegangen oder entfernt wurde.
   *
   * Deshalb wird hier nichts entschieden. Der Dienst sucht den
   * Kick-Audit-Eintrag; findet er keinen, entsteht kein Eintrag. Ein
   * freiwilliger Austritt, der als Kick in einer Akte landet, waere eine
   * Behauptung ueber einen Menschen, die niemand mehr geradebiegt.
   */
  client.on(Events.GuildMemberRemove, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    sicher('Austritt', async () => {
      melde(
        await moderation.erfasseExterneMassnahme({
          vorgang: { art: 'KICK' },
          targetDiscordId: member.id,
          targetUsername: member.user.username,
          occurredAt: new Date(),
          eigeneBotId: eigeneBotId(),
        }),
      );
    });
  });

  // --- Timeout -------------------------------------------------------------

  /**
   * `guildMemberUpdate` kommt bei jeder Aenderung am Mitglied.
   *
   * Rollen, Spitzname, Avatar - alles loest dasselbe Ereignis aus. Erfasst
   * wird nur, wenn sich tatsaechlich `communicationDisabledUntil` geaendert
   * hat; alles andere ist keine Moderationsmassnahme und darf nicht als eine
   * erscheinen.
   */
  client.on(Events.GuildMemberUpdate, (alt: GuildMember | PartialGuildMember, neu: GuildMember) => {
    if (!guildIdAktiv(neu.guild.id)) {
      return;
    }

    const vorher = alt.communicationDisabledUntilTimestamp;
    const nachher = neu.communicationDisabledUntilTimestamp;
    if (vorher === nachher) {
      return;
    }

    const vorgang = moderation.ordneTimeoutEin(
      vorher ? new Date(vorher) : null,
      nachher ? new Date(nachher) : null,
    );
    if (!vorgang) {
      return;
    }

    sicher('Timeout', async () => {
      melde(
        await moderation.erfasseExterneMassnahme({
          vorgang,
          targetDiscordId: neu.id,
          targetUsername: neu.user.username,
          occurredAt: new Date(),
          eigeneBotId: eigeneBotId(),
        }),
      );
    });
  });
}
