import {
  DISCORD_PERMISSIONS,
  combinePermissions,
  discord as defaultDiscord,
  hasDiscordPermission,
  type DiscordGateway,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { BESITZER_VERWALTUNG } from './permissions';

const log = createLogger('voice:bot-rechte');

/**
 * Was der Bot dem Besitzer tatsaechlich geben kann.
 *
 * Discord laesst niemanden in einer Kanalausnahme ein Recht vergeben, das er
 * selbst nicht hat - auch keinen Bot. Fehlt ihm «Rollen verwalten», weist
 * Discord die *ganze* Kanalerstellung ab, nicht nur das eine Bit. Ein Voice
 * Hub, der nach einem Deployment gar keine Talks mehr erzeugt, weil im
 * Discord-Portal ein Haken fehlt, waere ein teurer Weg, eine
 * Einrichtungsfrage zu stellen.
 *
 * Deshalb wird vorher nachgesehen und nur vergeben, was der Bot halten kann.
 * Fehlt ihm etwas, entsteht der Talk wie bisher - der Besitzer verwaltet ihn
 * dann ueber das Bedienfeld statt zusaetzlich ueber Discords
 * Kanaleinstellungen, und der Hinweis steht unter «System - Bot».
 *
 * Der Wert aendert sich nur, wenn jemand die Bot-Rolle anfasst. Ein kurzer
 * Zwischenspeicher genuegt und haelt zwei Abfragen aus jedem Talkstart
 * heraus.
 */

const CACHE_MS = 60_000;

let cache: { wert: bigint; bis: number } | null = null;

export function invalidiereBotRechte(): void {
  cache = null;
}

export async function besitzerVerwaltungsRechte(
  gateway: DiscordGateway = defaultDiscord,
): Promise<bigint> {
  if (cache && cache.bis > Date.now()) {
    return cache.wert;
  }

  let wert = 0n;
  try {
    const [mitglied, rollen] = await Promise.all([gateway.bot.member(), gateway.roles.list()]);
    if (mitglied) {
      const eigene = new Set(mitglied.roleIds);
      const gesamt = combinePermissions(
        rollen.filter((rolle) => eigene.has(rolle.id)).map((rolle) => rolle.permissions),
      );

      if (hasDiscordPermission(gesamt, 'MANAGE_CHANNELS')) {
        wert |= DISCORD_PERMISSIONS.MANAGE_CHANNELS;
      }
      if (hasDiscordPermission(gesamt, 'MANAGE_ROLES')) {
        wert |= DISCORD_PERMISSIONS.MANAGE_ROLES;
      }

      if (wert !== BESITZER_VERWALTUNG) {
        log.warn(
          'Der Bot kann dem Talk-Besitzer nicht alle Verwaltungsrechte geben - ' +
            'bitte «Channels verwalten» und «Rollen verwalten» in der Bot-Rolle prüfen.',
        );
      }
    }
  } catch (error) {
    // Discord nicht erreichbar: lieber ohne Zusatzrechte anlegen als gar
    // nicht. Der naechste Versuch fragt erneut.
    log.warn('Bot-Rechte konnten nicht geprüft werden', {
      error: error instanceof Error ? error.message : 'unbekannt',
    });
    return 0n;
  }

  cache = { wert, bis: Date.now() + CACHE_MS };
  return wert;
}
