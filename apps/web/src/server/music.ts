import 'server-only';
import { prisma } from '@swisshub/database';
import { can, type AuthContext } from '@swisshub/auth';
import { music } from '@swisshub/modules';

/**
 * Welche Session darf diese Person gerade steuern?
 *
 * Der Ausgangspunkt ist bewusst der Discord-Zustand und nicht eine Auswahl in
 * der Oberflaeche: wer in einem Sprachkanal sitzt, meint diesen Kanal. Eine
 * Session-ID aus dem Browser waere ausserdem manipulierbar - deshalb wird
 * hier serverseitig aufgeloest und in den Aktionen erneut geprueft.
 */
export interface MusicViewerContext {
  /** Der Sprachkanal, in dem die Person gerade sitzt. */
  voice: { channelId: string; channelName: string | null; guildId: string } | null;
  /** Die Session dieses Kanals, sofern eine laeuft. */
  sessionId: string | null;
  /** Darf diese Person die Session steuern? */
  darfSteuern: boolean;
  /** Darf sie eine neue Session starten? */
  darfStarten: boolean;
  /** Sieht sie auch fremde Sessions? */
  darfAlleSehen: boolean;
}

export async function getMusicViewerContext(context: AuthContext): Promise<MusicViewerContext> {
  const praesenz = await prisma.voicePresence.findUnique({
    where: { discordId: context.user.discordId },
  });

  const session = praesenz
    ? await music.getSessionForChannel(praesenz.guildId, praesenz.channelId)
    : null;

  const alleSteuern = can(context, music.MUSIC_PERMISSIONS.sessionsManageAll);

  return {
    voice: praesenz
      ? {
          channelId: praesenz.channelId,
          channelName: praesenz.channelName,
          guildId: praesenz.guildId,
        }
      : null,
    sessionId: session?.id ?? null,
    // Steuern darf, wer im Kanal sitzt - oder wer fremde Sessions verwalten
    // darf. Ohne beides ist die Session nur sichtbar, nicht bedienbar.
    darfSteuern: (praesenz !== null && session !== null) || alleSteuern,
    darfStarten: can(context, music.MUSIC_PERMISSIONS.sessionStart),
    darfAlleSehen: can(context, music.MUSIC_PERMISSIONS.sessionsViewAll) || alleSteuern,
  };
}

/**
 * Darf diese Person genau diese Session steuern?
 *
 * Wird von jeder Aktion aufgerufen. Eine Session-ID aus dem Browser sagt
 * nichts darueber aus, ob sie dazugehoert - das entscheidet der Voice-Zustand
 * oder die Verwaltungsberechtigung.
 */
export async function darfSessionSteuern(
  context: AuthContext,
  sessionId: string,
): Promise<boolean> {
  if (can(context, music.MUSIC_PERMISSIONS.sessionsManageAll)) {
    return true;
  }
  const [session, praesenz] = await Promise.all([
    prisma.musicSession.findUnique({ where: { id: sessionId } }),
    prisma.voicePresence.findUnique({ where: { discordId: context.user.discordId } }),
  ]);
  if (!session || session.endedAt || !praesenz) {
    return false;
  }
  return session.guildId === praesenz.guildId && session.voiceChannelId === praesenz.channelId;
}

export interface MusicSection {
  href: string;
  label: string;
}

/** Unterseiten des Musik-Moduls. */
export function musicSections(context: AuthContext): MusicSection[] {
  const p = music.MUSIC_PERMISSIONS;
  const sections: MusicSection[] = [{ href: '/musik', label: 'Player' }];

  if (can(context, p.sessionsViewAll)) {
    sections.push({ href: '/musik/sessions', label: 'Sessions' });
  }
  if (can(context, p.workersView)) {
    sections.push({ href: '/musik/worker', label: 'Worker' });
  }
  if (can(context, p.view)) {
    sections.push({ href: '/musik/verlauf', label: 'Verlauf' });
  }
  if (can(context, p.settingsView)) {
    sections.push({ href: '/modules/music', label: 'Einstellungen' });
  }
  return sections;
}
