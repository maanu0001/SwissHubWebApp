import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { CalendarCategory } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound } from '@swisshub/shared';
import { slugify } from '../tournaments/events';
import { CALENDAR_MODULE_ID } from './config';
import type { CalendarActor } from './schemas';
import type { z } from 'zod';
import type { categoryInputSchema } from './schemas';

const logger = createLogger('calendar:categories');

/**
 * Event-Kategorien.
 *
 * Bewusst schlicht: Name, Farbe, Symbol, Beschreibung, aktiv. Mehr braucht
 * die Unterscheidung im Kalender nicht, und jede weitere Einstellung waere
 * eine, die gepflegt werden muss.
 *
 * Eine stillgelegte Kategorie verschwindet aus der Auswahl, bleibt aber an
 * ihren Terminen: sonst verloeren vergangene Events ihre Einordnung.
 */

/**
 * Kategorien, mit denen ein frischer Server anfangen kann.
 *
 * Angelegt wird das nur auf ausdrueckliche Anforderung, nicht beim ersten
 * Seitenaufruf: ein Server, der eigene Kategorien pflegt, soll nicht
 * ungefragt neun weitere bekommen.
 */
export const VORSCHLAEGE = [
  { name: 'Community', color: '#83060A', icon: 'Users' },
  { name: 'Gaming', color: '#7C3AED', icon: 'Gamepad2' },
  { name: 'Turnier', color: '#EA580C', icon: 'Trophy' },
  { name: 'Stream', color: '#DB2777', icon: 'Radio' },
  { name: 'Watchparty', color: '#0891B2', icon: 'Clapperboard' },
  { name: 'Giveaway', color: '#CA8A04', icon: 'Gift' },
  { name: 'Meeting', color: '#475569', icon: 'ClipboardList' },
  { name: 'Offline', color: '#16A34A', icon: 'MapPin' },
  { name: 'Sonstiges', color: '#64748B', icon: 'CalendarDays' },
] as const;

export type CategoryInput = z.infer<typeof categoryInputSchema>;

async function freierSlug(guildId: string, wunsch: string, eigeneId?: string): Promise<string> {
  const basis = slugify(wunsch) || 'kategorie';
  for (let versuch = 0; versuch < 50; versuch += 1) {
    const kandidat = versuch === 0 ? basis : `${basis}-${versuch + 1}`;
    const belegt = await prisma.calendarCategory.findUnique({
      where: { guildId_slug: { guildId, slug: kandidat } },
      select: { id: true },
    });
    if (!belegt || belegt.id === eigeneId) {
      return kandidat;
    }
  }
  throw conflict('Zu diesem Namen gibt es bereits zu viele Kategorien.');
}

export async function saveCategory(
  actor: CalendarActor,
  input: CategoryInput,
): Promise<CalendarCategory> {
  const guildId = await resolveGuildId();
  const slug = await freierSlug(guildId, input.name, input.id);
  const daten = {
    name: input.name,
    description: input.description,
    color: input.color,
    icon: input.icon,
    active: input.active,
    position: input.position,
    slug,
  };

  const kategorie = input.id
    ? await prisma.calendarCategory.update({ where: { id: input.id }, data: daten })
    : await prisma.calendarCategory.create({ data: { guildId, ...daten } });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_CATEGORY_SAVED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: kategorie.name,
    success: true,
    metadata: { categoryId: kategorie.id, neu: !input.id, active: kategorie.active },
  });
  return kategorie;
}

/**
 * Eine Kategorie entfernen.
 *
 * Nur, solange kein Termin sie traegt. Sonst waere die Einordnung vergangener
 * Events weg - und zwar unwiederbringlich. Wer sie loswerden will, legt sie
 * stattdessen still.
 */
export async function deleteCategory(actor: CalendarActor, categoryId: string): Promise<void> {
  const kategorie = await prisma.calendarCategory.findUnique({ where: { id: categoryId } });
  if (!kategorie) {
    throw notFound('Kategorie nicht gefunden', 'Diese Kategorie existiert nicht.');
  }
  const verwendet = await prisma.calendarEvent.count({ where: { categoryId } });
  if (verwendet > 0) {
    throw conflict(
      `Diese Kategorie ist ${verwendet}-mal vergeben. Lege sie still, statt sie zu löschen - sonst verlieren vergangene Events ihre Einordnung.`,
    );
  }
  await prisma.calendarCategory.delete({ where: { id: categoryId } });
  await safeRecordAudit({
    action: AUDIT_ACTIONS.CALENDAR_CATEGORY_SAVED,
    module: CALENDAR_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: kategorie.name,
    success: true,
    metadata: { categoryId, geloescht: true },
  });
}

/** Die Vorschlagsliste anlegen - nur, was noch fehlt. */
export async function seedCategories(actor: CalendarActor): Promise<number> {
  const guildId = await resolveGuildId();
  let angelegt = 0;
  for (const [index, vorschlag] of VORSCHLAEGE.entries()) {
    const slug = slugify(vorschlag.name);
    const vorhanden = await prisma.calendarCategory.findUnique({
      where: { guildId_slug: { guildId, slug } },
      select: { id: true },
    });
    if (vorhanden) {
      continue;
    }
    await prisma.calendarCategory.create({
      data: {
        guildId,
        slug,
        name: vorschlag.name,
        color: vorschlag.color,
        icon: vorschlag.icon,
        position: index,
      },
    });
    angelegt += 1;
  }
  if (angelegt > 0) {
    logger.info('Kategorien angelegt', { angelegt, actor: actor.discordId });
  }
  return angelegt;
}
