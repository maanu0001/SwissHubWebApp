import { z } from 'zod';
import { registerEvent } from '@swisshub/automation';

/**
 * Die Ereignisse der SwissHub-Module.
 *
 * Hier - und nur hier - steht, worauf eine Automation überhaupt zeigen kann.
 * Die Engine kennt diese Liste nicht; sie erfährt davon, weil diese Datei
 * beim Start geladen wird. Ein neues Modul ergänzt seine Ereignisse und muss
 * an der Engine nichts ändern (§49).
 *
 * ## Drei Regeln für ein neues Ereignis
 *
 * 1. **Der Name bleibt.** `verification.completed` heisst in zwei Jahren
 *    dasselbe. Ändert sich die Bedeutung der Nutzdaten, steigt
 *    `schemaVersion`; der Name wird nicht umgedeutet.
 * 2. **Die Nutzdaten sind das Versprechen.** Was in `variables` steht, ist
 *    zugesagt und darf nicht verschwinden - eine Automation zeigt darauf.
 * 3. **Keine Geheimnisse, keine Rohdaten.** Nutzdaten landen im Verlauf und
 *    in Vorschauen. Was dort nicht stehen darf, gehört nicht hinein (§20).
 */

const discordId = z.string().regex(/^\d{17,20}$/u);

// --- Mitglieder -------------------------------------------------------------

registerEvent({
  type: 'member.joined',
  label: 'Mitglied ist beigetreten',
  description: 'Jemand hat den Server betreten.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    username: z.string(),
    displayName: z.string(),
    /** Alter des Discord-Kontos in Tagen - der nützlichste Wert gegen Wegwerfkonten. */
    kontoAlterTage: z.number().int().nullable(),
    istBot: z.boolean(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.username', label: 'Benutzername', type: 'string' },
    { path: 'payload.kontoAlterTage', label: 'Kontoalter in Tagen', type: 'number' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'member.left',
  label: 'Mitglied hat den Server verlassen',
  description: 'Jemand ist ausgetreten oder wurde entfernt.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    username: z.string(),
    displayName: z.string(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'member.role_added',
  label: 'Rolle wurde vergeben',
  description: 'Ein Mitglied hat eine Rolle bekommen - egal von wem.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    roleId: discordId,
    roleName: z.string(),
  }),
  variables: [
    { path: 'payload.roleId', label: 'Rollen-ID', type: 'string' },
    { path: 'payload.roleName', label: 'Rollenname', type: 'string' },
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
  ],
});

registerEvent({
  type: 'member.role_removed',
  label: 'Rolle wurde entfernt',
  description: 'Einem Mitglied wurde eine Rolle weggenommen.',
  module: 'members',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    roleId: discordId,
    roleName: z.string(),
  }),
  variables: [
    { path: 'payload.roleId', label: 'Rollen-ID', type: 'string' },
    { path: 'payload.roleName', label: 'Rollenname', type: 'string' },
  ],
});

// --- Sprachkanäle -----------------------------------------------------------

registerEvent({
  type: 'voice.joined',
  label: 'Sprachkanal betreten',
  description: 'Jemand ist einem Sprachkanal beigetreten.',
  module: 'voice',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    channelId: discordId,
    channelName: z.string(),
  }),
  variables: [
    { path: 'payload.channelName', label: 'Kanalname', type: 'string' },
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
  ],
});

registerEvent({
  type: 'voice.left',
  label: 'Sprachkanal verlassen',
  description: 'Jemand hat einen Sprachkanal verlassen.',
  module: 'voice',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    channelId: discordId,
    channelName: z.string(),
  }),
  variables: [{ path: 'payload.channelName', label: 'Kanalname', type: 'string' }],
});

// --- Moderation -------------------------------------------------------------

