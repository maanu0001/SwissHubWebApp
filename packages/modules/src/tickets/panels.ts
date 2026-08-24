import { prisma } from '@swisshub/database';
import type { TicketPanel } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { discord, resolveGuildId, BUTTON_STYLE } from '@swisshub/discord';
import type { DiscordActionRow, DiscordMessagePayload } from '@swisshub/discord';

const logger = createLogger('tickets:panels');

/** SwissHub-Rot, wie im Kommunikationsmodul. */
const ACCENT_COLOR = 0x83060a;

/** Discord erlaubt fuenf Knoepfe je Reihe und fuenf Reihen. */
const KNOEPFE_JE_REIHE = 5;
export const MAX_PANEL_KATEGORIEN = 20;

/** Kennung, die Discord beim Klick zurueckgibt. */
export const PANEL_BUTTON_PREFIX = 'tickets:open:';

export interface TicketPanelInput {
  name: string;
  title: string;
  description: string;
  bannerUrl?: string | null;
  thumbnailUrl?: string | null;
  footerText?: string | null;
  color?: number | null;
  discordChannelId: string;
  buttonLabel: string;
  buttonEmoji?: string | null;
  active: boolean;
  categoryIds: string[];
}

export async function listPanels() {
  return prisma.ticketPanel.findMany({
    orderBy: [{ createdAt: 'asc' }],
    include: {
      categories: {
        orderBy: { sortOrder: 'asc' },
        include: { category: { select: { id: true, name: true, emoji: true, active: true } } },
      },
    },
  });
}

export async function getPanel(panelId: string) {
  return prisma.ticketPanel.findUnique({
    where: { id: panelId },
    include: {
      categories: {
        orderBy: { sortOrder: 'asc' },
        include: { category: true },
      },
    },
  });
}

function pruefe(input: TicketPanelInput): void {
  if (input.categoryIds.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Ein Panel braucht mindestens eine Kategorie - sonst führt der Knopf nirgendwohin.',
    });
  }
  if (input.categoryIds.length > MAX_PANEL_KATEGORIEN) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: `Discord erlaubt höchstens ${MAX_PANEL_KATEGORIEN} Knöpfe je Nachricht.`,
    });
  }
}

export async function createPanel(input: TicketPanelInput): Promise<TicketPanel> {
  pruefe(input);
  const guildId = await resolveGuildId();

  return prisma.ticketPanel.create({
    data: {
      guildId,
      ...daten(input),
      categories: {
        create: input.categoryIds.map((categoryId, index) => ({ categoryId, sortOrder: index })),
      },
    },
  });
}

export async function updatePanel(panelId: string, input: TicketPanelInput): Promise<TicketPanel> {
  pruefe(input);

  return prisma.$transaction(async (tx) => {
    await tx.ticketPanelCategory.deleteMany({ where: { panelId } });
    return tx.ticketPanel.update({
      where: { id: panelId },
      data: {
        ...daten(input),
        categories: {
          create: input.categoryIds.map((categoryId, index) => ({ categoryId, sortOrder: index })),
        },
      },
    });
  });
}

/**
 * Ein Panel entfernen.
 *
 * Die Discord-Nachricht wird mitgeloescht. Bliebe sie stehen, koennten
 * Mitglieder weiter darauf druecken und bekaemen eine Fehlermeldung, deren
 * Ursache niemand mehr findet.
 */
export async function deletePanel(panelId: string): Promise<void> {
  const panel = await prisma.ticketPanel.findUniqueOrThrow({ where: { id: panelId } });
  if (panel.discordMessageId) {
    await discord.channels
      .delete(panel.discordChannelId, panel.discordMessageId, 'Ticket-Panel entfernt')
      .catch(() => undefined);
  }
  await prisma.ticketPanel.delete({ where: { id: panelId } });
}

/**
 * Ein Panel auf Discord veroeffentlichen.
 *
 * Existiert die Nachricht bereits, wird sie bearbeitet statt erneut gesendet.
 * Sonst sammelten sich bei jeder Aenderung neue Panels im Kanal an, und
 * Mitglieder druecken auf das aelteste.
 *
 * Ist die Nachricht auf Discord verschwunden, entsteht eine neue - das ist
 * der einzige Fall, in dem doppelte Panels denkbar waeren, und er tritt nur
 * ein, wenn jemand die alte bereits geloescht hat.
 */
