import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import type { members } from '@swisshub/modules';

/**
 * Die Uebersetzung vom Sitzungskontext in das, was das Member Center erwartet.
 *
 * Bewusst nur eine Uebersetzung und keine zweite Regel: `can` kommt aus dem
 * bestehenden Rechtesystem, die Rollen aus der geprueften Sitzung. Entschieden
 * wird im Modul - derselbe Code, den auch eine Server Action aufruft.
 *
 * `roleIds` stammen aus dem Kontext und nicht aus der Anfrage. Das ist der
 * Unterschied zwischen «welche Rollen hat diese Person» und «welche Rollen
 * behauptet der Browser».
 */
export function memberViewer(context: AuthContext): members.MemberViewer {
  return {
    discordId: context.user.discordId,
    roleIds: context.roleIds,
    can: (permission: string) => can(context, permission),
  };
}

/** Wer die Handlung ausfuehrt - fuer Audit und Discord-Begruendung. */
export function memberActor(context: AuthContext): { discordId: string; username: string } {
  return { discordId: context.user.discordId, username: context.user.username };
}