registerEvent({
  type: 'moderation.action_created',
  label: 'Moderationsmassnahme wurde erfasst',
  description:
    'Ein Bann, Kick oder Timeout ist in der Akte gelandet - ueber das Moderation Center ausgeloest oder direkt in Discord und hier erkannt. Jail-Vorgaenge meldet dieses Ereignis nicht; sie laufen ueber das Jail-Modul.',
  module: 'moderation',
  payloadSchema: z.object({
    /** BAN, UNBAN, KICK, TIMEOUT, TIMEOUT_UPDATE oder TIMEOUT_REMOVE. */
    art: z.string(),
    /** WEBAPP, BOT, DISCORD oder SYSTEM - woher die Massnahme kam. */
    quelle: z.string(),
    /** HUMAN, BOT, SYSTEM oder UNKNOWN. */
    handelnderArt: z.string(),
    targetDiscordId: discordId,
    targetUsername: z.string(),
    actorUsername: z.string(),
    grund: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.art', label: 'Massnahme', type: 'string' },
    { path: 'payload.quelle', label: 'Quelle', type: 'string' },
    { path: 'payload.targetUsername', label: 'Betroffene Person', type: 'string' },
    { path: 'payload.actorUsername', label: 'Handelnde Person', type: 'string' },
    { path: 'payload.grund', label: 'Grund', type: 'string' },
    { path: 'event.subjectId', label: 'Discord-ID der betroffenen Person', type: 'string' },
  ],
});

// --- Verifikation -----------------------------------------------------------

registerEvent({
  type: 'verification.completed',
  label: 'Mitglied wurde verifiziert',
  description: 'Ein Vorgang wurde freigeschaltet - von einem Menschen oder von der AI.',
  module: 'verification',
  payloadSchema: z.object({
    requestId: z.string(),
    discordId,
    displayName: z.string(),
    /** `HUMAN` oder `AI`. Für Automationen, die nur menschliche Entscheide behandeln. */
    entschiedenVon: z.enum(['HUMAN', 'AI']),
    rollenGesetzt: z.boolean(),
  }),
  variables: [
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.entschiedenVon', label: 'Entschieden von', type: 'string' },
    { path: 'event.subjectId', label: 'Discord-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'verification.rejected',
  label: 'Verifikation wurde abgelehnt',
  description:
    'Ein Vorgang wurde abgelehnt. Nur zur Meldung - Sanktionen trifft die Automation Engine nie selbst.',
  module: 'verification',
  payloadSchema: z.object({
    requestId: z.string(),
    discordId,
    displayName: z.string(),
    entschiedenVon: z.enum(['HUMAN', 'AI']),
  }),
  variables: [{ path: 'payload.displayName', label: 'Anzeigename', type: 'string' }],
});

// --- Level ------------------------------------------------------------------

registerEvent({
  type: 'level.up',
  label: 'Mitglied ist aufgestiegen',
  description: 'Jemand hat ein neues Level erreicht.',
  module: 'level',
  payloadSchema: z.object({
    discordId,
    displayName: z.string(),
    level: z.number().int(),
    levelVorher: z.number().int(),
    xp: z.number().int(),
  }),
  variables: [
    { path: 'payload.level', label: 'Neues Level', type: 'number' },
    { path: 'payload.displayName', label: 'Anzeigename', type: 'string' },
    { path: 'payload.xp', label: 'XP', type: 'number' },
  ],
});

// --- Tickets ----------------------------------------------------------------

registerEvent({
  type: 'ticket.opened',
  label: 'Ticket wurde eröffnet',
  description: 'Jemand hat ein Ticket aufgemacht.',
  module: 'tickets',
  payloadSchema: z.object({
    ticketId: z.string(),
    nummer: z.number().int(),
    discordId,
    kategorie: z.string(),
    channelId: discordId.nullable(),
  }),
  variables: [
    { path: 'payload.nummer', label: 'Ticketnummer', type: 'number' },
    { path: 'payload.kategorie', label: 'Kategorie', type: 'string' },
    { path: 'payload.channelId', label: 'Kanal-ID', type: 'string' },
  ],
});

registerEvent({
  type: 'ticket.closed',
  label: 'Ticket wurde geschlossen',
  description: 'Ein Ticket ist abgeschlossen.',
  module: 'tickets',
  payloadSchema: z.object({
    ticketId: z.string(),
    nummer: z.number().int(),
    discordId,
    kategorie: z.string(),
    /** Wie lange es offen war, in Minuten. */
    offenMinuten: z.number().int().nullable(),
  }),
  variables: [
    { path: 'payload.nummer', label: 'Ticketnummer', type: 'number' },
    { path: 'payload.offenMinuten', label: 'Offen in Minuten', type: 'number' },
  ],
});

// --- Kalender ---------------------------------------------------------------

registerEvent({
  type: 'calendar.event_published',
  label: 'Termin wurde veröffentlicht',
  description: 'Ein Kalendereintrag ist online gegangen.',
  module: 'calendar',
  payloadSchema: z.object({
    eventId: z.string(),
    titel: z.string(),
    beginntAm: z.string(),
    kategorie: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.beginntAm', label: 'Beginn', type: 'date' },
  ],
});

registerEvent({
  type: 'calendar.registration_created',
  label: 'Anmeldung für einen Termin',
  description: 'Jemand hat sich für einen Termin angemeldet.',
  module: 'calendar',
  payloadSchema: z.object({
    eventId: z.string(),
    registrationId: z.string(),
    discordId,
    titel: z.string(),
    status: z.string(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel des Termins', type: 'string' },
    { path: 'payload.status', label: 'Status', type: 'string' },
  ],
});

// --- Premium ----------------------------------------------------------------

registerEvent({
  type: 'premium.activated',
  label: 'Premium wurde aktiv',
  description: 'Ein Abonnement ist in Kraft getreten.',
  module: 'premium',
  payloadSchema: z.object({
    subscriptionId: z.string(),
    discordId: discordId.nullable(),
    produkt: z.string(),
    laeuftBis: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.produkt', label: 'Produkt', type: 'string' },
    { path: 'payload.laeuftBis', label: 'Läuft bis', type: 'date' },
  ],
});

// --- Turniere ---------------------------------------------------------------

registerEvent({
  type: 'tournament.created',
  label: 'Turnier wurde angelegt',
  description: 'Ein neues Turnier steht bereit.',
  module: 'tournaments',
  payloadSchema: z.object({
    tournamentId: z.string(),
    titel: z.string(),
    spiel: z.string().nullable(),
    beginntAm: z.string().nullable(),
  }),
  variables: [
    { path: 'payload.titel', label: 'Titel', type: 'string' },
    { path: 'payload.spiel', label: 'Spiel', type: 'string' },
  ],
});

// --- Automation selbst ------------------------------------------------------

registerEvent({
  type: 'automation.custom',
  label: 'Eigenes Ereignis',
  description: 'Ein Ereignis, das eine Automation selbst auslöst - um eine zweite Automation anzustossen.',
  module: 'automation',
  // Bewusst offen: die Felder bestimmt die auslösende Automation. Die Grösse
  // begrenzt der Bus, die Tiefe der Schleifenschutz.
  payloadSchema: z.record(z.unknown()),
  variables: [],
});

registerEvent({
  type: 'automation.failed',
  label: 'Eine Automation ist gescheitert',
  description: 'Ein Lauf ist endgültig gescheitert - für eine Meldung an das Team.',
  module: 'automation',
  payloadSchema: z.object({
    automationId: z.string(),
    automationName: z.string(),
    runId: z.string(),
    fehler: z.string(),
  }),
  variables: [
    { path: 'payload.automationName', label: 'Name der Automation', type: 'string' },
    { path: 'payload.fehler', label: 'Fehler', type: 'string' },
  ],
});
