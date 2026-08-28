import { z } from 'zod';
import type { DiscordEmbed } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { publish } from './bus';
import { eventTypeSchema, getEventDefinition } from './contract';
import { render } from './context';
import { darfEreignisAusloesen } from './limits';
import { registerAction, type ActionResult, type ValidationIssue } from './registry';
import { pruefeZieladresse, sendeWebhook } from './webhook';

const logger = createLogger('automation:actions');

/**
 * Die Aktionen, die kein Modul brauchen.
 *
 * ## Was hier bewusst fehlt
 *
 * **Kein Bannen, Kicken, Timeout, Jail oder Ablehnen einer Verifikation.**
 * Das ist keine Lücke, sondern die wichtigste Entscheidung dieser Datei
 * (§7, §33).
 *
 * Eine Sanktion trifft einen Menschen, ist von aussen kaum von einer
 * Fehlfunktion zu unterscheiden und lässt sich nicht zurücknehmen - ein
 * fälschlich gebanntes Mitglied ist weg, auch wenn der Bann eine Minute
 * später fällt. Eine Bedingung, die versehentlich immer zutrifft, wäre damit
 * kein Ärgernis, sondern ein Schaden am Server.
 *
 * Automationen dürfen deshalb **melden und vorbereiten**, nicht sanktionieren:
 * eine Nachricht an den Moderationskanal, eine Markierungsrolle, ein Eintrag
 * im Verlauf. Die Entscheidung trifft ein Mensch mit der Berechtigung dafür,
 * über die dafür vorgesehene Oberfläche - dort, wo sie geprüft und
 * protokolliert wird.
 *
 * Wer eine solche Aktion künftig doch anmeldet, muss `requiresApproval: true`
 * setzen; die Engine hält den Lauf dann an und wartet auf einen Menschen
 * (§32).
 */

const nachrichtBasis = {
  inhalt: z.string().max(2000).optional(),
  titel: z.string().max(256).optional(),
  beschreibung: z.string().max(4000).optional(),
  farbe: z.string().regex(/^#?[0-9a-fA-F]{6}$/u).optional(),
};

function baueNutzlast(config: {
  inhalt?: string;
  titel?: string;
  beschreibung?: string;
  farbe?: string;
}): { content?: string; embeds?: DiscordEmbed[] } | null {
  const embeds: DiscordEmbed[] = [];
  if (config.titel || config.beschreibung) {
    embeds.push({
      ...(config.titel ? { title: config.titel } : {}),
      ...(config.beschreibung ? { description: config.beschreibung } : {}),
      ...(config.farbe ? { color: Number.parseInt(config.farbe.replace('#', ''), 16) } : {}),
    });
  }
  const inhalt = config.inhalt?.trim();
  if (!inhalt && embeds.length === 0) {
    return null;
  }
  return {
    ...(inhalt ? { content: inhalt } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
  };
}

// --- Nachricht in einen Kanal -----------------------------------------------

export const kanalNachrichtConfigSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/u, 'muss eine Discord-Kanal-ID sein'),
  ...nachrichtBasis,
});

registerAction({
  id: 'nachricht.kanal',
  label: 'Nachricht senden',
  description: 'Schreibt eine Nachricht in einen Kanal.',
  group: 'Discord',
  icon: 'message-square',
  configSchema: kanalNachrichtConfigSchema,
  fields: [
    { key: 'channelId', label: 'Kanal', type: 'discord-channel', required: true },
    { key: 'inhalt', label: 'Text', type: 'textarea', supportsTemplate: true },
    { key: 'titel', label: 'Titel (Embed)', type: 'text', supportsTemplate: true },
    { key: 'beschreibung', label: 'Beschreibung (Embed)', type: 'textarea', supportsTemplate: true },
    { key: 'farbe', label: 'Farbe', type: 'text', placeholder: '#5865F2' },
  ],
  async execute(config, context): Promise<ActionResult> {
    const geprueft = config as z.infer<typeof kanalNachrichtConfigSchema>;
    const nutzlast = baueNutzlast(geprueft);
    if (!nutzlast) {
      return { status: 'NO_OP', detail: 'Die Nachricht wäre leer gewesen.' };
    }
    const gesendet = await context.gateway.channels.send(geprueft.channelId, {
      ...nutzlast,
      // Erwähnungen werden nicht durchgereicht: eine Automation, die
      // @everyone auslöst, weil ein Mitgliedsname so heisst, wäre ein Unfall
      // mit Publikum.
      allowedMentions: { parse: [] },
    });
    return {
      status: 'SUCCESS',
      detail: 'Nachricht gesendet.',
      output: { messageId: gesendet.id, channelId: gesendet.channelId },
    };
  },
  async preview(config): Promise<string> {
    const geprueft = config as z.infer<typeof kanalNachrichtConfigSchema>;
    const text = geprueft.inhalt ?? geprueft.titel ?? geprueft.beschreibung ?? '';
    return `Würde in <#${geprueft.channelId}> schreiben: «${text.slice(0, 120)}»`;
  },
  async validate(config, umgebung): Promise<ValidationIssue[]> {
    const geprueft = kanalNachrichtConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return [{ severity: 'error', message: 'Der Nachrichtenschritt ist unvollständig.' }];
    }
    const probleme: ValidationIssue[] = [];
    if (!umgebung.kanalIds.has(geprueft.data.channelId)) {
      probleme.push({ severity: 'error', message: 'Diesen Kanal gibt es nicht (mehr).' });
    }
    if (!baueNutzlast(geprueft.data)) {
      probleme.push({ severity: 'error', message: 'Die Nachricht hat keinen Inhalt.' });
    }
    return probleme;
  },
});

