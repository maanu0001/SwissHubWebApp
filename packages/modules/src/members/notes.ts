import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { MemberNote } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { AppError, sanitizeText } from '@swisshub/shared';
import { MEMBER_PERMISSIONS } from '@swisshub/permissions';
import { darfSehen, type MemberViewer } from './access';

/**
 * Interne Notizen zu einem Mitglied.
 *
 * Das einzige, was das Member Center selbst speichert - und zugleich das
 * Empfindlichste, das es anzeigt. Eine Notiz ist eine Einschaetzung von
 * Menschen ueber Menschen; sie geht niemanden ausser dem Team etwas an, auch
 * nicht die betroffene Person im eigenen Profil.
 *
 * Deshalb gibt es hier keinen Geltungsbereich `own`: es gaebe nichts
 * Sinnvolles, das er bedeuten koennte.
 */

/** Laengstmoegliche Notiz. Lang genug fuer einen Sachverhalt, kurz genug,
 *  dass niemand ein Protokoll hineinschreibt. */
export const NOTIZ_MAX = 2000;
const KATEGORIE_MAX = 40;

export interface MemberNoteView {
  id: string;
  content: string;
  category: string | null;
  pinned: boolean;
  author: { discordId: string; username: string };
  createdAt: Date;
  editedAt: Date | null;
  /** Darf der aktuelle Betrachter genau diese Notiz aendern? */
  canEdit: boolean;
  canDelete: boolean;
}

function ansicht(notiz: MemberNote, viewer: MemberViewer): MemberNoteView {
  const eigene = notiz.authorDiscordId === viewer.discordId;
  return {
    id: notiz.id,
    content: notiz.content,
    category: notiz.category,
    pinned: notiz.pinned,
    author: { discordId: notiz.authorDiscordId, username: notiz.authorUsername },
    createdAt: notiz.createdAt,
    editedAt: notiz.editedAt,
    // Die eigene Notiz darf aendern, wer ueberhaupt Notizen schreiben darf -
    // fremde nur, wer das ausdruecklich darf. Wer etwas notiert hat, soll
    // einen Tippfehler beheben koennen, ohne Rechte ueber die Notizen
    // anderer zu bekommen.
    canEdit: eigene
      ? viewer.can(MEMBER_PERMISSIONS.notesCreate) || viewer.can(MEMBER_PERMISSIONS.notesEdit)
      : viewer.can(MEMBER_PERMISSIONS.notesEdit),
    canDelete: viewer.can(MEMBER_PERMISSIONS.notesDelete),
  };
}

/**
 * Die Notizen zu einem Mitglied.
 *
 * Wirft nicht, sondern liefert eine leere Liste, wenn der Betrachter sie nicht
 * sehen darf - der Aggregator fragt vorher, ob er diesen Abschnitt ueberhaupt
 * laden soll. Die Pruefung hier ist die zweite Sperre, nicht die erste.
 */
