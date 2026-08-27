import 'server-only';
import { calendar, listCachedChannels, listCachedRoles } from '@swisshub/modules';
import type { EventFormularWerte } from '@/modules/calendar/components/event-formular';

/**
 * Auswahllisten fuer das Event-Formular.
 *
 * Kanaele und Rollen kommen aus dem bestehenden Discord-Abgleich - es gibt
 * keine zweite Quelle und keine fest eingetragenen Kennungen. Bei den Rollen
 * wird zusaetzlich gefiltert: angeboten wird nur, was in den
 * Moduleinstellungen zum Erwaehnen freigegeben ist. Ein Feld mit allen Rollen
 * waere ein Ping-Knopf fuer den ganzen Server.
 */
export interface FormularAuswahl {
  kanaele: Array<{ id: string; name: string }>;
  rollen: Array<{ id: string; name: string }>;
  kategorien: Array<{ id: string; name: string }>;
}

export async function formularAuswahl(): Promise<FormularAuswahl> {
  const settings = await calendar.calendarSettings();
  const [kanaele, rollen, kategorien] = await Promise.all([
    listCachedChannels({ kinds: ['text', 'voice'] }).catch(() => []),
    listCachedRoles().catch(() => []),
    calendar.listCategories(true).catch(() => []),
  ]);

  return {
    kanaele: kanaele.map((kanal) => ({
      id: kanal.id,
      name: kanal.parentName ? `${kanal.parentName} / ${kanal.name}` : kanal.name,
    })),
    rollen: rollen
      .filter((rolle) => settings.mentionableRoleIds.includes(rolle.id))
      .map((rolle) => ({ id: rolle.id, name: rolle.name })),
    kategorien: kategorien.map((eintrag) => ({ id: eintrag.id, name: eintrag.name })),
  };
}

/** Leeres Formular mit sinnvollen Vorgaben. */
export async function leereWerte(): Promise<EventFormularWerte> {
  const settings = await calendar.calendarSettings();
  return {
    title: '',
    description: '',
    shortDescription: '',
    categoryId: '',
    startAt: '',
    endAt: '',
    timezone: calendar.DEFAULT_TIMEZONE,
    allDay: false,
    locationKind: 'DISCORD',
    locationChannelId: '',
    locationVoiceId: '',
    locationUrl: '',
    locationName: '',
    locationAddress: '',
    bannerUrl: '',
    iconUrl: '',
    organizerDiscordIds: [],
    contactNote: '',
    registrationEnabled: false,
    capacity: 0,
    registrationClosesAt: '',
    waitlistEnabled: true,
    allowSelfCancel: true,
    cancelDeadlineAt: '',
    participantsPublic: true,
    announceOnDiscord: Boolean(settings.defaultAnnouncementChannelId),
    announcementChannelId: settings.defaultAnnouncementChannelId ?? '',
    mentionRoleId: '',
    reminderMinutes: settings.defaultReminderMinutes,
    reminderChannelId: '',
    reminderMentionRoleId: '',
    reminderMentionRegistrants: false,
    questions: [],
  };
}

/**
 * Ein Datum fuer `<input type="datetime-local">`.
 *
 * Das Feld kennt keine Zeitzone - es zeigt, was drinsteht. Deshalb wird der
 * UTC-Zeitpunkt in die Ortszeit des Events umgerechnet, sonst stuende dort
 * beim Bearbeiten eine andere Uhrzeit als auf der Detailseite.
 */
export function alsEingabewert(wert: Date | null, timezone: string): string {
  if (!wert) {
    return '';
  }
  const teile = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(wert);
  // `sv-SE` liefert bereits `YYYY-MM-DD HH:mm`; das Feld will ein `T`.
  return teile.replace(' ', 'T');
}