export async function publishPanel(panelId: string): Promise<TicketPanel> {
  const panel = await getPanel(panelId);
  if (!panel) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Panel existiert nicht.' });
  }

  const aktive = panel.categories.filter((eintrag) => eintrag.category.active);
  if (aktive.length === 0) {
    throw new AppError('CONFLICT', {
      userMessage: 'Keine der Kategorien dieses Panels ist aktiv.',
    });
  }

  const payload = panelNachricht({
    title: panel.title,
    description: panel.description,
    bannerUrl: panel.bannerUrl,
    thumbnailUrl: panel.thumbnailUrl,
    footerText: panel.footerText,
    color: panel.color,
    buttonLabel: panel.buttonLabel,
    buttonEmoji: panel.buttonEmoji,
    kategorien: aktive.map((eintrag) => ({
      id: eintrag.category.id,
      name: eintrag.category.name,
      emoji: eintrag.category.emoji,
    })),
  });

  if (panel.discordMessageId) {
    try {
      await discord.channels.edit(panel.discordChannelId, panel.discordMessageId, payload);
      return prisma.ticketPanel.update({
        where: { id: panelId },
        data: { missingSince: null },
      });
    } catch (fehler) {
      logger.warn('Panel-Nachricht liess sich nicht bearbeiten - es entsteht eine neue', {
        panelId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    }
  }

  const gesendet = await discord.channels.send(panel.discordChannelId, payload);
  return prisma.ticketPanel.update({
    where: { id: panelId },
    data: { discordMessageId: gesendet.id, missingSince: null },
  });
}

/**
 * Die Nachricht eines Panels.
 *
 * Bewusst als eigene Funktion und ohne Datenbankzugriff: so laesst sie sich
 * pruefen, ohne Discord oder eine Datenbank zu brauchen - und die Kennung
 * der Knoepfe ist genau eine Stelle, die der Bot beim Klick wiedererkennen
 * muss.
 */
export function panelNachricht(panel: {
  title: string;
  description: string;
  bannerUrl?: string | null;
  thumbnailUrl?: string | null;
  footerText?: string | null;
  color?: number | null;
  buttonLabel: string;
  buttonEmoji?: string | null;
  kategorien: Array<{ id: string; name: string; emoji?: string | null }>;
}): DiscordMessagePayload {
  const einzeln = panel.kategorien.length === 1;

  const knoepfe = panel.kategorien.slice(0, MAX_PANEL_KATEGORIEN).map((kategorie) => ({
    type: 2 as const,
    style: BUTTON_STYLE.PRIMARY,
    // Ein Knopf je Kategorie: das Mitglied waehlt in einem Schritt statt in
    // zweien, und der Bot weiss beim Klick bereits, worum es geht.
    label: (einzeln ? panel.buttonLabel : kategorie.name).slice(0, 80),
    custom_id: `${PANEL_BUTTON_PREFIX}${kategorie.id}`,
    ...(() => {
      const zeichen = einzeln ? panel.buttonEmoji : (kategorie.emoji ?? panel.buttonEmoji);
      return zeichen ? { emoji: { name: zeichen } } : {};
    })(),
  }));

  const reihen: DiscordActionRow[] = [];
  for (let index = 0; index < knoepfe.length; index += KNOEPFE_JE_REIHE) {
    reihen.push({ type: 1, components: knoepfe.slice(index, index + KNOEPFE_JE_REIHE) });
  }

  return {
    embeds: [
      {
        title: panel.title.slice(0, 256),
        description: panel.description.slice(0, 4000),
        color: panel.color ?? ACCENT_COLOR,
        ...(panel.bannerUrl ? { image: { url: panel.bannerUrl } } : {}),
        ...(panel.thumbnailUrl ? { thumbnail: { url: panel.thumbnailUrl } } : {}),
        ...(panel.footerText ? { footer: { text: panel.footerText.slice(0, 2048) } } : {}),
      },
    ],
    components: reihen,
    allowedMentions: { parse: [] },
  };
}

/**
 * Verschwundene Panel-Nachrichten erkennen.
 *
 * Ein Panel, dessen Nachricht geloescht wurde, ist nicht kaputt - es ist nur
 * unsichtbar. Die Markierung sorgt dafuer, dass die Gesundheitspruefung es
 * meldet, statt dass jemand irgendwann bemerkt, dass keine Tickets mehr
 * eingehen.
 */
export async function reconcilePanels(): Promise<{ fehlend: number }> {
  const panels = await prisma.ticketPanel.findMany({
    where: { active: true, discordMessageId: { not: null } },
    include: {
      categories: {
        orderBy: { sortOrder: 'asc' },
        include: { category: { select: { id: true, name: true, emoji: true, active: true } } },
      },
    },
  });

  let fehlend = 0;
  for (const panel of panels) {
    const aktive = panel.categories.filter((eintrag) => eintrag.category.active);
    if (aktive.length === 0) {
      continue;
    }

    // Geprueft wird durch Bearbeiten mit dem vollstaendigen Inhalt. Ein
    // leerer Aufruf waere die kuerzere Pruefung - und wuerde die Nachricht
    // im Erfolgsfall leeren. So ist der Abgleich zugleich die Reparatur:
    // eine Kategorie, die inzwischen anders heisst, steht danach richtig da.
    const erreichbar = await discord.channels
      .edit(
        panel.discordChannelId,
        panel.discordMessageId!,
        panelNachricht({
          ...panel,
          kategorien: aktive.map((eintrag) => ({
            id: eintrag.category.id,
            name: eintrag.category.name,
            emoji: eintrag.category.emoji,
          })),
        }),
      )
      .then(() => true)
      .catch(() => false);

    if (erreichbar) {
      if (panel.missingSince) {
        await prisma.ticketPanel.update({ where: { id: panel.id }, data: { missingSince: null } });
      }
      continue;
    }

    // Bewusst kein automatisches Neusenden: wer die Nachricht geloescht hat,
    // hatte einen Grund. Die Gesundheitspruefung meldet es, das
    // Veroeffentlichen bleibt eine Entscheidung.
    fehlend += 1;
    await prisma.ticketPanel.update({
      where: { id: panel.id },
      data: { discordMessageId: null, missingSince: panel.missingSince ?? new Date() },
    });
  }

  if (fehlend > 0) {
    logger.info('Fehlende Ticket-Panels erkannt', { anzahl: fehlend });
  }
  return { fehlend };
}

function daten(input: TicketPanelInput) {
  return {
    name: input.name.slice(0, 100),
    title: input.title.slice(0, 256),
    description: input.description.slice(0, 4000),
    bannerUrl: input.bannerUrl || null,
    thumbnailUrl: input.thumbnailUrl || null,
    footerText: input.footerText?.slice(0, 2048) || null,
    color: input.color ?? null,
    discordChannelId: input.discordChannelId,
    buttonLabel: input.buttonLabel.slice(0, 80),
    buttonEmoji: input.buttonEmoji || null,
    active: input.active,
  };
}