// --- Direktnachricht --------------------------------------------------------

export const direktNachrichtConfigSchema = z.object({
  wen: z.enum(['subject', 'actor']).default('subject'),
  ...nachrichtBasis,
});

registerAction({
  id: 'nachricht.direkt',
  label: 'Direktnachricht senden',
  description: 'Schreibt dem betroffenen Mitglied privat.',
  group: 'Discord',
  icon: 'mail',
  configSchema: direktNachrichtConfigSchema,
  fields: [
    {
      key: 'wen',
      label: 'An wen',
      type: 'select',
      options: [
        { value: 'subject', label: 'Das betroffene Mitglied' },
        { value: 'actor', label: 'Wer es ausgelöst hat' },
      ],
      default: 'subject',
    },
    { key: 'inhalt', label: 'Text', type: 'textarea', supportsTemplate: true },
    { key: 'titel', label: 'Titel (Embed)', type: 'text', supportsTemplate: true },
    { key: 'beschreibung', label: 'Beschreibung (Embed)', type: 'textarea', supportsTemplate: true },
  ],
  async execute(config, context): Promise<ActionResult> {
    const geprueft = config as z.infer<typeof direktNachrichtConfigSchema>;
    const discordId = geprueft.wen === 'actor' ? context.event.actorId : context.event.subjectId;
    if (!discordId) {
      return { status: 'NO_OP', detail: 'Für dieses Ereignis gibt es keine Empfängerin.' };
    }
    const nutzlast = baueNutzlast(geprueft);
    if (!nutzlast) {
      return { status: 'NO_OP', detail: 'Die Nachricht wäre leer gewesen.' };
    }
    const zugestellt = await context.gateway.channels.sendDirect(discordId, {
      ...nutzlast,
      allowedMentions: { parse: [] },
    });
    // Geschlossene Direktnachrichten sind eine Entscheidung des Mitglieds,
    // kein Fehler der Automation.
    return zugestellt
      ? { status: 'SUCCESS', detail: 'Direktnachricht zugestellt.' }
      : { status: 'NO_OP', detail: 'Das Mitglied nimmt keine Direktnachrichten an.' };
  },
  async preview(config): Promise<string> {
    const geprueft = config as z.infer<typeof direktNachrichtConfigSchema>;
    const text = geprueft.inhalt ?? geprueft.titel ?? geprueft.beschreibung ?? '';
    return `Würde privat schreiben: «${text.slice(0, 120)}»`;
  },
});

// --- Rollen -----------------------------------------------------------------

export const rollenAktionConfigSchema = z.object({
  roleId: z.string().regex(/^\d{17,20}$/u, 'muss eine Discord-Rollen-ID sein'),
  wen: z.enum(['subject', 'actor']).default('subject'),
  grund: z.string().max(200).optional(),
});

function rollenFelder(): Parameters<typeof registerAction>[0]['fields'] {
  return [
    { key: 'roleId', label: 'Rolle', type: 'discord-role', required: true },
    {
      key: 'wen',
      label: 'Wem',
      type: 'select',
      options: [
        { value: 'subject', label: 'Dem betroffenen Mitglied' },
        { value: 'actor', label: 'Wer es ausgelöst hat' },
      ],
      default: 'subject',
    },
    { key: 'grund', label: 'Grund (Audit-Log)', type: 'text', supportsTemplate: true },
  ];
}

