import { MEMBER_PERMISSIONS, type MemberScope } from '@swisshub/permissions';

/**
 * Wer im Member Center was sehen darf.
 *
 * Eine Stelle statt einer Pruefung je Seite und je Aktion. Das ist nicht
 * Bequemlichkeit: eine vergessene Pruefung in einem von zehn Abschnitten ist
 * genau die Luecke, durch die jemand die Moderationsakte eines anderen liest.
 *
 * Die Aufloesung geschieht *vor* dem Laden. Der Aggregator fragt hier, was
 * erlaubt ist, und laedt danach nur das - nicht umgekehrt. Alles zu laden und
 * hinterher wegzulassen waere dieselbe Datenbankabfrage, dieselbe Discord-
 * Anfrage und im Fehlerfall dieselbe Zeile im Log ueber Daten, die der
 * Betrachter nie haette anfassen duerfen.
 */

/** Was die Zugriffspruefung ueber die aufrufende Person wissen muss. */
export interface MemberViewer {
  discordId: string;
  /** Aktuelle Discord-Rollen - fuer Zustaendigkeiten und Rollenhoehe. */
  roleIds: string[];
  /** Prueft eine Berechtigung im zentralen System. */
  can(permission: string): boolean;
}

/** Die Abschnitte eines Mitgliedsprofils. */
export const MEMBER_SECTIONS = [
  'basic',
  'roles',
  'activity',
  'level',
  'spielersuche',
  'tournaments',
  'tickets',
  'premium',
  'moderation',
  'appeals',
  'notes',
] as const;

export type MemberSection = (typeof MEMBER_SECTIONS)[number];

/** Die Schluessel je Abschnitt, nach Geltungsbereich geordnet. */
const SCHLUESSEL: Record<MemberSection, { own?: string; assigned?: string; all?: string }> = {
  basic: { own: MEMBER_PERMISSIONS.basicOwn, all: MEMBER_PERMISSIONS.basicAll },
  roles: { own: MEMBER_PERMISSIONS.rolesOwn, all: MEMBER_PERMISSIONS.rolesAll },
  activity: { own: MEMBER_PERMISSIONS.activityOwn, all: MEMBER_PERMISSIONS.activityAll },
  level: { own: MEMBER_PERMISSIONS.levelOwn, all: MEMBER_PERMISSIONS.levelAll },
  spielersuche: {
    own: MEMBER_PERMISSIONS.spielersucheOwn,
    all: MEMBER_PERMISSIONS.spielersucheAll,
  },
  tournaments: { own: MEMBER_PERMISSIONS.tournamentsOwn, all: MEMBER_PERMISSIONS.tournamentsAll },
  tickets: {
    own: MEMBER_PERMISSIONS.ticketsOwn,
    assigned: MEMBER_PERMISSIONS.ticketsAssigned,
    all: MEMBER_PERMISSIONS.ticketsAll,
  },
  premium: { own: MEMBER_PERMISSIONS.premiumOwn, all: MEMBER_PERMISSIONS.premiumAll },
  // Bewusst ohne `own`: was intern ueber jemanden vermerkt ist, ist kein
  // Selbstbedienungsdatum.
  moderation: { all: MEMBER_PERMISSIONS.moderationAll },
  // Ebenfalls ohne `own`: die eigenen Antraege sieht ein Mitglied in seinem
  // Antragsbereich, und wer gebannt ist, kommt gar nicht bis hierher.
  appeals: { all: MEMBER_PERMISSIONS.appealsAll },
  notes: { all: MEMBER_PERMISSIONS.notesAll },
};

/**
 * Bruecken zu Berechtigungen, die es vor dem Member Center schon gab.
 *
 * Ohne sie verlaeren Rollen, die heute Jail-Verlauf und Moderationshistorie
 * sehen duerfen, diesen Zugang beim ersten Deployment - und niemand haette es
 * angeordnet. Die Bruecke wirkt nur in die Richtung «war schon erlaubt»: sie
 * vergibt nichts, was die Rolle nicht ohnehin an anderer Stelle sehen darf.
 */
const ALTBESTAND: Partial<Record<MemberSection, string[]>> = {
  moderation: ['moderation.view', 'jail.view'],
};

/**
 * Der Geltungsbereich eines Abschnitts fuer diesen Betrachter.
 *
 * `ALL` schlaegt `ASSIGNED` schlaegt `OWN` - wer alles sehen darf, soll nicht
 * an der eigenen Zeile scheitern.
 */
