import { ChannelType, Events, type Client, type Message, type PartialMessage } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { analytics } from '@swisshub/modules';
import { AUDIT_LOG_ACTIONS } from '@swisshub/discord';

const log = createLogger('bot:analytics');

/**
 * Die Aufzeichnung der Server-Ereignisse.
 *
 * Der Bot hoert mit und schreibt in das Ereignisprotokoll. Vier Regeln, die
 * fuer alles hier gelten:
 *
 * 1. **Nichts darf den Bot anhalten.** Jeder Aufruf ist gefangen; ein
 *    misslungener Protokolleintrag darf keine Nachricht verschlucken.
 * 2. **Kein erfundener Verursacher.** Discord nennt bei einer geloeschten
 *    Nachricht nicht, wer sie geloescht hat. Wo `correlateActor` nichts
 *    Belegbares findet, bleibt der Verursacher unbekannt.
 * 3. **Ohne Inhalt kein Inhalt.** Fehlt das Message-Content-Intent, kommen
 *    Nachrichten leer an. Dann wird das Ereignis trotzdem vermerkt - aber
 *    ohne zu behaupten, der Text sei leer gewesen.
 * 4. **Die Einstellungen entscheiden, nicht dieser Code.** Ob eine Kategorie
 *    aufgezeichnet wird, prueft `recordEvent` zentral.
 */
