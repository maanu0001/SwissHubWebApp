import { ADMIN_FULL, listPermissions, type PermissionDefinition } from './registry';

/**
 * Berechtigungs-Vorlagen.
 *
 * Vorlagen ersetzen das manuelle Zusammenklicken einzelner Berechtigungen für
 * die häufigen Fälle. Sie werden beim Anwenden zu konkreten Permissions
 * aufgelöst - gespeichert wird also immer die explizite Liste, nie die Vorlage.
 * Dadurch bleibt nachvollziehbar, was eine Rolle tatsächlich darf.
 */
export interface PermissionPreset {
  id: string;
  label: string;
  description: string;
  /** Konkrete Permissions; `*` steht für "alle bekannten Berechtigungen". */
  permissions: string[];
  /** Vorschlag für die Moderationsstufe (Rollenhierarchie der Anwendung). */
  moderationLevel: number;
  critical?: boolean;
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'viewer',
    label: 'Nur Lesen',
    description: 'Dashboard, Mitglieder und Moderationshistorie ansehen - keine Aktionen.',
    permissions: ['dashboard.view', 'members.view', 'moderation.view', 'jail.view'],
    moderationLevel: 10,
  },
  {
    id: 'mitglied',
    label: 'Mitglied',
    description:
      'Die gewöhnliche Mitgliederrolle: eigenes Profil, eigenes Level, eigene Tickets, Spielersuche, Turniere, Talks und Musik. Sieht ausschliesslich die eigenen Daten - keine fremden Profile, keine Moderation, keine internen Notizen, keine Verwaltung.',
    permissions: [
      // Eine Vorlage ersetzt die Berechtigungen einer Rolle vollstaendig.
      // Deshalb steht hier alles, was ein gewoehnliches Mitglied taeglich
      // braucht - nicht nur der Member-Center-Teil. Eine Vorlage, die nur
      // einen Ausschnitt enthaelt, nimmt der Rolle beim Anwenden alles
      // uebrige weg, und das faellt erst auf, wenn jemand etwas nicht mehr
      // kann, das er gestern noch konnte.
      'dashboard.view',

      // Member Center - ausschliesslich die eigenen Daten.
      'members.view.basic.own',
      'members.view.roles.own',
      'members.view.activity.own',
      'members.view.level.own',
      'members.view.spielersuche.own',
      'members.view.tournaments.own',
      'members.view.tickets.own',
      'members.view.premium.own',

      // Spielersuche: eine eroeffnen, einer beitreten, die eigene schliessen.
      'spielersuche.view',
      'spielersuche.create',
      'spielersuche.join',
      'spielersuche.closeOwn',
      'spielersuche.stats.viewOwn',

      // Tickets: ein eigenes eroeffnen und die eigenen lesen. Ausdruecklich
      // nicht `tickets.view` - das ist die Support-Sicht auf fremde.
      'tickets.create',
      'tickets.viewOwn',

      // Level: den eigenen Stand, die Rangliste, die Spiele mitspielen.
      'level.view',
      'level.leaderboard.view',
      'level.games.view',
      'level.games.play.basic',
      'level.raffle.view',
      'level.raffle.participate',

      // Turniere: ansehen und teilnehmen.
      'tournaments.view',
      'tournaments.participate',

      // Premium: ausschliesslich das eigene Abo. `premium.view` waere hier
      // falsch - trotz des Namens oeffnet es die Verwaltungssicht auf alle
      // Abonnements, auf die Uebersicht und auf die Stuebli-Verwaltung.
      'premium.self',

      // Voice Hub: einen eigenen Talk oeffnen und ihn verwalten.
      'voiceHub.view',
      'voiceHub.use',
      'voiceHub.manageOwn',
      'voiceHub.manageUsers',
      'voiceHub.transferOwnership',

      // Musik: die eigene Session. Ohne `sessions.manageAll`, ohne Worker
      // und ohne Einstellungen - das ist Verwaltung.
      'music.view',
      'music.play',
      'music.queue.manage',
      'music.skip',
      'music.pause',
      'music.loop',
      'music.volume',
      'music.session.start',
      'music.session.stop',
    ],
    // Null heisst hier: keine Moderationsstufe. Ein gewoehnliches Mitglied
    // steht in der Rollenhierarchie der Anwendung ganz unten.
    moderationLevel: 0,
  },
  {
    id: 'moderator',
    label: 'Moderator',
    description: 'Darf Mitglieder jailen und wieder freigeben, aber nichts konfigurieren.',
    permissions: [
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.execute',
      'jail.view',
      'jail.create',
      'jail.release',
      // Die Mitgliederakte, soweit sie zur Moderation gehoert. Premium- und
      // XP-Verwaltung sind ausdruecklich nicht dabei.
      'members.view.basic.all',
      'members.view.roles.all',
      'members.view.activity.all',
      'members.view.moderation.all',
      'members.view.notes.all',
      'members.notes.create',
    ],
    moderationLevel: 50,
  },
  {
    id: 'senior-moderator',
    label: 'Senior Moderator',
    description: 'Moderation inklusive Audit Log und Verlängerung laufender Massnahmen.',
    permissions: [
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.execute',
      'audit.view',
      'settings.view',
      'jail.view',
      'jail.create',
      'jail.release',
      // Frueher stand hier `jail.extend` - diese Berechtigung gibt es nicht.
      // Sie fiel beim Aufloesen stillschweigend weg, und die Vorlage hielt
      // ihr eigenes Versprechen nicht: der Senior Moderator bekam die
      // Verlaengerung nie. Der richtige Schluessel heisst `jail.edit`.
      'jail.edit',
    ],
    moderationLevel: 70,
  },
  {
    id: 'level-team',
    label: 'Level-Team',
    description:
      'XP vergeben und entziehen, Level-Rollen und XP-Regeln pflegen. Ersetzt die frühere Level-Manager-Rolle.',
    permissions: [
      'dashboard.view',
      'members.view',
      'level.view',
      'level.members.view',
      'level.members.manage',
      'level.leaderboard.view',
      'level.games.view',
      'level.games.play.basic',
      'level.games.play.advanced',
      'level.games.manage',
      'level.roles.view',
      'level.roles.manage',
      'level.rules.manage',
      'level.decay.manage',
      'level.stats.view',
      'level.settings.view',
      'level.settings.manage',
    ],
    moderationLevel: 50,
  },
  {
    id: 'support-team',
    label: 'Support-Team',
    description:
      'Tickets bearbeiten: antworten, übernehmen, Status setzen, schliessen. Interne Notizen inbegriffen - Kategorien, Panels und Einstellungen nicht.',
    permissions: [
      'dashboard.view',
      'members.view',
      'tickets.view',
      'tickets.viewOwn',
      'tickets.create',
      'tickets.support.view',
      'tickets.support.reply',
      'tickets.support.claim',
      'tickets.support.assign',
      'tickets.support.changeStatus',
      'tickets.support.changePriority',
      'tickets.support.manageTags',
      'tickets.support.addUser',
      'tickets.support.removeUser',
      'tickets.support.close',
      'tickets.support.reopen',
      'tickets.notes.view',
      'tickets.notes.create',
      'tickets.archive.view',
      'tickets.transcript.view',
      'tickets.stats.view',
    ],
    moderationLevel: 40,
  },
  {
    id: 'administrator',
    label: 'Administrator',
    description: 'Vollzugriff inklusive Berechtigungen, Module und Systemfunktionen.',
    permissions: [ADMIN_FULL],
    moderationLevel: 100,
    critical: true,
  },
];