export function sectionScope(viewer: MemberViewer, section: MemberSection): MemberScope {
  const schluessel = SCHLUESSEL[section];

  if (schluessel.all !== undefined && viewer.can(schluessel.all)) {
    return 'ALL';
  }
  for (const alt of ALTBESTAND[section] ?? []) {
    if (viewer.can(alt)) {
      return 'ALL';
    }
  }
  if (schluessel.assigned !== undefined && viewer.can(schluessel.assigned)) {
    return 'ASSIGNED';
  }
  if (schluessel.own !== undefined && viewer.can(schluessel.own)) {
    return 'OWN';
  }
  return 'NONE';
}

/**
 * Darf dieser Betrachter diesen Abschnitt bei dieser Person sehen?
 *
 * Hier faellt die Entscheidung, gegen die eine geaenderte Adresszeile nichts
 * ausrichtet: bei `OWN` muss das Ziel der Betrachter selbst sein, und das
 * prueft der Server, nicht der Browser.
 */
export function darfSehen(viewer: MemberViewer, section: MemberSection, targetDiscordId: string): boolean {
  const scope = sectionScope(viewer, section);
  if (scope === 'NONE') {
    return false;
  }
  if (scope === 'ALL') {
    return true;
  }
  // `ASSIGNED` heisst nicht «dieses Profil», sondern «diese Datensaetze». Wer
  // zugewiesene Tickets sehen darf, darf den Abschnitt oeffnen; welche
  // Tickets darin stehen, entscheidet das Ticketmodul.
  if (scope === 'ASSIGNED') {
    return true;
  }
  return targetDiscordId === viewer.discordId;
}

/** Was dieser Betrachter bei dieser Person tun darf. */
export interface MemberCapabilities {
  canManageRoles: boolean;
  canManageXp: boolean;
  canModerate: boolean;
  canJail: boolean;
  canReleaseJail: boolean;
  canCreateTicket: boolean;
  canManagePremium: boolean;
  canCreateNote: boolean;
  canEditForeignNotes: boolean;
  canDeleteNotes: boolean;
}

/**
 * Die Handlungen, die das Profil anbieten darf.
 *
 * Ausschliesslich fuer die Oberflaeche: sie entscheidet damit, welche
 * Schaltflaeche sie zeichnet. Ob eine Handlung tatsaechlich ausgefuehrt wird,
 * entscheidet die jeweilige Aktion noch einmal selbst - diese Kennzeichen sind
 * eine Bequemlichkeit, keine Sicherung.
 *
 * Fuer Handlungen, die es im System schon gibt, stehen hier die bestehenden
 * Berechtigungen. Ein eigener Member-Center-Schluessel fuer «jailen» waere ein
 * zweiter Schalter fuer dieselbe Tuer.
 */
export function memberCapabilities(
  viewer: MemberViewer,
  target: { discordId: string; isBot: boolean },
): MemberCapabilities {
  const selbst = target.discordId === viewer.discordId;

  return {
    // Niemand vergibt sich selbst Rollen ueber das Member Center. Das ist
    // nicht die einzige Sperre - die Rollenhoehe prueft der Dienst - aber es
    // ist die erste und die klarste.
    canManageRoles: viewer.can(MEMBER_PERMISSIONS.rolesManage) && !selbst && !target.isBot,
    canManageXp: viewer.can('level.members.manage') && !target.isBot,
    canModerate: viewer.can('moderation.execute') && !selbst && !target.isBot,
    canJail: viewer.can('jail.create') && !selbst && !target.isBot,
    canReleaseJail: viewer.can('jail.release') && !target.isBot,
    canCreateTicket: viewer.can('tickets.admin.createForUser') && !target.isBot,
    canManagePremium: viewer.can('premium.subscriptions.manage') && !target.isBot,
    canCreateNote: viewer.can(MEMBER_PERMISSIONS.notesCreate) && !target.isBot,
    canEditForeignNotes: viewer.can(MEMBER_PERMISSIONS.notesEdit),
    canDeleteNotes: viewer.can(MEMBER_PERMISSIONS.notesDelete),
  };
}

/**
 * Darf dieser Betrachter das Profil ueberhaupt oeffnen?
 *
 * Zwei Wege fuehren hinein: die bestehende Berechtigung fuer den
 * Mitgliederbereich - oder das eigene Profil, sofern ueberhaupt ein Abschnitt
 * davon freigegeben ist. Ohne den zweiten Weg koennte ein gewoehnliches
 * Mitglied sein eigenes Level nicht sehen, ohne zugleich die Mitgliedersuche
 * zu bekommen.
 */
export function darfProfilOeffnen(viewer: MemberViewer, targetDiscordId: string): boolean {
  if (viewer.can(MEMBER_PERMISSIONS.view) || viewer.can(MEMBER_PERMISSIONS.basicAll)) {
    return true;
  }
  return MEMBER_SECTIONS.some((section) => darfSehen(viewer, section, targetDiscordId));
}
