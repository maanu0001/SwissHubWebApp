import type { PermissionDefinition } from './registry';

/**
 * Berechtigungen des Member Center.
 *
 * Das Member Center zeigt zu einer Person zusammen, was sonst ueber ein Dutzend
 * Seiten verteilt liegt - Level, Tickets, Turniere, Premium, Moderation. Genau
 * deshalb reicht ein einziges `members.view` hier nicht mehr: wer Mitglieder
 * suchen darf, darf damit nicht automatisch die Moderationsakte lesen.
 *
 * ## Geltungsbereiche als eigene Schluessel
 *
 * Ein Geltungsbereich (`own`, `assigned`, `all`) steht als Endung im Schluessel
 * und nicht als zusaetzliche Spalte an der Rolle-Berechtigung-Zuordnung.
 *
 * Das ist Absicht. Eine Spalte haette die Zuordnungstabelle, die Permission
 * Engine, die Vorlagen und die Berechtigungsoberflaeche gleichzeitig geaendert -
 * also faktisch eine zweite Engine neben der bestehenden. Als Schluessel
 * dagegen funktioniert alles Vorhandene unveraendert weiter: `hasPermission`,
 * die Praefix-Platzhalter (`members.*`), `admin.full`, die Speicherung und die
 * Oberflaeche, in der Rollen konfiguriert werden.
 *
 * `NONE` braucht keinen Schluessel - es ist die Abwesenheit aller anderen und
 * damit die Voreinstellung. Sensible Bereiche sind dadurch von sich aus
 * gesperrt und nicht erst durch eine Regel, die jemand setzen muesste.
 *
 * ## Nicht jeder Bereich bekommt jeden Geltungsbereich
 *
 * Moderation kennt nur `all`: eine Moderationsakte ueber sich selbst einsehen
 * zu duerfen klingt harmlos, verraet aber, was intern vermerkt ist, und
 * beeinflusst, wie sich jemand verhaelt. Interne Notizen ebenso - ein
 * Zuweisungssystem gibt es fuer sie nicht, also gibt es auch kein `assigned`.
 * Tickets kennen `assigned`, weil das Ticketmodul bereits eine echte
 * Zustaendigkeit fuehrt.
 *
 * ## Was hier bewusst fehlt
 *
 * Fuer Aktionen, die es im System laengst gibt, entstehen keine neuen
 * Schluessel. Moderieren bleibt `moderation.execute`, jailen `jail.create`,
 * XP vergeben `level.members.manage`, Premium verwalten
 * `premium.subscriptions.manage`, ein Ticket fuer jemanden eroeffnen
 * `tickets.admin.createForUser`. Ein zweiter Schluessel fuer dieselbe Handlung
 * waere eine zweite Wahrheit - und irgendwann widersprechen sie sich.
 */

/** Geltungsbereich einer Member-Center-Berechtigung. */
export type MemberScope = 'NONE' | 'OWN' | 'ASSIGNED' | 'ALL';

export const MEMBER_PERMISSIONS = {
  /**
   * Bestehende Berechtigung, unveraendert: Mitgliederbereich oeffnen und
   * suchen. Sie bleibt der Eintritt ins Member Center.
   */
  view: 'members.view',

  basicOwn: 'members.view.basic.own',
  basicAll: 'members.view.basic.all',

  rolesOwn: 'members.view.roles.own',
  rolesAll: 'members.view.roles.all',

  activityOwn: 'members.view.activity.own',
  activityAll: 'members.view.activity.all',

  levelOwn: 'members.view.level.own',
  levelAll: 'members.view.level.all',

  spielersucheOwn: 'members.view.spielersuche.own',
  spielersucheAll: 'members.view.spielersuche.all',

  tournamentsOwn: 'members.view.tournaments.own',
  tournamentsAll: 'members.view.tournaments.all',

  ticketsOwn: 'members.view.tickets.own',
  ticketsAssigned: 'members.view.tickets.assigned',
  ticketsAll: 'members.view.tickets.all',

  premiumOwn: 'members.view.premium.own',
  premiumAll: 'members.view.premium.all',

  /**
   * Entbannungsantraege im Profil.
   *
   * Nur `all`: die eigenen Antraege sieht ein Mitglied ohnehin in seinem
   * Antragsbereich, und wer gebannt ist, kommt gar nicht bis ins Member
   * Center. Ein `own` waere eine Berechtigung fuer einen Fall, den es nicht
   * gibt.
   */
  appealsAll: 'members.view.appeals.all',

  /** Nur `all` - siehe oben. */
  moderationAll: 'members.view.moderation.all',
  notesAll: 'members.view.notes.all',

  rolesManage: 'members.roles.manage',
  notesCreate: 'members.notes.create',
  notesEdit: 'members.notes.edit',
  notesDelete: 'members.notes.delete',
} as const;

