import { Events, type Client, type VoiceState } from 'discord.js';
import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { voice, voiceHub } from '@swisshub/modules';
import { getModuleSettings } from '@swisshub/modules';

const log = createLogger('bot:voice-hub');

/**
 * Die Discord-Seite des Voice Hub.
 *
 * Ein einziges Ereignis traegt alles: `VoiceStateUpdate` sagt, wer wohin
 * gewechselt ist. Daraus folgt, ob ein Talk entsteht, ob einer leer geworden
 * ist, ob ein Besitzer gegangen ist und ob ein geplantes Loeschen wieder
 * abzublasen ist.
 *
 * Was hier passiert, ist bewusst duenn: die Entscheidungen liegen in den
 * Diensten, damit das Dashboard dieselben trifft.
 */
export function registerVoiceHub(client: Client): void {
  client.on(Events.VoiceStateUpdate, (before, after) => {
    void behandleWechsel(before, after).catch((error: unknown) => {
      log.error('Voice-Ereignis konnte nicht verarbeitet werden', {
        error: error instanceof Error ? error.message : 'unbekannt',
      });
    });
  });
}

async function behandleWechsel(before: VoiceState, after: VoiceState): Promise<void> {
  if (before.channelId === after.channelId) {
    // Stummschalten, Video, Bildschirmfreigabe - fuer den Lebenszyklus egal.
    return;
  }

  // Reihenfolge mit Absicht: erst das Verlassen auswerten, dann das Betreten.
  // Wer aus seinem Talk direkt in den Hub wechselt, soll nicht erst einen
  // neuen Talk bekommen und danach den alten aufgeraeumt sehen.
  if (before.channelId) {
    await behandleVerlassen(before);
  }
  if (after.channelId) {
    await behandleBetreten(after);
  }
}

/** Jemand hat einen Kanal verlassen. */
async function behandleVerlassen(state: VoiceState): Promise<void> {
  const channelId = state.channelId;
  if (!channelId) {
    return;
  }

  const kanal = await voice.findeOffenenKanal(channelId);
  if (!kanal) {
    return;
  }

  // Nur eigene Talks. Der Gruppenkanal einer Spielersuche hat seine eigene
  // Regel, wann er endet - `spielersuche-voice.ts` kuemmert sich darum und
  // schliesst dabei auch die Suche.
  if (kanal.source !== 'VOICE_HUB') {
    return;
  }

  const discordId = state.member?.id ?? state.id;

  // Der Besitzer ist gegangen - die Schonfrist beginnt. Ob jemand anderes
  // uebernimmt, entscheidet der Abgleich, wenn sie abgelaufen ist. Sofort zu
  // uebergeben waere falsch: wer kurz die Verbindung verliert, verlöre seinen
  // Talk an den Naechstbesten.
  if (discordId === kanal.ownerDiscordId) {
    await voice.merkeBesitzerFort(kanal.id);
  }

  const menschen = await voice.menschenImKanal(channelId);
  if (menschen === 0) {
    const grace = await schonfrist(kanal.presetId);
    await voice.planeLoeschung(kanal, grace);
    log.debug('Talk ist leer - Löschung geplant', { id: kanal.id, grace });
  }
}

/** Jemand hat einen Kanal betreten. */
async function behandleBetreten(state: VoiceState): Promise<void> {
  const channelId = state.channelId;
  const mitglied = state.member;
  if (!channelId || !mitglied) {
    return;
  }

  // --- Ist es ein bestehender Talk? ---------------------------------------
  const kanal = await voice.findeOffenenKanal(channelId);
  if (kanal) {
    if (kanal.source !== 'VOICE_HUB') {
      return;
    }
    // Ein geplantes Loeschen ist damit ueberholt.
    await voice.haltePlanungAn(kanal.id);

    if (mitglied.id === kanal.ownerDiscordId) {
      await voice.besitzerIstZurueck(kanal.id);
    }

    const menschen = await voice.menschenImKanal(channelId);
    await voice.notiereAnwesenheit(kanal, menschen);
    return;
  }

  // --- Oder ein Hub? -------------------------------------------------------
  await behandleHubBeitritt(state);
}