export function registerAnalyticsEvents(
  client: Client,
  guildIdAktiv: (candidate: string) => boolean,
  inhalteVerfuegbar: boolean,
): void {
  if (!inhalteVerfuegbar) {
    log.warn(
      'Message-Content-Intent nicht freigeschaltet - im Verlauf steht, DASS eine Nachricht gelöscht wurde, nicht WAS darin stand. Im Discord Developer Portal unter Bot → Privileged Gateway Intents aktivieren.',
    );
  }

  const sicher = (was: string, arbeit: () => Promise<unknown>): void => {
    void arbeit().catch((error: unknown) => log.warn(`${was} nicht protokolliert`, { error }));
  };

  // --- Nachrichten ---------------------------------------------------------

  /**
   * Jede Nachricht merken, damit ihr Text bei einer spaeteren Loeschung noch
   * bekannt ist. Discord liefert ihn dann naemlich nicht mit.
   */
  client.on(Events.MessageCreate, (nachricht) => {
    if (!nachricht.guildId || !guildIdAktiv(nachricht.guildId)) {
      return;
    }

    // Zaehlen zuerst - und ohne den Text. Fuer eine Nachrichtenzahl braucht es
    // den Inhalt nicht, und was nicht gelesen wird, kann auch nicht auslaufen.
    // Deshalb haengt das Zaehlen auch nicht am Message-Content-Intent: die
    // Statistik funktioniert, selbst wenn die Zeitleiste keine Texte kennt.
    sicher('Nachrichtenzählung', () =>
      analytics.zaehleNachricht({
        guildId: nachricht.guildId as string,
        discordId: nachricht.author.id,
        isBot: nachricht.author.bot,
        channelId: nachricht.channelId,
        channelName: kanalName(nachricht),
        parentId: 'parentId' in nachricht.channel ? (nachricht.channel.parentId ?? null) : null,
        at: nachricht.createdAt,
      }),
    );

    if (!inhalteVerfuegbar || nachricht.author.bot) {
      return;
    }
    sicher('Nachricht', () =>
      analytics.rememberMessage({
        messageId: nachricht.id,
        guildId: nachricht.guildId as string,
        channelId: nachricht.channelId,
        authorDiscordId: nachricht.author.id,
        authorUsername: nachricht.author.username,
        content: nachricht.content,
        attachmentCount: nachricht.attachments.size,
        replyToMessageId: nachricht.reference?.messageId ?? null,
        postedAt: nachricht.createdAt,
      }),
    );
  });

  client.on(Events.MessageUpdate, (alt, neu) => {
    if (!neu.guildId || !guildIdAktiv(neu.guildId)) {
      return;
    }
    if (neu.author?.bot) {
      return;
    }
    sicher('Bearbeitung', async () => {
      // Der alte Text kommt aus unserem eigenen Stand: discord.js liefert ihn
      // nur, wenn die Nachricht noch im Cache liegt - nach einem Neustart nie.
      const stand = await analytics.recallMessage(neu.id);
      const vorher = alt.content ?? stand?.content ?? null;
      const nachher = neu.content ?? null;
      if (vorher !== null && vorher === nachher) {
        // Discord schickt `MessageUpdate` auch, wenn nur eine Vorschau
        // nachgeladen wurde. Das ist keine Bearbeitung.
        return;
      }

      await analytics.recordEvent({
        guildId: neu.guildId as string,
        category: 'MESSAGE',
        type: analytics.EVENT_TYPES.MESSAGE_EDIT,
        severity: 'INFO',
        // Wer eine Nachricht bearbeitet, ist immer ihr Verfasser - Discord
        // laesst nichts anderes zu. Das ist belegt, keine Vermutung.
        actorDiscordId: neu.author?.id ?? stand?.authorDiscordId ?? null,
        actorUsername: neu.author?.username ?? stand?.authorUsername ?? null,
        actorSource: 'GATEWAY',
        subjectDiscordId: neu.author?.id ?? stand?.authorDiscordId ?? null,
        subjectUsername: neu.author?.username ?? stand?.authorUsername ?? null,
        channelId: neu.channelId,
        channelName: kanalName(neu),
        messageId: neu.id,
        contentBefore: vorher,
        contentAfter: nachher,
        occurredAt: neu.editedAt ?? new Date(),
      });

      if (nachher !== null && neu.author) {
        await analytics.rememberMessage({
          messageId: neu.id,
          guildId: neu.guildId as string,
          channelId: neu.channelId,
          authorDiscordId: neu.author.id,
          authorUsername: neu.author.username,
          content: nachher,
          attachmentCount: neu.attachments?.size ?? 0,
          replyToMessageId: neu.reference?.messageId ?? null,
          postedAt: neu.createdAt ?? new Date(),
        });
      }
    });
  });

  client.on(Events.MessageDelete, (nachricht) => {
    if (!nachricht.guildId || !guildIdAktiv(nachricht.guildId)) {
      return;
    }
    sicher('Löschung', async () => {
      const stand = await analytics.recallMessage(nachricht.id);
      if (nachricht.author?.bot || (!stand && !nachricht.author)) {
        // Ohne jeden Anhaltspunkt - weder Cache noch eigener Stand - waere der
        // Eintrag «eine unbekannte Nachricht wurde geloescht». Das hilft
        // niemandem.
        if (!stand) {
          return;
        }
      }

      const jetzt = new Date();
      const verursacher = await analytics.correlateActor({
        actionType: AUDIT_LOG_ACTIONS.MESSAGE_DELETE,
        // Das Audit Log nennt als Ziel den Verfasser, nicht die Nachricht.
        targetId: stand?.authorDiscordId ?? nachricht.author?.id ?? '',
        occurredAt: jetzt,
        channelId: nachricht.channelId,
      });

      const ereignis = await analytics.recordEvent({
        guildId: nachricht.guildId as string,
        category: 'MESSAGE',
        type: analytics.EVENT_TYPES.MESSAGE_DELETE,
        // Eine geloeschte Nachricht ist der haeufigste Grund, hier
        // nachzusehen - sie soll sich abheben.
        severity: 'NOTICE',
        actorDiscordId: verursacher.discordId,
        actorUsername: verursacher.username,
        actorSource: verursacher.source,
        subjectDiscordId: stand?.authorDiscordId ?? nachricht.author?.id ?? null,
        subjectUsername: stand?.authorUsername ?? nachricht.author?.username ?? null,
        channelId: nachricht.channelId,
        channelName: kanalName(nachricht),
        messageId: nachricht.id,
        contentBefore: stand?.content ?? nachricht.content ?? null,
        contentAfter: null,
        metadata: {
          anhaenge: stand?.attachmentCount ?? nachricht.attachments?.size ?? 0,
          ...(verursacher.reason ? { grund: verursacher.reason } : {}),
        },
        occurredAt: jetzt,
      });

      // Anhaenge sichern, solange Discord sie noch ausliefert: nach dem
      // Loeschen der Nachricht verschwinden auch ihre Dateien vom CDN, und
      // dann ist es zu spaet. Ob ueberhaupt archiviert wird, entscheidet die
      // Einstellung - `archiveAttachment` prueft das selbst.
      if (ereignis && nachricht.attachments && nachricht.attachments.size > 0) {
        await archiviereAnhaenge(ereignis.id, nachricht.guildId as string, nachricht);
      }

      await analytics.forgetMessage(nachricht.id);
    });
  });

  client.on(Events.MessageBulkDelete, (nachrichten) => {
    const erste = nachrichten.first();
    if (!erste?.guildId || !guildIdAktiv(erste.guildId)) {
      return;
    }
    sicher('Sammel-Löschung', async () => {
      const jetzt = new Date();
      // Eine Kennung fuer den ganzen Vorgang: die Zeitleiste zeigt daran, dass
      // es ein Vorgang war und nicht zwanzig einzelne.
      const bulkId = `bulk-${erste.id}`;
      const verursacher = await analytics.correlateActor({
        actionType: AUDIT_LOG_ACTIONS.MESSAGE_BULK_DELETE,
        // Bei einer Sammel-Loeschung ist das Ziel der Kanal.
        targetId: erste.channelId,
        occurredAt: jetzt,
      });

      for (const nachricht of nachrichten.values()) {
        const stand = await analytics.recallMessage(nachricht.id);
        await analytics.recordEvent({
          guildId: erste.guildId as string,
          category: 'MESSAGE',
          type: analytics.EVENT_TYPES.MESSAGE_BULK_DELETE,
          severity: 'WARNING',
          actorDiscordId: verursacher.discordId,
          actorUsername: verursacher.username,
          actorSource: verursacher.source,
          subjectDiscordId: stand?.authorDiscordId ?? nachricht.author?.id ?? null,
          subjectUsername: stand?.authorUsername ?? nachricht.author?.username ?? null,
          channelId: nachricht.channelId,
          channelName: kanalName(nachricht),
          messageId: nachricht.id,
          contentBefore: stand?.content ?? nachricht.content ?? null,
          bulkId,
          metadata: { anzahl: nachrichten.size },
          occurredAt: jetzt,
        });
        await analytics.forgetMessage(nachricht.id);
      }
    });
  });

  // --- Sprachkanäle --------------------------------------------------------

  client.on(Events.VoiceStateUpdate, (alt, neu) => {
    const guildId = neu.guild?.id ?? alt.guild?.id;
    if (!guildId || !guildIdAktiv(guildId)) {
      return;
    }
    if (neu.member?.user.bot) {
      return;
    }

    const vorher = alt.channelId;
    const nachher = neu.channelId;
    if (vorher === nachher) {
      // Stumm-, Taub- und Streamzustaende aendern denselben Zustand, ohne dass
      // jemand den Kanal wechselt. Sie gehoeren nicht in diese Zeitleiste.
      return;
    }

    const person = neu.member ?? alt.member;
    const gemeinsam = {
      guildId,
      category: 'VOICE' as const,
      // Das Gateway nennt die Person selbst - hier gibt es nichts zu raten.
      actorDiscordId: person?.id ?? null,
      actorUsername: person?.user.username ?? null,
      actorSource: 'GATEWAY' as const,
      subjectDiscordId: person?.id ?? null,
      subjectUsername: person?.user.username ?? null,
      occurredAt: new Date(),
    };

    const jetzt = gemeinsam.occurredAt;
    const istAfk = (kanalId: string | null): boolean =>
      Boolean(kanalId && neu.guild?.afkChannelId === kanalId);

    sicher('Sprachkanal', async () => {
      if (vorher && nachher) {
        await analytics.recordEvent({
          ...gemeinsam,
          type: analytics.EVENT_TYPES.VOICE_MOVE,
          channelId: nachher,
          channelName: neu.channel?.name ?? null,
          metadata: { von: vorher, vonName: alt.channel?.name ?? null },
        });
        // Ein Kanalwechsel beendet die Sitzung nicht: wer den Raum wechselt,
        // ist weiterhin im Gespraech. Der Abschnitt endet, die Sitzung laeuft
        // unter derselben Kennung weiter - so bekommt die Kanalstatistik ihre
        // Zeit richtig aufgeteilt und die Sitzungszahl bleibt eine Sitzung.
        const { sessionId } = await analytics.beendeSprachAbschnitt(guildId, person?.id ?? '', jetzt);
        await analytics.starteSprachAbschnitt({
          guildId,
          discordId: person?.id ?? '',
          isBot: person?.user.bot ?? false,
          channelId: nachher,
          channelName: neu.channel?.name ?? null,
          parentId: neu.channel?.parentId ?? null,
          isAfk: istAfk(nachher),
          at: jetzt,
          sessionId: sessionId ?? undefined,
        });
        return;
      }
      if (nachher) {
        await analytics.recordEvent({
          ...gemeinsam,
          type: analytics.EVENT_TYPES.VOICE_JOIN,
          channelId: nachher,
          channelName: neu.channel?.name ?? null,
        });
        await analytics.starteSprachAbschnitt({
          guildId,
          discordId: person?.id ?? '',
          isBot: person?.user.bot ?? false,
          channelId: nachher,
          channelName: neu.channel?.name ?? null,
          parentId: neu.channel?.parentId ?? null,
          isAfk: istAfk(nachher),
          at: jetzt,
        });
        return;
      }
      await analytics.recordEvent({
        ...gemeinsam,
        type: analytics.EVENT_TYPES.VOICE_LEAVE,
        channelId: vorher,
        channelName: alt.channel?.name ?? null,
      });
      await analytics.beendeSprachAbschnitt(guildId, person?.id ?? '', jetzt);
    });
  });

  // --- Mitglieder ----------------------------------------------------------

  client.on(Events.GuildMemberAdd, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    const beigetreten = new Date();
    sicher('Beitritt', async () => {
      await analytics.recordEvent({
        guildId: member.guild.id,
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_JOIN,
        subjectDiscordId: member.id,
        subjectUsername: member.user.username,
        metadata: { kontoErstellt: member.user.createdAt.toISOString() },
        occurredAt: beigetreten,
      });
      await analytics.zaehleBeitritt(member.guild.id, member.id, beigetreten, member.user.bot);
    });
  });

  client.on(Events.GuildMemberRemove, (member) => {
    if (!guildIdAktiv(member.guild.id)) {
      return;
    }
    sicher('Austritt', async () => {
      const jetzt = new Date();
      // Ein Austritt kann ein Kick gewesen sein - oder ein freiwilliges
      // Verlassen. Das Gateway-Ereignis ist in beiden Faellen dasselbe.
      const verursacher = await analytics.correlateActor({
        actionType: AUDIT_LOG_ACTIONS.MEMBER_KICK,
        targetId: member.id,
        occurredAt: jetzt,
      });

      await analytics.recordEvent({
        guildId: member.guild.id,
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_LEAVE,
        severity: verursacher.source === 'AUDIT_LOG' ? 'WARNING' : 'INFO',
        actorDiscordId: verursacher.discordId,
        actorUsername: verursacher.username,
        actorSource: verursacher.source,
        subjectDiscordId: member.id,
        subjectUsername: member.user.username,
        metadata: {
          // Ausdruecklich, weil der Unterschied zaehlt und nicht aus dem Typ
          // hervorgeht.
          gekickt: verursacher.source === 'AUDIT_LOG',
          ...(verursacher.reason ? { grund: verursacher.reason } : {}),
        },
        occurredAt: jetzt,
      });
      await analytics.zaehleAustritt(member.guild.id, member.id, jetzt, member.user.bot);
    });
  });

  client.on(Events.GuildMemberUpdate, (alt, neu) => {
    if (!guildIdAktiv(neu.guild.id)) {
      return;
    }
    sicher('Mitgliedsänderung', async () => {
      const jetzt = new Date();
      const gemeinsam = {
        guildId: neu.guild.id,
        category: 'MEMBER' as const,
        subjectDiscordId: neu.id,
        subjectUsername: neu.user.username,
        occurredAt: jetzt,
      };

      const vorherRollen = new Set(alt.roles.cache.keys());
      const nachherRollen = new Set(neu.roles.cache.keys());
      const dazu = [...nachherRollen].filter((id) => !vorherRollen.has(id));
      const weg = [...vorherRollen].filter((id) => !nachherRollen.has(id));

      if (dazu.length > 0 || weg.length > 0) {
        const verursacher = await analytics.correlateActor({
          actionType: AUDIT_LOG_ACTIONS.MEMBER_ROLE_UPDATE,
          targetId: neu.id,
          occurredAt: jetzt,
        });
        for (const [rollen, typ] of [
          [dazu, analytics.EVENT_TYPES.MEMBER_ROLE_ADD],
          [weg, analytics.EVENT_TYPES.MEMBER_ROLE_REMOVE],
        ] as const) {
          if (rollen.length === 0) {
            continue;
          }
          await analytics.recordEvent({
            ...gemeinsam,
            type: typ,
            actorDiscordId: verursacher.discordId,
            actorUsername: verursacher.username,
            actorSource: verursacher.source,
            metadata: {
              rollen: rollen.map((id) => ({
                id,
                name: neu.guild.roles.cache.get(id)?.name ?? alt.guild.roles.cache.get(id)?.name ?? null,
              })),
            },
          });
        }
      }

      if (alt.nickname !== neu.nickname) {
        await analytics.recordEvent({
          ...gemeinsam,
          type: analytics.EVENT_TYPES.MEMBER_NICKNAME,
          contentBefore: alt.nickname,
          contentAfter: neu.nickname,
        });
      }

      const vorherTimeout = alt.communicationDisabledUntilTimestamp;
      const nachherTimeout = neu.communicationDisabledUntilTimestamp;
      if (vorherTimeout !== nachherTimeout) {
        const gesetzt = Boolean(nachherTimeout && nachherTimeout > Date.now());
        const verursacher = await analytics.correlateActor({
          actionType: AUDIT_LOG_ACTIONS.MEMBER_UPDATE,
          targetId: neu.id,
          occurredAt: jetzt,
        });
        await analytics.recordEvent({
          ...gemeinsam,
          type: gesetzt ? analytics.EVENT_TYPES.MEMBER_TIMEOUT : analytics.EVENT_TYPES.MEMBER_TIMEOUT_END,
          severity: gesetzt ? 'WARNING' : 'INFO',
          actorDiscordId: verursacher.discordId,
          actorUsername: verursacher.username,
          actorSource: verursacher.source,
          metadata: {
            bis: nachherTimeout ? new Date(nachherTimeout).toISOString() : null,
            ...(verursacher.reason ? { grund: verursacher.reason } : {}),
          },
        });
      }
    });
  });

  // --- Banns ---------------------------------------------------------------

  client.on(Events.GuildBanAdd, (bann) => {
    if (!guildIdAktiv(bann.guild.id)) {
      return;
    }
    sicher('Bann', async () => {
      const jetzt = new Date();
      const verursacher = await analytics.correlateActor({
        actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD,
        targetId: bann.user.id,
        occurredAt: jetzt,
      });
      await analytics.recordEvent({
        guildId: bann.guild.id,
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_BAN,
        severity: 'CRITICAL',
        actorDiscordId: verursacher.discordId,
        actorUsername: verursacher.username,
        actorSource: verursacher.source,
        subjectDiscordId: bann.user.id,
        subjectUsername: bann.user.username,
        metadata: verursacher.reason ? { grund: verursacher.reason } : {},
        occurredAt: jetzt,
      });
    });
  });

  client.on(Events.GuildBanRemove, (bann) => {
    if (!guildIdAktiv(bann.guild.id)) {
      return;
    }
    sicher('Bannaufhebung', async () => {
      const jetzt = new Date();
      const verursacher = await analytics.correlateActor({
        actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_REMOVE,
        targetId: bann.user.id,
        occurredAt: jetzt,
      });
      await analytics.recordEvent({
        guildId: bann.guild.id,
        category: 'MEMBER',
        type: analytics.EVENT_TYPES.MEMBER_UNBAN,
        severity: 'NOTICE',
        actorDiscordId: verursacher.discordId,
        actorUsername: verursacher.username,
        actorSource: verursacher.source,
        subjectDiscordId: bann.user.id,
        subjectUsername: bann.user.username,
        occurredAt: jetzt,
      });
    });
  });

  // --- Rollen und Kanäle ---------------------------------------------------

  client.on(Events.GuildRoleCreate, (rolle) => {
    if (!guildIdAktiv(rolle.guild.id)) {
      return;
    }
    sicher('Rolle angelegt', () =>
      verwaltung(
        rolle.guild.id,
        'ROLE',
        analytics.EVENT_TYPES.ROLE_CREATE,
        AUDIT_LOG_ACTIONS.ROLE_CREATE,
        rolle.id,
        rolle.name,
      ),
    );
  });

  client.on(Events.GuildRoleDelete, (rolle) => {
    if (!guildIdAktiv(rolle.guild.id)) {
      return;
    }
    sicher('Rolle gelöscht', () =>
      verwaltung(
        rolle.guild.id,
        'ROLE',
        analytics.EVENT_TYPES.ROLE_DELETE,
        AUDIT_LOG_ACTIONS.ROLE_DELETE,
        rolle.id,
        rolle.name,
        'WARNING',
      ),
    );
  });

  client.on(Events.GuildRoleUpdate, (alt, neu) => {
    if (!guildIdAktiv(neu.guild.id)) {
      return;
    }
    if (alt.name === neu.name && alt.permissions.bitfield === neu.permissions.bitfield) {
      // Farbe und Position aendern sich beim Sortieren staendig - das ist
      // keine Verwaltungshandlung, die jemand nachlesen will.
      return;
    }
    sicher('Rolle geändert', () =>
      verwaltung(
        neu.guild.id,
        'ROLE',
        analytics.EVENT_TYPES.ROLE_UPDATE,
        AUDIT_LOG_ACTIONS.ROLE_UPDATE,
        neu.id,
        neu.name,
        alt.permissions.bitfield === neu.permissions.bitfield ? 'INFO' : 'WARNING',
        {
          vorherName: alt.name,
          rechteGeaendert: alt.permissions.bitfield !== neu.permissions.bitfield,
        },
      ),
    );
  });

  for (const [ereignis, typ, auditTyp, schwere] of [
    [Events.ChannelCreate, analytics.EVENT_TYPES.CHANNEL_CREATE, AUDIT_LOG_ACTIONS.CHANNEL_CREATE, 'INFO'],
    [Events.ChannelDelete, analytics.EVENT_TYPES.CHANNEL_DELETE, AUDIT_LOG_ACTIONS.CHANNEL_DELETE, 'WARNING'],
  ] as const) {
    client.on(ereignis, (kanal) => {
      if (kanal.type === ChannelType.DM || !('guild' in kanal) || !guildIdAktiv(kanal.guild.id)) {
        return;
      }
      sicher('Kanal', () =>
        verwaltung(kanal.guild.id, 'CHANNEL', typ, auditTyp, kanal.id, kanal.name, schwere),
      );
    });
  }

  log.info('Analytics-Aufzeichnung aktiv', { nachrichteninhalte: inhalteVerfuegbar });
}

