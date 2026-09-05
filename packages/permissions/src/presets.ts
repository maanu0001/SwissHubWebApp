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

/**
 * Was ein gewöhnliches Mitglied täglich braucht.
 *
 * Eigene Konstante, weil «Premium» und «Prestige» genau das plus ein paar
 * Zusätze sind. Drei Listen nebeneinander wären drei Listen, die auseinander
 * laufen, sobald jemand einer davon etwas hinzufügt.
 *
 * Eine Vorlage ersetzt die Berechtigungen einer Rolle vollständig - deshalb
 * steht hier alles Alltägliche und nicht nur ein Ausschnitt. Eine Vorlage mit
 * einem Ausschnitt nähme der Rolle beim Anwenden alles Übrige weg, und das
 * fiele erst auf, wenn jemand etwas nicht mehr kann, das er gestern noch
 * konnte.
 */
const MITGLIED_BASIS: string[] = [
  // «Modul sehen»: der Schluessel, der einen Bereich ueberhaupt in der
  // Seitenleiste erscheinen laesst. Er steht neben jeder Berechtigung, die
  // ihn braucht - eine Vorlage ersetzt die Rechte einer Rolle vollstaendig,
  // und eine Vorlage ohne diese Schluessel setzte eine Rolle auf eine leere
  // Navigation.
  'dashboard.module.view',
  'members.module.view',
  'spielersuche.module.view',
  'tickets.module.view',
  'level.module.view',
  'tournaments.module.view',
  'premium.module.view',
  'voiceHub.module.view',

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

  // Musik steht bewusst nicht hier: sie ist auf diesem Server eine
  // Premium-Sache. Wer sie allen geben will, nimmt die Vorlage «Premium»
  // als Vorbild oder hakt die Musikrechte von Hand an - beides geht im
  // Dashboard, ohne dass jemand Code anfassen muss.
];

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'viewer',
    label: 'Nur Lesen',
    description: 'Dashboard, Mitglieder und Moderationshistorie ansehen - keine Aktionen.',
    permissions: [
      'dashboard.module.view',
      'members.module.view',
      'moderation.module.view',
      'jail.module.view',
      'dashboard.view',
      'members.view',
      'moderation.view',
      'jail.view',
    ],
    moderationLevel: 10,
  },
  {
    id: 'mitglied',
    label: 'Mitglied',
    description:
      'Die gewöhnliche Mitgliederrolle: eigenes Profil, eigenes Level, eigene Tickets, Spielersuche, Turniere und eigene Talks. Sieht ausschliesslich die eigenen Daten - keine fremden Profile, keine Moderation, keine internen Notizen, keine Verwaltung. Musik und eigene Levelkarte stehen in den Vorlagen «Premium» und «Prestige».',
    permissions: [...MITGLIED_BASIS],
    // Null heisst hier: keine Moderationsstufe. Ein gewoehnliches Mitglied
    // steht in der Rollenhierarchie der Anwendung ganz unten.
    moderationLevel: 0,
  },
  {
    id: 'premium',
    label: 'Premium',
    description:
      'Alles wie ein gewöhnliches Mitglied, dazu Musik und eine eigene Levelkarte. Keine Verwaltung - die Vorlage ist für zahlende Mitglieder, nicht für das Team.',
    permissions: [
      ...MITGLIED_BASIS,
      // Musik: die eigene Session. Ohne `sessions.manageAll`, ohne Worker und
      // ohne Einstellungen - das wäre Verwaltung.
      'music.module.view',
      'music.view',
      'music.play',
      'music.queue.manage',
      'music.skip',
      'music.pause',
      'music.loop',
      'music.volume',
      'music.session.start',
      'music.session.stop',
      // Die eigene Levelkarte.
      'level.card.custom',
      // Vote Jail: eine Abstimmung starten und mitstimmen. Ausdruecklich
      // keine Moderationsbefugnis - der Jail entsteht erst, wenn genug
      // Stimmen zusammenkommen, und die Schutzregeln fuer das Ziel gelten
      // unveraendert. Ohne diesen Schluessel liess sich der Bereich zwar
      // oeffnen, aber keine Abstimmung starten.
      'jail.module.view',
      'jail.vote.start',
    ],
    moderationLevel: 0,
  },
  {
    id: 'prestige',
    label: 'Prestige',
    description:
      'Wie Premium. Eigene Vorlage, damit sich die beiden Stufen später unabhängig voneinander ändern lassen, ohne dass jemand die eine mit der anderen verwechselt.',
    permissions: [
      ...MITGLIED_BASIS,
      'music.module.view',
      'music.view',
      'music.play',
      'music.queue.manage',
      'music.skip',
      'music.pause',
      'music.loop',
      'music.volume',
      'music.session.start',
      'music.session.stop',
      'level.card.custom',
      'jail.module.view',
      'jail.vote.start',
    ],
    moderationLevel: 0,
  },
  {
    id: 'moderator',
    label: 'Moderator',
    description:
      'Timeout, Kick und Jail sowie die Moderationsakte. Bannen bleibt dem Senior Moderator vorbehalten.',
    permissions: [
      'dashboard.module.view',
      'members.module.view',
      'moderation.module.view',
      'jail.module.view',
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.execute',
      // Die taeglichen Massnahmen. Bann und Entbannung fehlen bewusst: sie
      // sind die schwersten Eingriffe und liegen beim Senior Moderator.
      'moderation.timeout',
      'moderation.timeout.remove',
      'moderation.kick',
      'moderation.history.view',
      'moderation.notes.create',
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
    description:
      'Alle Massnahmen inklusive Bann und Entbannung, dazu Audit Log und Verlängerung laufender Massnahmen.',
    permissions: [
      'dashboard.module.view',
      'members.module.view',
      'moderation.module.view',
      'jail.module.view',
      'audit.module.view',
      'settings.module.view',
      'analytics.module.view',
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.execute',
      'moderation.timeout',
      'moderation.timeout.remove',
      'moderation.kick',
      // Was den Moderator vom Senior Moderator unterscheidet: der Bann.
      'moderation.ban',
      'moderation.unban',
      'moderation.history.view',
      'moderation.notes.create',
      'audit.view',
      'settings.view',
      // Der Verlauf der Server-Ereignisse - ohne Nachrichteninhalte. Wer
      // gelöschte Texte lesen darf, bekommt `analytics.content.view` einzeln
      // zugewiesen; das ist keine Vorlagenentscheidung.
      'analytics.view',
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
      'dashboard.module.view',
      'members.module.view',
      'level.module.view',
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
      'dashboard.module.view',
      'members.module.view',
      'tickets.module.view',
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

/**
 * Eine Rolle, die aus einer Vorlage stammt, aber nicht mehr alles hat.
 *
 * Der Grund, weshalb es das gibt: eine Vorlage wird genau einmal angewendet.
 * Danach stehen die Rechte als Zeilen in der Datenbank, und die sind ab dann
 * die Wahrheit. Wird die Vorlage spaeter ergaenzt, erreicht das die Rolle
 * nie - sie behaelt still den alten Stand.
 *
 * Genau so ist der Vote Jail fuer Premium liegengeblieben: die Vorlage hatte
 * das Recht, die Rolle nicht, und niemand konnte es sehen. Das hier macht es
 * sichtbar.
 *
 * Erkannt wird nur der eindeutige Fall: die Rechte der Rolle sind eine echte
 * Teilmenge genau einer Vorlage. Passt mehr als eine, ist es geraten - dann
 * lieber nichts melden als das Falsche.
 */
export interface VorlagenAbweichung {
  preset: PermissionPreset;
  /** Was die Vorlage inzwischen hat und die Rolle nicht. */
  fehlend: string[];
}

export function findPresetDrift(permissions: readonly string[]): VorlagenAbweichung | null {
  if (permissions.length === 0) {
    return null;
  }
  const vorhanden = new Set(permissions);

  const kandidaten = PERMISSION_PRESETS.map((preset) => {
    const aufgeloest = resolvePreset(preset);
    const fehlend = aufgeloest.filter((permission) => !vorhanden.has(permission));
    const ueberzaehlig = permissions.filter((permission) => !aufgeloest.includes(permission));
    return { preset, fehlend, ueberzaehlig };
  }).filter(
    // Eine echte Teilmenge: nichts Zusaetzliches, aber etwas fehlt. Wer der
    // Rolle von Hand etwas hinzugefuegt hat, hat sie bewusst von der Vorlage
    // geloest - dem wird nichts nachgetragen.
    (kandidat) => kandidat.ueberzaehlig.length === 0 && kandidat.fehlend.length > 0,
  );

  if (kandidaten.length === 0) {
    return null;
  }

  // Mehrere Vorlagen koennen passen, ohne dass die Aussage dadurch unklar
  // wird: «Premium» und «Prestige» sind heute Zeichen fuer Zeichen gleich.
  // Welche der beiden es war, weiss man dann nicht - was fehlt, aber schon,
  // und genau darum geht es hier.
  //
  // Erst wenn sich die Kandidaten darin unterscheiden, ist es geraten. Dann
  // lieber nichts melden als das Falsche.
  const schluessel = (fehlend: string[]): string => [...fehlend].sort().join(',');
  const ersteFehlend = schluessel(kandidaten[0]!.fehlend);
  if (kandidaten.some((kandidat) => schluessel(kandidat.fehlend) !== ersteFehlend)) {
    return null;
  }

  const treffer = kandidaten[0]!;
  return { preset: treffer.preset, fehlend: treffer.fehlend };
}

/** Permissions für die Matrix-Darstellung, nach Modul gruppiert und sortiert. */
export function permissionMatrixColumns(): PermissionDefinition[] {
  return listPermissions().filter((definition) => definition.key !== ADMIN_FULL);
}