const sicht = (
  key: string,
  label: string,
  description: string,
  critical?: boolean,
): PermissionDefinition => ({
  key,
  label,
  description,
  module: 'members',
  ...(critical ? { critical } : {}),
});

/**
 * Die Beschriftungen sind bewusst in der Sprache der Sache und nicht in der des
 * Schluessels: wer Rollen konfiguriert, soll lesen koennen, was er vergibt.
 */
export const MEMBER_CENTER_PERMISSIONS: PermissionDefinition[] = [
  sicht(
    MEMBER_PERMISSIONS.basicOwn,
    'Eigenes Basisprofil ansehen',
    'Das eigene Profil mit Name, Avatar, Beitritt und Discord-Konto öffnen.',
  ),
  sicht(MEMBER_PERMISSIONS.basicAll, 'Basisprofile aller ansehen', 'Das Basisprofil jedes Mitglieds öffnen.'),
  sicht(MEMBER_PERMISSIONS.rolesOwn, 'Eigene Rollen ansehen', 'Die eigenen Discord-Rollen sehen.'),
  sicht(MEMBER_PERMISSIONS.rolesAll, 'Rollen aller ansehen', 'Die Discord-Rollen jedes Mitglieds sehen.'),
  sicht(
    MEMBER_PERMISSIONS.activityOwn,
    'Eigene Aktivität ansehen',
    'Die eigene Aktivität der letzten Wochen sehen.',
  ),
  sicht(MEMBER_PERMISSIONS.activityAll, 'Aktivität aller ansehen', 'Die Aktivität jedes Mitglieds sehen.'),
  sicht(MEMBER_PERMISSIONS.levelOwn, 'Eigenes Level ansehen', 'Eigenes Level, XP und Rang sehen.'),
  sicht(MEMBER_PERMISSIONS.levelAll, 'Level aller ansehen', 'Level, XP und Rang jedes Mitglieds sehen.'),
  sicht(
    MEMBER_PERMISSIONS.spielersucheOwn,
    'Eigene Spielersuchen ansehen',
    'Die eigenen Spielersuchen und Statistiken sehen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.spielersucheAll,
    'Spielersuchen aller ansehen',
    'Die Spielersuchen jedes Mitglieds sehen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.tournamentsOwn,
    'Eigene Turniere ansehen',
    'Die eigenen Turnierteilnahmen und Platzierungen sehen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.tournamentsAll,
    'Turniere aller ansehen',
    'Die Turnierteilnahmen jedes Mitglieds sehen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.ticketsOwn,
    'Eigene Tickets ansehen',
    'Die selbst eröffneten Tickets im Profil sehen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.ticketsAssigned,
    'Zugewiesene Tickets ansehen',
    'Im Profil die Tickets sehen, für die man selbst zuständig ist.',
  ),
  sicht(
    MEMBER_PERMISSIONS.ticketsAll,
    'Tickets aller ansehen',
    'Im Profil alle Tickets eines Mitglieds sehen. Der Nachrichtenverlauf bleibt davon unberührt - dafür gelten die Ticket-Berechtigungen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.premiumOwn,
    'Eigenen Premium-Status ansehen',
    'Den eigenen Premium-Status und dessen Laufzeit sehen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.premiumAll,
    'Premium-Status aller ansehen',
    'Den Premium-Status jedes Mitglieds sehen. Zahlungsdaten sind nicht enthalten.',
  ),
  sicht(
    MEMBER_PERMISSIONS.moderationAll,
    'Moderation im Profil ansehen',
    'Jail-Verlauf, Verwarnungen und Moderationsmassnahmen im Mitgliedsprofil einsehen.',
    true,
  ),
  sicht(
    MEMBER_PERMISSIONS.appealsAll,
    'Entbannungsanträge ansehen',
    'Die Entbannungsanträge eines Mitglieds im Profil sehen - Datum, Zustand und Ergebnis.',
  ),
  sicht(
    MEMBER_PERMISSIONS.notesAll,
    'Interne Notizen ansehen',
    'Die internen Staff-Notizen zu einem Mitglied lesen. Sie sind für Mitglieder nicht sichtbar.',
    true,
  ),
  sicht(
    MEMBER_PERMISSIONS.rolesManage,
    'Discord-Rollen verwalten',
    'Mitgliedern Rollen geben oder nehmen - begrenzt durch die eigene Rollenhöhe und die des Bots.',
    true,
  ),
  sicht(
    MEMBER_PERMISSIONS.notesCreate,
    'Interne Notiz schreiben',
    'Eine interne Staff-Notiz zu einem Mitglied anlegen.',
  ),
  sicht(
    MEMBER_PERMISSIONS.notesEdit,
    'Fremde Notizen bearbeiten',
    'Notizen anderer bearbeiten. Die eigenen darf jeder bearbeiten, der Notizen schreiben darf.',
    true,
  ),
  sicht(MEMBER_PERMISSIONS.notesDelete, 'Notizen löschen', 'Interne Notizen löschen.', true),
];