/**
 * Verwaltungshandlungen an Rollen und Kanaelen.
 *
 * Sie stehen alle im Audit Log, und dort steht auch, wer sie ausgeloest hat -
 * anders als bei einer geloeschten Nachricht ist die Zuordnung hier meistens
 * eindeutig. «Meistens» heisst trotzdem: bleibt sie aus, bleibt der
 * Verursacher unbekannt.
 */
async function verwaltung(
  guildId: string,
  category: 'ROLE' | 'CHANNEL',
  type: string,
  auditTyp: number,
  targetId: string,
  name: string,
  severity: 'INFO' | 'NOTICE' | 'WARNING' | 'CRITICAL' = 'INFO',
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const jetzt = new Date();
  const verursacher = await analytics.correlateActor({ actionType: auditTyp, targetId, occurredAt: jetzt });

  await analytics.recordEvent({
    guildId,
    category,
    type,
    severity,
    actorDiscordId: verursacher.discordId,
    actorUsername: verursacher.username,
    actorSource: verursacher.source,
    channelId: category === 'CHANNEL' ? targetId : null,
    channelName: category === 'CHANNEL' ? name : null,
    metadata: { name, id: targetId, ...metadata },
    occurredAt: jetzt,
  });
}

/** Kanalname, soweit discord.js ihn kennt - bei einer Teilnachricht oft nicht. */
function kanalName(nachricht: Message | PartialMessage): string | null {
  const kanal = nachricht.channel;
  return kanal && 'name' in kanal ? (kanal.name ?? null) : null;
}

