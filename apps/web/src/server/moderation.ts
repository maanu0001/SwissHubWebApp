import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { bootstrapConfig } from '@swisshub/config';
import { jail, moderation } from '@swisshub/modules';
import type { ModerationAbilities } from '@/modules/moderation/abilities';
import type { ModerationSection } from '@/modules/moderation/sections';

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
  if (can(context, p.settingsManage) || can(context, 'modules.manage')) {
    sections.push({ href: '/modules/moderation', label: 'Einstellungen' });
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
    note: can(context, p.notesCreate),
  };
  return { ...abilities, any: Object.values(abilities).some(Boolean) };
}

export type { ModerationAbilities, ModerationSection };
