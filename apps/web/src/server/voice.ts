import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { voiceHub } from '@swisshub/modules';

/**
 * Die Uebersetzung vom Sitzungskontext in das, was die Voice-Dienste erwarten.
 *
 * Bewusst nur eine Uebersetzung und keine zweite Regel: `can` kommt aus dem
 * bestehenden Rechtesystem, entschieden wird im Modul - derselbe Code, den
 * auch der Discord-Knopf aufruft.
 */
export function voiceKontext(context: AuthContext): voiceHub.AktionsKontext {
  return {
    viewer: {
      discordId: context.user.discordId,
      can: (permission: string) => can(context, permission),
    },
    actor: {
      discordId: context.user.discordId,
      username: context.user.username,
      source: 'WEBAPP',
    },
  };
}

export interface VoiceSection {
  href: string;
  label: string;
}

/** Unterseiten des Voice Hub. */
export function voiceSections(context: AuthContext): VoiceSection[] {
  const p = voiceHub.VOICE_HUB_PERMISSIONS;
  const sections: VoiceSection[] = [{ href: '/voice', label: 'Übersicht' }];

  if (can(context, p.adminView)) {
    sections.push({ href: '/voice/talks', label: 'Aktive Talks' });
  }
  if (can(context, p.hubsManage)) {
    sections.push({ href: '/voice/hubs', label: 'Hub-Channels' });
  }
  if (can(context, p.presetsManage)) {
    sections.push({ href: '/voice/presets', label: 'Presets' });
  }
  if (can(context, p.statsView)) {
    sections.push({ href: '/voice/statistiken', label: 'Statistiken' });
  }
  // Die Moduleinstellungen sind Verwaltung. Sie standen hier bedingungslos -
  // damit sah jedes Mitglied, das seinen eigenen Talk verwalten darf, auch den
  // Reiter zur Konfiguration des ganzen Moduls.
  if (can(context, p.settingsManage) || can(context, 'modules.manage')) {
    sections.push({ href: '/modules/voiceHub', label: 'Einstellungen' });
  }

  return sections;
}
