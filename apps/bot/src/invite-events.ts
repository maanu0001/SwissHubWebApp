import { Events, type Client, type Invite } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { invites } from '@swisshub/modules';

const log = createLogger('bot:invites');

/**
 * Der Einladungsspiegel, gepflegt am laufenden Server.
 *
 * Er hat genau einen Zweck: beim naechsten Beitritt eine Differenz bilden zu
 * koennen. Discord nennt die benutzte Einladung nie - man kennt nur die
 * Zaehler, und die muss man vorher gesehen haben.
 *
 * Drei Ereignisse halten ihn aktuell:
 *
 * - **Start** - der Bot holt einmal den ganzen Stand. Ohne diesen Lauf waere
 *   nach jedem Neustart der erste Beitritt nicht zuzuordnen: es gaebe keinen
 *   Vorher-Wert.
 * - **`inviteCreate`** - eine neue Einladung wird sofort aufgenommen. Sonst
 *   erschiene sie beim ersten Beitritt als «neu aufgetaucht» statt als
 *   «Zaehler gestiegen», und der Beitritt bliebe unbekannt.
 * - **`inviteDelete`** - eine geloeschte wird abgemeldet, damit sie nicht in
 *   jedem folgenden Vergleich als verschwunden gilt.
 *
 * Fehlt dem Bot `MANAGE_GUILD`, laeuft all das ins Leere - und genau das ist
 * in Ordnung. Der Beitritt selbst wird trotzdem protokolliert, nur ohne
 * Einladung. Ein fehlendes Beitrittslog waere der schlechtere Zustand: es
 * saehe aus wie ein Beitritt, der nicht stattgefunden hat.
 */
export function registerInviteEvents(client: Client, guildIdAktiv: (candidate: string) => boolean): void {
  const sicher = (was: string, arbeit: () => Promise<unknown>): void => {
    void arbeit().catch((error: unknown) => log.warn(`${was} fehlgeschlagen`, { error }));
  };

  const ausDiscord = (einladung: Invite) => ({
    code: einladung.code,
    channelId: einladung.channel?.id ?? null,
    channelName: einladung.channel && 'name' in einladung.channel ? einladung.channel.name : null,
    inviterDiscordId: einladung.inviter?.id ?? null,
    inviterUsername: einladung.inviter?.username ?? null,
    uses: einladung.uses ?? 0,
    maxUses: einladung.maxUses ?? 0,
    expiresAt: einladung.expiresAt ?? null,
    createdAt: einladung.createdAt ?? null,
  });

  client.on(Events.InviteCreate, (einladung) => {
    const guildId = einladung.guild?.id;
    if (!guildId || !guildIdAktiv(guildId)) {
      return;
    }
    sicher('Einladung merken', () => invites.merkeEinladung(guildId, ausDiscord(einladung)));
  });

  client.on(Events.InviteDelete, (einladung) => {
    const guildId = einladung.guild?.id;
    if (!guildId || !guildIdAktiv(guildId)) {
      return;
    }
    sicher('Einladung abmelden', () => invites.vergissEinladung(guildId, einladung.code));
  });
}

/**
 * Der erste Abgleich nach dem Start.
 *
 * Getrennt von der Ereignisanmeldung, weil er erst laufen kann, wenn die
 * Guild bekannt ist - und weil sein Ergebnis in den Startprotokollen stehen
 * soll. Wer nach einem Neustart einen unzugeordneten Beitritt sieht, findet
 * hier die Erklaerung.
 */
export async function synchronisiereEinladungenBeimStart(guildId: string): Promise<void> {
  const ergebnis = await invites.synchronisiereEinladungen(guildId);
  if (ergebnis.ok) {
    log.info('Einladungen abgeglichen', { guildId, anzahl: ergebnis.anzahl });
    return;
  }
  if (ergebnis.grund === 'KEIN_ZUGRIFF') {
    log.warn(
      'Einladungen werden nicht verfolgt - dem Bot fehlt das Recht "Server verwalten". Beitritte erscheinen weiterhin im Log, nur ohne Einladung.',
      { guildId },
    );
    return;
  }
  log.warn('Einladungen konnten beim Start nicht abgeglichen werden', { guildId });
}