async function behandleHubBeitritt(state: VoiceState): Promise<void> {
  const mitglied = state.member;
  const channelId = state.channelId;
  if (!mitglied || !channelId) {
    return;
  }

  // Die Rechte des Beitretenden aus demselben System wie ueberall sonst.
  const { buildActor } = await import('./commands/context');
  const actor = await buildActor(
    { id: mitglied.id, username: mitglied.user.username, avatar: mitglied.user.avatar },
    mitglied,
  );

  const ergebnis = await voiceHub.handleHubJoin({
    discordId: mitglied.id,
    username: mitglied.user.username,
    displayName: mitglied.displayName,
    roleIds: [...mitglied.roles.cache.keys()],
    isBot: mitglied.user.bot,
    channelId,
    darfNutzen: actor.can(voiceHub.VOICE_HUB_PERMISSIONS.use),
  });

  if (ergebnis.art === 'KEIN_HUB') {
    return;
  }

  if (ergebnis.art === 'ABGELEHNT') {
    // Der Beitretende steht im Hub und wuerde dort haengen bleiben. Ihn zu
    // trennen ist freundlicher als ihn stumm sitzen zu lassen - und die
    // Begruendung kommt per Direktnachricht, weil ein Hub keinen Textchat
    // hat, in dem sie jemand lesen wuerde.
    await mitglied
      .send({ content: `Din Talk isch nöd erstellt worde: ${ergebnis.grund}` })
      .catch(() => undefined);
    await mitglied.voice.disconnect('Voice Hub: nicht berechtigt').catch(() => undefined);
    log.info('Hub-Beitritt abgelehnt', { discordId: mitglied.id, grund: ergebnis.grund });
    return;
  }

  if (ergebnis.art === 'ERSTELLT') {
    const settings = await getModuleSettings<voiceHub.VoiceHubSettings>(
      voiceHub.VOICE_HUB_MODULE_ID,
    );
    if (settings.controlPanelEnabled) {
      await voiceHub.posteBedienfeld(ergebnis.kanal);
    }
    log.info('Talk erstellt', {
      id: ergebnis.kanal.id,
      owner: mitglied.id,
      hub: ergebnis.hub.name,
    });
  }
}

/** Die Schonfrist des Presets, sonst die des Moduls. */
async function schonfrist(presetId: string | null): Promise<number> {
  if (presetId) {
    const preset = await prisma.voicePreset.findUnique({
      where: { id: presetId },
      select: { deleteGraceSeconds: true },
    });
    if (preset) {
      return preset.deleteGraceSeconds;
    }
  }
  const settings = await getModuleSettings<voiceHub.VoiceHubSettings>(
    voiceHub.VOICE_HUB_MODULE_ID,
  );
  return settings.defaultDeleteGraceSeconds;
}

/**
 * Raeumt nach einem Neustart auf.
 *
 * Der Bot war eine Weile weg und hat in der Zeit keine Ereignisse gesehen:
 * Talks sind leer geworden, Besitzer gegangen, Kanaele von Hand geloescht. Der
 * Abgleich holt das in einem Durchgang nach.
 */
export async function recoverVoiceHub(guildId: string | null): Promise<void> {
  if (!guildId) {
    return;
  }

  // Der Anwesenheitsstand des Bots ist nach dem Verbinden die Wahrheit -
  // `voice-presence.ts` schreibt ihn beim Start neu. Danach kann der Abgleich
  // entscheiden, welche Talks wirklich leer sind.
  const ergebnis = await voice.reconcileTemporaryVoices().catch((error: unknown) => {
    log.warn('Voice-Abgleich nach dem Start fehlgeschlagen', {
      error: error instanceof Error ? error.message : 'unbekannt',
    });
    return null;
  });

  if (ergebnis) {
    log.info('Voice Hub nach Neustart abgeglichen', { ...ergebnis });
  }

  // Bedienfelder, die inzwischen verschwunden sind, wieder anlegen. Ohne sie
  // stuende ein Talk ohne Knoepfe da und niemand wuesste, warum.
  await stelleBedienfelderWiederHer(guildId).catch(() => undefined);
}

async function stelleBedienfelderWiederHer(guildId: string): Promise<void> {
  const settings = await getModuleSettings<voiceHub.VoiceHubSettings>(
    voiceHub.VOICE_HUB_MODULE_ID,
  );
  if (!settings.controlPanelEnabled) {
    return;
  }

  const ohnePanel = await prisma.temporaryVoiceChannel.findMany({
    where: {
      guildId,
      closedAt: null,
      discordChannelId: { not: null },
      controlMessageId: null,
      source: 'VOICE_HUB',
    },
    take: 50,
  });

  for (const kanal of ohnePanel) {
    await voiceHub.posteBedienfeld(kanal).catch(() => undefined);
  }
  if (ohnePanel.length > 0) {
    log.info('Fehlende Bedienfelder ergänzt', { anzahl: ohnePanel.length });
  }
}