registerAction({
  id: 'rolle.geben',
  label: 'Rolle vergeben',
  description: 'Gibt dem betroffenen Mitglied eine Rolle.',
  group: 'Discord',
  icon: 'user-plus',
  requiredPermission: 'members.roles.manage',
  configSchema: rollenAktionConfigSchema,
  fields: rollenFelder(),
  async execute(config, context): Promise<ActionResult> {
    const { roleId, wen, grund } = config as z.infer<typeof rollenAktionConfigSchema>;
    const discordId = wen === 'actor' ? context.event.actorId : context.event.subjectId;
    if (!discordId) {
      return { status: 'NO_OP', detail: 'Für dieses Ereignis gibt es kein Mitglied.' };
    }
    const mitglied = await context.gateway.members.get(discordId);
    if (!mitglied) {
      return { status: 'NO_OP', detail: 'Das Mitglied ist nicht mehr auf dem Server.' };
    }
    // Bereits vorhanden ist der gewünschte Zustand, kein Fehler (§14).
    if (mitglied.roleIds.includes(roleId)) {
      return { status: 'NO_OP', detail: 'Die Rolle war bereits vergeben.' };
    }
    await context.gateway.roles.add(discordId, roleId, grund ?? 'Automation');
    return { status: 'SUCCESS', detail: 'Rolle vergeben.', output: { roleId, discordId } };
  },
  async preview(config): Promise<string> {
    const { roleId } = config as z.infer<typeof rollenAktionConfigSchema>;
    return `Würde die Rolle <@&${roleId}> vergeben.`;
  },
  async validate(config, umgebung): Promise<ValidationIssue[]> {
    return pruefeRolle(config, umgebung.rollenIds);
  },
});

registerAction({
  id: 'rolle.entfernen',
  label: 'Rolle entfernen',
  description: 'Nimmt dem betroffenen Mitglied eine Rolle weg.',
  group: 'Discord',
  icon: 'user-minus',
  requiredPermission: 'members.roles.manage',
  configSchema: rollenAktionConfigSchema,
  fields: rollenFelder(),
  async execute(config, context): Promise<ActionResult> {
    const { roleId, wen, grund } = config as z.infer<typeof rollenAktionConfigSchema>;
    const discordId = wen === 'actor' ? context.event.actorId : context.event.subjectId;
    if (!discordId) {
      return { status: 'NO_OP', detail: 'Für dieses Ereignis gibt es kein Mitglied.' };
    }
    const mitglied = await context.gateway.members.get(discordId);
    if (!mitglied) {
      return { status: 'NO_OP', detail: 'Das Mitglied ist nicht mehr auf dem Server.' };
    }
    if (!mitglied.roleIds.includes(roleId)) {
      return { status: 'NO_OP', detail: 'Die Rolle war nicht vergeben.' };
    }
    await context.gateway.roles.remove(discordId, roleId, grund ?? 'Automation');
    return { status: 'SUCCESS', detail: 'Rolle entfernt.', output: { roleId, discordId } };
  },
  async preview(config): Promise<string> {
    const { roleId } = config as z.infer<typeof rollenAktionConfigSchema>;
    return `Würde die Rolle <@&${roleId}> entfernen.`;
  },
  async validate(config, umgebung): Promise<ValidationIssue[]> {
    return pruefeRolle(config, umgebung.rollenIds);
  },
});

async function pruefeRolle(
  config: unknown,
  rollenIds: ReadonlySet<string>,
): Promise<ValidationIssue[]> {
  const geprueft = rollenAktionConfigSchema.safeParse(config);
  if (!geprueft.success) {
    return [{ severity: 'error', message: 'Es ist keine Rolle gewählt.' }];
  }
  return rollenIds.has(geprueft.data.roleId)
    ? []
    : [{ severity: 'error', message: 'Diese Rolle gibt es auf dem Server nicht (mehr).' }];
}

// --- Internes Ereignis ------------------------------------------------------

export const ereignisConfigSchema = z.object({
  type: eventTypeSchema,
  /** Bis zu fünf Felder. Werte dürfen Platzhalter enthalten. */
  felder: z.record(z.string().max(500)).default({}),
});