/**
 * Anhaenge einer geloeschten Nachricht ins Archiv holen.
 *
 * Discord loescht die Dateien kurz nach der Nachricht vom CDN - wer sie
 * behalten will, muss sie jetzt holen. Faellt der Abruf aus, bleibt das
 * Ereignis bestehen und traegt nur keine Datei: eine Zeile ohne Anhang ist
 * besser als keine Zeile.
 */
async function archiviereAnhaenge(
  eventId: string,
  guildId: string,
  nachricht: Message | PartialMessage,
): Promise<void> {
  for (const anhang of nachricht.attachments.values()) {
    try {
      const antwort = await fetch(anhang.url);
      if (!antwort.ok) {
        continue;
      }
      const bytes = new Uint8Array(await antwort.arrayBuffer());
      const ergebnis = await analytics.archiveAttachment({
        eventId,
        guildId,
        displayName: anhang.name,
        mimeType: anhang.contentType ?? 'application/octet-stream',
        bytes,
      });
      if (!ergebnis.gespeichert && ergebnis.grund !== 'AUS') {
        log.debug('Anhang nicht archiviert', { grund: ergebnis.grund, name: anhang.name });
      }
    } catch (error) {
      log.debug('Anhang konnte nicht geholt werden', { error });
    }
  }
}

/**
 * Wer gerade in einem Sprachkanal sitzt.
 *
 * Beim Start gebraucht: ein offener Abschnitt einer Person, die noch im Kanal
 * steht, ist kein verwaister Abschnitt, sondern eine laufende Anwesenheit -
 * die Person hat den Kanal nie verlassen, nur der Bot war weg.
 */
export function anwesendeImVoice(client: Client, guildId: string): Set<string> {
  const anwesend = new Set<string>();
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return anwesend;
  }
  for (const kanal of guild.channels.cache.values()) {
    if (!('members' in kanal) || kanal.type === ChannelType.GuildText) {
      continue;
    }
    const mitglieder = kanal.members;
    if (mitglieder && typeof mitglieder === 'object' && 'values' in mitglieder) {
      for (const mitglied of (mitglieder as Map<string, { id: string }>).values()) {
        anwesend.add(mitglied.id);
      }
    }
  }
  return anwesend;
}
