import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { bootstrapConfig } from '@swisshub/config';
import { jail, moderation } from '@swisshub/modules';
import type { ModerationAbilities } from '@/modules/moderation/abilities';
import type { ModerationSection } from '@/modules/moderation/sections';
import { jailSections } from './jail';

/**
 * Die Uebersetzung vom Sitzungskontext in das, was das Moderation Center
 * erwartet.
 *
 * `roleIds` und `isOwner` kommen aus der geprueften Sitzung, nicht aus der
 * Anfrage - sie entscheiden die Rangfolge, und die darf niemand behaupten.
 */
export function moderationActor(context: AuthContext): moderation.ModerationActor {
  return {
    discordId: context.user.discordId,
    username: context.user.username,
    roleIds: context.roleIds,
    isOwner: bootstrapConfig.ownerDiscordId === context.user.discordId,
    can: (permission: string) => can(context, permission),
  };
}

/**
 * Unterseiten des Moderationsbereichs.
 *
 * Jeder Bereich haengt an seiner eigenen Berechtigung. Wer nur die Historie
 * lesen darf, sieht keine Schaltflaeche zum Bannen - und umgekehrt.
 */
export function moderationSections(context: AuthContext): ModerationSection[] {
  const p = moderation.MODERATION_PERMISSIONS;
  const sections: ModerationSection[] = [];

  if (can(context, p.view)) {
    sections.push(
      { href: '/moderation', label: 'Übersicht' },
      { href: '/moderation/verlauf', label: 'Verlauf' },
    );
  }
  if (can(context, p.ban) || can(context, p.unban)) {
    sections.push({ href: '/moderation/banns', label: 'Banns' });
  }

  // Jail steht hier, weil er hierher gehoert: eine Massnahme wie Bann, Kick
  // und Timeout. Er hatte nur historisch ein eigenes Hauptmodul, und das hiess
  // fuer das Team, bei jedem Vorgang zwischen zwei Bereichen zu waehlen.
  //
  // Die Eintraege haengen weiterhin an den Jail-Berechtigungen. Wer Moderation
  // darf, aber keinen Jail, sieht sie nicht - die Navigation aendert sich, die
  // Sicherheit nicht.
  for (const eintrag of jailSections(context)) {
    sections.push(eintrag);
  }

  if (can(context, p.settingsManage) || can(context, 'modules.manage')) {
    sections.push({ href: '/modules/moderation', label: 'Einstellungen' });
  }
  // Die Jail-Einstellungen sind eigene Einstellungen und bleiben es - sie
  // waeren in den Moderationseinstellungen ein Fremdkoerper. Erreichbar sind
  // sie aber von hier, statt nur ueber die Moduluebersicht.
  if (can(context, jail.JAIL_PERMISSIONS.settings) || can(context, 'modules.manage')) {
    sections.push({ href: '/modules/jail', label: 'Jail-Einstellungen' });
  }

  return sections;
}

/**
 * Welche Kennzahlen der Uebersicht dieser Betrachter sehen darf.
 *
 * Die Jail-Zahl haengt an der Jail-Berechtigung, nicht an der Moderation:
 * beides sind getrennte Module, und wer das eine darf, muss nicht das andere
 * duerfen.
 */
export function moderationOverviewScope(context: AuthContext): moderation.OverviewScope {
  const p = moderation.MODERATION_PERMISSIONS;
  return {
    moderation: can(context, p.view),
    jail: can(context, jail.JAIL_PERMISSIONS.view),
    banns: can(context, p.ban) || can(context, p.unban),
  };
}

/** Welche Massnahmen dieser Betrachter ausfuehren darf. */
export function moderationAbilities(context: AuthContext): ModerationAbilities {
  const p = moderation.MODERATION_PERMISSIONS;
  const abilities = {
    ban: can(context, p.ban),
    unban: can(context, p.unban),
    kick: can(context, p.kick),
    timeout: can(context, p.timeout),
    timeoutRemove: can(context, p.timeoutRemove),
    // Derselbe Schluessel wie in der Jail-Maske - ein zweiter waere ein
    // zweites Regelwerk fuer dieselbe Handlung.
    jail: can(context, jail.JAIL_PERMISSIONS.create),
    note: can(context, p.notesCreate),
  };
  return { ...abilities, any: Object.values(abilities).some(Boolean) };
}

export type { ModerationAbilities, ModerationSection };

/**
 * Die Grundvorlagen einer Massnahme.
 *
 * Eine Stelle für alle Masken - die Gründe stehen in den Moduleinstellungen
 * der Moderation, und jede Maske, die einen Grund erfragt, holt sie von hier.
 * Vorher entschied jede für sich, welche sie anbietet, und bot deshalb andere
 * an: das Jail-Modul hatte eine eigene Liste, das Moderation Center gar keine.
 *
 * Zurück kommen fertige Texte, keine Vorlagen-Objekte: die Maske füllt damit
 * ein Feld, das danach frei bearbeitet wird. Welche Vorlage angeklickt wurde,
 * ist für die Akte ohne Belang - dort steht, was am Ende dastand.
 */
export async function moderationReasonTemplates(action: moderation.ModerationAction): Promise<string[]> {
  const { getModuleSettings } = await import('@swisshub/modules');
  const settings = await getModuleSettings<moderation.ReasonTemplateQuelle>('moderation');
  return moderation.reasonTemplatesFor(action, settings).map((vorlage) => vorlage.reasonText);
}

/**
 * Die Vorlagen für jede Massnahme, die eine Maske anbietet.
 *
 * Ein Aufruf statt sechs: die Maske bekommt alles auf einmal, und wechselt
 * jemand dort die Massnahme, stehen die passenden Gründe schon da.
 */
export async function alleReasonTemplates(): Promise<Partial<Record<moderation.ModerationAction, string[]>>> {
  const { getModuleSettings } = await import('@swisshub/modules');
  const settings = await getModuleSettings<moderation.ReasonTemplateQuelle>('moderation');

  return Object.fromEntries(
    moderation.MODERATION_ACTIONS.map((action) => [
      action,
      moderation.reasonTemplatesFor(action, settings).map((vorlage) => vorlage.reasonText),
    ]),
  );
}
