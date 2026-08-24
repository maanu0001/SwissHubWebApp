import { prisma } from '@swisshub/database';
import type { Tournament } from '@swisshub/database';
import { discord } from '@swisshub/discord';

/**
 * Darf diese Person ueberhaupt teilnehmen?
 *
 * Alle Bedingungen sind freiwillig und pruefen nur, was SwissHub ohnehin
 * weiss: eine Discord-Rolle, den Level-Stand, ein laufendes Abo. Es werden
 * keine persoenlichen Angaben erfunden und keine erfragt, die es nicht
 * bereits gibt.
 *
 * Geprueft wird serverseitig bei jeder Anmeldung - die Anzeige auf der
 * Turnierseite ist Bequemlichkeit, nicht die Entscheidung.
 */

export interface EligibilityResult {
  eligible: boolean;
  /** Was fehlt - in der Sprache des Mitglieds, ohne interne Kennungen. */
  reasons: string[];
}

export async function checkEligibility(
  tournament: Pick<Tournament, 'id' | 'guildId' | 'requiredRoleId' | 'minLevel' | 'requiresPremium'>,
  discordId: string,
): Promise<EligibilityResult> {
  const reasons: string[] = [];

  // --- Turniersperre ---------------------------------------------------
  const sperre = await prisma.tournamentBlockEntry.findFirst({
    where: {
      guildId: tournament.guildId,
      discordId,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (sperre) {
    // Bewusst ohne Grund: der steht im Protokoll der Verwaltung, und eine
    // Sperrbegruendung auf einer oeffentlichen Seite ist eine Blossstellung.
    return { eligible: false, reasons: ['Du bist derzeit von der Turnierteilnahme ausgeschlossen.'] };
  }

  // --- Discord-Mitgliedschaft und Rolle --------------------------------
  if (tournament.requiredRoleId) {
    const mitglied = await discord.members.get(discordId).catch(() => null);
    if (!mitglied) {
      reasons.push('Du bist kein Mitglied des Discord-Servers.');
    } else if (!mitglied.roleIds.includes(tournament.requiredRoleId)) {
      const rolle = await discord.roles.get(tournament.requiredRoleId).catch(() => null);
      reasons.push(
        rolle
          ? `Für dieses Turnier braucht es die Rolle «${rolle.name}».`
          : 'Für dieses Turnier braucht es eine bestimmte Rolle.',
      );
    }
  }

  // --- Level -----------------------------------------------------------
  if (tournament.minLevel > 0) {
    const { getProfile } = await import('../level/service');
    const { levelFromXp } = await import('../level/curve');
    const profil = await getProfile(discordId).catch(() => null);
    const level = profil ? levelFromXp(profil.xp) : 0;
    if (level < tournament.minLevel) {
      reasons.push(
        `Für dieses Turnier braucht es mindestens Level ${tournament.minLevel} (du hast ${level}).`,
      );
    }
  }

  // --- Premium ---------------------------------------------------------
  if (tournament.requiresPremium) {
    const laufend = await prisma.premiumSubscription
      .findFirst({
        where: {
          discordId,
          // Gekuendigt, aber noch bezahlt, zaehlt weiter: das Abo laeuft bis
          // zum Ende der Periode, und bis dahin gilt der Vorteil.
          status: { in: ['ACTIVE', 'PAST_DUE', 'CANCEL_AT_PERIOD_END'] },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (!laufend) {
      reasons.push('Dieses Turnier steht nur SwissHub-Premium-Mitgliedern offen.');
    }
  }

  return { eligible: reasons.length === 0, reasons };
}