export async function listMemberNotes(
  viewer: MemberViewer,
  targetDiscordId: string,
  guildId: string,
): Promise<MemberNoteView[]> {
  if (!darfSehen(viewer, 'notes', targetDiscordId)) {
    return [];
  }
  const notizen = await prisma.memberNote.findMany({
    where: { guildId, targetDiscordId },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return notizen.map((notiz) => ansicht(notiz, viewer));
}

/**
 * Prueft Text und Kategorie.
 *
 * `sanitizeText` mit Zeilenumbruechen: eine Notiz darf Absaetze haben, aber
 * keine Steuerzeichen. Erwaehnungen entschaerft die Anzeige - hier steht der
 * Text so, wie er geschrieben wurde, damit spaeter niemand raten muss, was
 * urspruenglich gemeint war.
 */
function pruefeInhalt(rohText: string, rohKategorie: string | null | undefined): {
  content: string;
  category: string | null;
} {
  const content = sanitizeText(rohText, NOTIZ_MAX, { keepNewlines: true });
  if (content.length === 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Die Notiz ist leer.' });
  }
  const category = rohKategorie ? sanitizeText(rohKategorie, KATEGORIE_MAX) || null : null;
  return { content, category };
}

export interface NotizAutor {
  discordId: string;
  username: string;
}

/**
 * Legt eine Notiz an.
 *
 * Der Autor kommt aus der Sitzung und niemals aus der Eingabe - sonst liesse
 * sich eine Notiz unter fremdem Namen hinterlassen, und das waere die
 * unangenehmste Art, dieses Feld zu missbrauchen.
 */
export async function createMemberNote(
  viewer: MemberViewer,
  autor: NotizAutor,
  eingabe: {
    targetDiscordId: string;
    targetLabel?: string | null;
    content: string;
    category?: string | null;
    pinned?: boolean;
  },
): Promise<MemberNoteView> {
  if (!viewer.can(MEMBER_PERMISSIONS.notesCreate)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Notizen schreiben.' });
  }
  const notiz = await schreibeNotiz(autor, eingabe);
  return ansicht(notiz, viewer);
}

/**
 * Eine Notiz anlegen - ohne Berechtigungspruefung.
 *
 * Die macht der Aufrufer, und zwar mit *seinem* Schluessel: das Member Center
 * verlangt `members.notes.create`, die Moderation `moderation.notes.create`.
 * Zwei Berechtigungen, ein Speicher.
 *
 * Genau daran hing der Fehler: die Moderation legte ihre Notizen in der
 * Moderationsakte ab, das Mitgliederprofil las aus dieser Tabelle - und die
 * Notiz, die jemand ueber «Massnahme ergreifen» geschrieben hatte, tauchte
 * beim Mitglied nie auf. Sie war nicht verloren, sie stand nur woanders.
 * Jetzt gibt es einen Ort.
 */
export async function schreibeNotiz(
  autor: NotizAutor,
  eingabe: {
    targetDiscordId: string;
    targetLabel?: string | null;
    content: string;
    category?: string | null;
    pinned?: boolean;
  },
): Promise<MemberNote> {
  const guildId = await resolveGuildId();
  const { content, category } = pruefeInhalt(eingabe.content, eingabe.category);

  const notiz = await prisma.memberNote.create({
    data: {
      guildId,
      targetDiscordId: eingabe.targetDiscordId,
      authorDiscordId: autor.discordId,
      authorUsername: autor.username.slice(0, 64),
      content,
      category,
      pinned: eingabe.pinned ?? false,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MEMBER_NOTE_CREATED,
    module: 'members',
    actorDiscordId: autor.discordId,
    actorUsername: autor.username,
    targetDiscordId: eingabe.targetDiscordId,
    targetLabel: eingabe.targetLabel ?? null,
    // Bewusst ohne den Text: das Audit Log ist fuer mehr Augen sichtbar als
    // die Notiz selbst. Es haelt fest, dass jemand etwas notiert hat.
    metadata: { noteId: notiz.id, category, laenge: content.length },
  });

  return notiz;
}

/** Aendert eine Notiz. Fremde nur mit der ausdruecklichen Berechtigung. */
export async function updateMemberNote(
  viewer: MemberViewer,
  autor: NotizAutor,
  eingabe: { id: string; content: string; category?: string | null; pinned?: boolean },
): Promise<MemberNoteView> {
  const guildId = await resolveGuildId();
  const vorhanden = await prisma.memberNote.findFirst({ where: { id: eingabe.id, guildId } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Notiz gibt es nicht.' });
  }

  const eigene = vorhanden.authorDiscordId === viewer.discordId;
  const darf = eigene
    ? viewer.can(MEMBER_PERMISSIONS.notesCreate) || viewer.can(MEMBER_PERMISSIONS.notesEdit)
    : viewer.can(MEMBER_PERMISSIONS.notesEdit);
  if (!darf) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst diese Notiz nicht bearbeiten.' });
  }

  const { content, category } = pruefeInhalt(eingabe.content, eingabe.category);
  const geaendert = content !== vorhanden.content;

  const notiz = await prisma.memberNote.update({
    where: { id: vorhanden.id },
    data: {
      content,
      category,
      ...(eingabe.pinned === undefined ? {} : { pinned: eingabe.pinned }),
      // Nur wenn sich der Text wirklich geaendert hat - Anheften ist keine
      // Bearbeitung, und «bearbeitet» soll etwas heissen.
      ...(geaendert ? { editedAt: new Date() } : {}),
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MEMBER_NOTE_UPDATED,
    module: 'members',
    actorDiscordId: autor.discordId,
    actorUsername: autor.username,
    targetDiscordId: vorhanden.targetDiscordId,
    metadata: { noteId: notiz.id, fremd: !eigene, textGeaendert: geaendert },
  });

  return ansicht(notiz, viewer);
}

/** Loescht eine Notiz. */
export async function deleteMemberNote(
  viewer: MemberViewer,
  autor: NotizAutor,
  id: string,
): Promise<void> {
  if (!viewer.can(MEMBER_PERMISSIONS.notesDelete)) {
    throw new AppError('FORBIDDEN', { userMessage: 'Du darfst keine Notizen löschen.' });
  }
  const guildId = await resolveGuildId();
  const vorhanden = await prisma.memberNote.findFirst({ where: { id, guildId } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Notiz gibt es nicht.' });
  }

  await prisma.memberNote.delete({ where: { id: vorhanden.id } });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.MEMBER_NOTE_DELETED,
    module: 'members',
    actorDiscordId: autor.discordId,
    actorUsername: autor.username,
    targetDiscordId: vorhanden.targetDiscordId,
    metadata: { noteId: id, fremd: vorhanden.authorDiscordId !== viewer.discordId },
  });
}

/** Wie viele Notizen es gibt - nur fuer Berechtigte. */
export async function countMemberNotes(
  viewer: MemberViewer,
  targetDiscordId: string,
  guildId: string,
): Promise<number> {
  if (!darfSehen(viewer, 'notes', targetDiscordId)) {
    return 0;
  }
  return prisma.memberNote.count({ where: { guildId, targetDiscordId } });
}