registerAction({
  id: 'ereignis.ausloesen',
  label: 'Internes Ereignis auslösen',
  description: 'Meldet ein Ereignis, auf das andere Automationen reagieren können.',
  group: 'System',
  icon: 'git-branch',
  configSchema: ereignisConfigSchema,
  fields: [
    { key: 'type', label: 'Ereignis', type: 'text', required: true, placeholder: 'automation.custom' },
  ],
  async execute(config, context): Promise<ActionResult> {
    const { type, felder } = config as z.infer<typeof ereignisConfigSchema>;

    // Die Grenze steht hier, nicht erst im Bus: sonst wäre ein Lauf, der in
    // einer Schleife Ereignisse meldet, erst nach dem fünften erkennbar (§16).
    if (!darfEreignisAusloesen(context)) {
      return { status: 'NO_OP', detail: 'Dieser Lauf hat sein Ereignis-Kontingent erreicht.' };
    }

    const nutzdaten: Record<string, unknown> = {};
    for (const [schluessel, vorlage] of Object.entries(felder)) {
      nutzdaten[schluessel] = render(vorlage, context).text;
    }

    const ergebnis = await publish({
      type,
      guildId: context.guildId,
      payload: nutzdaten,
      actorId: context.event.actorId,
      subjectId: context.event.subjectId,
      entityId: context.event.entityId,
      // Die Herkunft mitzugeben ist der ganze Schleifenschutz: ohne sie
      // begänne jede Kette wieder bei Tiefe null (§17).
      causation: {
        correlationId: context.correlationId,
        causationId: context.event.id ?? context.runId,
        depth: context.depth,
      },
    });

    context.emitted += 1;

    return ergebnis.angenommen
      ? { status: 'SUCCESS', detail: `Ereignis «${type}» ausgelöst.`, output: { eventId: ergebnis.eventId } }
      : { status: 'NO_OP', detail: ergebnis.grund ?? 'Das Ereignis wurde nicht angenommen.' };
  },
  async preview(config): Promise<string> {
    const { type } = config as z.infer<typeof ereignisConfigSchema>;
    return `Würde das Ereignis «${type}» auslösen.`;
  },
  async validate(config): Promise<ValidationIssue[]> {
    const geprueft = ereignisConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return [{ severity: 'error', message: 'Der Ereignisname ist ungültig.' }];
    }
    return getEventDefinition(geprueft.data.type)
      ? []
      : [
          {
            severity: 'error',
            message: `Das Ereignis «${geprueft.data.type}» ist nicht angemeldet.`,
          },
        ];
  },
});

// --- Webhook ----------------------------------------------------------------

export const webhookConfigSchema = z.object({
  url: z.string().url().max(500),
  felder: z.record(z.string().max(500)).default({}),
});

registerAction({
  id: 'webhook.senden',
  label: 'Webhook senden',
  description: 'Ruft eine HTTPS-Adresse mit den Daten des Laufs auf.',
  group: 'System',
  icon: 'link',
  requiredPermission: 'automations.webhooks.manage',
  configSchema: webhookConfigSchema,
  fields: [
    {
      key: 'url',
      label: 'Adresse',
      description: 'Nur HTTPS. Keine internen Adressen, keine Zugangsdaten in der Adresse.',
      type: 'text',
      required: true,
      placeholder: 'https://…',
    },
  ],
  async execute(config, context): Promise<ActionResult> {
    const { url, felder } = config as z.infer<typeof webhookConfigSchema>;

    const nutzdaten: Record<string, unknown> = {};
    for (const [schluessel, vorlage] of Object.entries(felder)) {
      nutzdaten[schluessel] = render(vorlage, context).text;
    }

    const ergebnis = await sendeWebhook(url, {
      guildId: context.guildId,
      automationId: context.automationId,
      runId: context.runId,
      event: context.event.type,
      occurredAt: context.event.occurredAt.toISOString(),
      data: nutzdaten,
    });

    if (!ergebnis.ok) {
      // Der Grund ist bereits bereinigt; die Adresse steht nicht darin, weil
      // sie ein Geheimnis im Pfad tragen kann (§20).
      logger.warn('Webhook gescheitert', {
        runId: context.runId,
        automationId: context.automationId,
        status: ergebnis.status,
      });
      throw Object.assign(new Error('Webhook gescheitert'), {
        userMessage: ergebnis.grund ?? 'Der Webhook liess sich nicht zustellen.',
        status: ergebnis.status,
      });
    }

    return { status: 'SUCCESS', detail: `Webhook gesendet (${ergebnis.status}).` };
  },
  async preview(config): Promise<string> {
    const { url } = config as z.infer<typeof webhookConfigSchema>;
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return 'unbekannt';
      }
    })();
    return `Würde einen Webhook an ${host} senden.`;
  },
  async validate(config): Promise<ValidationIssue[]> {
    const geprueft = webhookConfigSchema.safeParse(config);
    if (!geprueft.success) {
      return [{ severity: 'error', message: 'Die Adresse ist ungültig.' }];
    }
    const befund = await pruefeZieladresse(geprueft.data.url);
    return befund.erlaubt
      ? []
      : [{ severity: 'error', message: befund.grund ?? 'Diese Adresse ist nicht erlaubt.' }];
  },
});