export function getPermissionPreset(id: string): PermissionPreset | undefined {
  return PERMISSION_PRESETS.find((preset) => preset.id === id);
}

/**
 * Löst eine Vorlage gegen die tatsächlich registrierten Permissions auf.
 * Unbekannte Einträge (z.B. aus einer entfernten Berechtigung) fallen weg.
 *
 * Fällt dabei *alles* weg, ist das kein leeres Ergebnis, sondern ein Fehler.
 * Die Registry füllt sich, sobald `@swisshub/modules` geladen ist; wer sie
 * vorher fragt, sieht nur die Kern-Berechtigungen. Eine Vorlage wie
 * «Mitglied», die ausschliesslich aus Modul-Berechtigungen besteht, käme dann
 * als leere Liste zurück - und der Aufrufer, der damit eine Rolle setzt,
 * löscht ihr sämtliche Berechtigungen und vergibt keine neue. Eine Rolle, die
 * nach dem Anwenden einer Vorlage gar nichts mehr darf, ist der denkbar
 * schlechteste stille Ausgang.
 */
export function resolvePreset(preset: PermissionPreset): string[] {
  const known = new Set(listPermissions().map((definition) => definition.key));
  if (preset.permissions.includes('*')) {
    return [...known];
  }
  const aufgeloest = preset.permissions.filter((permission) => known.has(permission));

  if (preset.permissions.length > 0 && aufgeloest.length === 0) {
    throw new Error(
      `Die Vorlage «${preset.label}» liess sich gegen keine bekannte Berechtigung auflösen. ` +
        'Vermutlich wurde die Module Registry noch nicht geladen (Import von `@swisshub/modules`).',
    );
  }

  return aufgeloest;
}

/** Vorlage, die exakt zur aktuellen Auswahl passt (für die Anzeige). */
export function matchPreset(permissions: readonly string[]): PermissionPreset | undefined {
  const selected = [...permissions].sort().join(',');
  return PERMISSION_PRESETS.find((preset) => resolvePreset(preset).sort().join(',') === selected);
}

/** Permissions für die Matrix-Darstellung, nach Modul gruppiert und sortiert. */
export function permissionMatrixColumns(): PermissionDefinition[] {
  return listPermissions().filter((definition) => definition.key !== ADMIN_FULL);
}
