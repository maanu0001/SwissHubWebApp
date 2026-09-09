import { prisma, type DiscordInvite } from '@swisshub/database';
import { DiscordApiError, DISCORD_ERROR_CODES, discord, type GuildInvite } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';

const log = createLogger('invites');

/**
 * Welche Einladung hat jemanden hereingebracht?
 *
 * Discord sagt es nicht. Das Ereignis `guildMemberAdd` nennt das Mitglied und
 * sonst nichts - die einzige Auskunft ueber Einladungen ist ein Zaehler je
 * Code. Wer wissen will, welcher Code benutzt wurde, muss die Zaehler **vor**
 * dem Beitritt kennen und hinterher die Differenz bilden. Genau das macht
 * dieser Dienst, und mehr macht er nicht.
 *
 * Drei Dinge, die er ausdruecklich **nicht** tut:
 *
 * 1. **Er raet nicht.** Sind zwei Zaehler gestiegen, oder keiner, dann ist die
 *    Einladung unbekannt - und das steht dann auch so im Log. «Wahrscheinlich
 *    ueber Einladung X» ist in einem Kanal, den das halbe Team liest, eine
 *    Behauptung ueber einen Menschen, der jemanden eingeladen haben soll.
 * 2. **Er baut kein zweites Log.** Das Ergebnis wandert als Zusatz in das
 *    Beitrittsereignis, das der Statistikpfad ohnehin schreibt. Ein eigener
 *    Weg nach Discord waere ein zweites Logsystem.
 * 3. **Er blockiert keinen Beitritt.** Faellt Discord aus, fehlt ein Recht
 *    oder geht sonst etwas schief, bleibt das Beitrittslog vollstaendig - nur
 *    ohne Zuordnung. Ein fehlendes Log saehe aus wie ein Beitritt, der nicht
 *    stattgefunden hat.
 */

/** Wie eine Zuordnung zustande kam. */
export type ZuordnungsArt =
  /** Genau ein Zaehler ist um genau eins gestiegen. */
  | 'EINDEUTIG'
  /** Ein Zaehler ist gestiegen, aber um mehr als eins (z.B. nach einem Neustart). */
  | 'MEHRERE_NUTZUNGEN'
  /** Eine Einladung ist verschwunden und war einmalig - dann war sie es. */
  | 'AUFGEBRAUCHT'
  /** Mehrere Zaehler sind gestiegen - nicht entscheidbar. */
  | 'MEHRDEUTIG'
  /** Kein Zaehler ist gestiegen. Vanity-URL, Bot-Zugang oder Ereignisverlust. */
  | 'KEINE_AENDERUNG'
  /** Der Bot darf die Einladungen nicht lesen (`MANAGE_GUILD` fehlt). */
  | 'KEIN_ZUGRIFF'
  /** Discord war nicht erreichbar. */
  | 'DISCORD_FEHLER';

export interface Zuordnung {
  art: ZuordnungsArt;
  /** Nur bei einer belegten Zuordnung gesetzt. */
  code: string | null;
  inviterDiscordId: string | null;
  inviterUsername: string | null;
  /** Discords Zaehler nach dem Beitritt - fuer die Anzeige «3. Beitritt». */
  uses: number | null;
}

const OHNE_ZUORDNUNG = (art: ZuordnungsArt): Zuordnung => ({
  art,
  code: null,
  inviterDiscordId: null,
  inviterUsername: null,
  uses: null,
});

/** Ist eine Zuordnung belegt genug, um einen Namen zu nennen? */
export function istBelegt(zuordnung: Zuordnung): boolean {
  return (
    zuordnung.code !== null &&
    (zuordnung.art === 'EINDEUTIG' ||
      zuordnung.art === 'MEHRERE_NUTZUNGEN' ||
      zuordnung.art === 'AUFGEBRAUCHT')
  );
}

/**
 * Fehlt dem Bot das Recht, die Einladungen zu lesen?
 *
 * `MANAGE_GUILD` ist dafuer noetig. Ohne das Recht antwortet Discord mit 403 -
 * das ist eine Antwort und kein Ausfall, und es soll auch anders behandelt
 * werden: ein fehlendes Recht behebt sich nicht von selbst, ein Ausfall schon.
 */
function istRechteFehler(fehler: unknown): boolean {
  if (!(fehler instanceof DiscordApiError)) {
    return false;
  }
  return (
    fehler.status === 403 ||
    fehler.discordCode === DISCORD_ERROR_CODES.MISSING_PERMISSIONS ||
    fehler.discordCode === DISCORD_ERROR_CODES.MISSING_ACCESS
  );
}

/**
 * Den Spiegel auf den Stand von Discord bringen.
 *
 * Laeuft beim Start des Bots und nach jedem Beitritt. Codes, die Discord nicht
 * mehr kennt, werden als zurueckgezogen markiert statt geloescht: ein Beitritt
 * ueber eine inzwischen aufgebrauchte Einladung soll weiterhin sagen koennen,
 * wer sie erstellt hatte.
 */
export async function spiegleEinladungen(
  guildId: string,
  einladungen: readonly GuildInvite[],
): Promise<void> {
  const jetzt = new Date();

  for (const einladung of einladungen) {
    await prisma.discordInvite.upsert({
      where: { guildId_code: { guildId, code: einladung.code } },
      create: {
        guildId,
        code: einladung.code,
        channelId: einladung.channelId,
        channelName: einladung.channelName,
        inviterDiscordId: einladung.inviterDiscordId,
        inviterUsername: einladung.inviterUsername,
        uses: einladung.uses,
        maxUses: einladung.maxUses,
        expiresAt: einladung.expiresAt,
        discordCreatedAt: einladung.createdAt,
        lastSeenAt: jetzt,
      },
      update: {
        channelId: einladung.channelId,
        channelName: einladung.channelName,
        // Der Ersteller wird nur nachgetragen, nie ueberschrieben: bei einem
        // Ereignis liefert Discord ihn, bei einer Einzelabfrage manchmal
        // nicht. Ein `null` von dort duerfte einen bekannten Namen nicht
        // loeschen.
        ...(einladung.inviterDiscordId ? { inviterDiscordId: einladung.inviterDiscordId } : {}),
        ...(einladung.inviterUsername ? { inviterUsername: einladung.inviterUsername } : {}),
        uses: einladung.uses,
        maxUses: einladung.maxUses,
        expiresAt: einladung.expiresAt,
        revokedAt: null,
        lastSeenAt: jetzt,
      },
    });
  }

  const bekannt = new Set(einladungen.map((einladung) => einladung.code));
  const verschwunden = await prisma.discordInvite.findMany({
    where: { guildId, revokedAt: null },
    select: { code: true },
  });
  const abzumelden = verschwunden.map((zeile) => zeile.code).filter((code) => !bekannt.has(code));

  if (abzumelden.length > 0) {
    await prisma.discordInvite.updateMany({
      where: { guildId, code: { in: abzumelden } },
      data: { revokedAt: jetzt },
    });
  }
}

/** Holt die Einladungen und spiegelt sie. Meldet, ob das gelungen ist. */
export async function synchronisiereEinladungen(
  guildId: string,
  gateway = discord,
): Promise<{ ok: boolean; anzahl: number; grund?: 'KEIN_ZUGRIFF' | 'DISCORD_FEHLER' }> {
  try {
    const einladungen = await gateway.guild.invites();
    await spiegleEinladungen(guildId, einladungen);
    return { ok: true, anzahl: einladungen.length };
  } catch (fehler) {
    if (istRechteFehler(fehler)) {
      // Kein Stacktrace: das ist keine Panne, sondern eine fehlende
      // Einstellung auf Discord. Der Hinweis soll sagen, was zu tun ist.
      log.warn(
        'Einladungen nicht lesbar - dem Bot fehlt "Server verwalten". Beitritte werden weiterhin protokolliert, nur ohne Einladung.',
        { guildId },
      );
      return { ok: false, anzahl: 0, grund: 'KEIN_ZUGRIFF' };
    }
    log.error('Einladungen konnten nicht abgeglichen werden', { guildId, fehler });
    return { ok: false, anzahl: 0, grund: 'DISCORD_FEHLER' };
  }
}

/**
 * Eine neu erstellte Einladung merken.
 *
 * Ohne diesen Schritt waere der naechste Beitritt ueber sie mehrdeutig: der
 * Spiegel kennt den Code nicht, also erschiene er als «neu aufgetaucht» und
 * nicht als «Zaehler gestiegen».
 */
export async function merkeEinladung(guildId: string, einladung: GuildInvite): Promise<void> {
  await spiegleEinladungen(guildId, [einladung]);
}

/**
 * Eine geloeschte Einladung abmelden.
 *
 * Die Zeile bleibt stehen und wird nur als zurueckgezogen markiert - siehe
 * `spiegleEinladungen`.
 */
export async function vergissEinladung(guildId: string, code: string): Promise<void> {
  await prisma.discordInvite.updateMany({
    where: { guildId, code, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Je Guild laeuft immer nur eine Zuordnung.
 *
 * Zwei Beitritte im selben Moment sind kein Sonderfall, sondern der Alltag
 * eines Servers, ueber den gerade jemand einen Link geteilt hat. Liefen beide
 * Zuordnungen gleichzeitig, laesen beide denselben alten Stand, holten
 * denselben neuen - und beide fassten dieselbe Differenz als ihre eigene auf.
 * Der zweite Beitritt bekaeme die Einladung des ersten.
 *
 * Nacheinander stimmt es: der erste Lauf schreibt den Spiegel fort, der
 * zweite vergleicht gegen den fortgeschriebenen Stand und findet entweder
 * seine eigene Steigerung oder gar keine - und «keine» ist die ehrliche
 * Antwort, wenn Discord in der Zwischenzeit nichts Neues zu berichten hatte.
 */
const laufendeZuordnung = new Map<string, Promise<unknown>>();

async function nacheinander<T>(guildId: string, arbeit: () => Promise<T>): Promise<T> {
  const vorgaenger = laufendeZuordnung.get(guildId) ?? Promise.resolve();
  const eigener = vorgaenger.catch(() => undefined).then(arbeit);
  laufendeZuordnung.set(
    guildId,
    eigener.catch(() => undefined),
  );
  try {
    return await eigener;
  } finally {
    // Nur aufraeumen, wenn seither niemand angestellt hat - sonst risse man
    // die Kette fuer den Wartenden ab.
    if (laufendeZuordnung.get(guildId) === eigener) {
      laufendeZuordnung.delete(guildId);
    }
  }
}

/**
 * Die Differenz bilden und den Spiegel nachziehen.
 *
 * Reihenfolge ist hier alles: erst den alten Stand lesen, dann den neuen
 * holen, dann vergleichen, dann speichern. Wer zuerst speichert, vergleicht
 * anschliessend gegen sich selbst und findet nie eine Differenz.
 */
export async function ordneBeitrittZu(guildId: string, gateway = discord): Promise<Zuordnung> {
  return nacheinander(guildId, () => ordneZu(guildId, gateway));
}

async function ordneZu(guildId: string, gateway: typeof discord): Promise<Zuordnung> {
  const vorher = await prisma.discordInvite.findMany({ where: { guildId } });

  let jetzt: GuildInvite[];
  try {
    jetzt = await gateway.guild.invites();
  } catch (fehler) {
    if (istRechteFehler(fehler)) {
      return OHNE_ZUORDNUNG('KEIN_ZUGRIFF');
    }
    log.error('Einladungen beim Beitritt nicht abrufbar', { guildId, fehler });
    return OHNE_ZUORDNUNG('DISCORD_FEHLER');
  }

  const zuordnung = vergleiche(vorher, jetzt);

  await spiegleEinladungen(guildId, jetzt);
  if (istBelegt(zuordnung) && zuordnung.code) {
    await prisma.discordInvite.updateMany({
      where: { guildId, code: zuordnung.code },
      data: { attributedJoins: { increment: 1 } },
    });
  }

  return zuordnung;
}

/**
 * Der eigentliche Vergleich - ohne Datenbank und ohne Discord.
 *
 * Getrennt, weil hier die Aussage entsteht, auf die sich hinterher jemand
 * beruft. Sie soll ohne laufenden Server pruefbar sein.
 */
export function vergleiche(
  vorher: ReadonlyArray<
    Pick<DiscordInvite, 'code' | 'uses' | 'inviterDiscordId' | 'inviterUsername' | 'maxUses' | 'revokedAt'>
  >,
  jetzt: readonly GuildInvite[],
): Zuordnung {
  const alt = new Map(vorher.map((zeile) => [zeile.code, zeile]));
  const neu = new Map(jetzt.map((einladung) => [einladung.code, einladung]));

  const gestiegen = jetzt.flatMap((einladung) => {
    const zuvor = alt.get(einladung.code);
    // Ein Code, den der Spiegel nicht kennt, ist keine Steigerung: er kann
    // zwischen zwei Laeufen erstellt **und** benutzt worden sein, und dann
    // waere sein Zaehler von Anfang an groesser als null. Ihn als Treffer zu
    // werten hiesse zu raten.
    if (!zuvor) {
      return [];
    }
    const differenz = einladung.uses - zuvor.uses;
    return differenz > 0 ? [{ einladung, differenz }] : [];
  });

  if (gestiegen.length === 1) {
    const treffer = gestiegen[0]!;
    return {
      art: treffer.differenz === 1 ? 'EINDEUTIG' : 'MEHRERE_NUTZUNGEN',
      code: treffer.einladung.code,
      inviterDiscordId:
        treffer.einladung.inviterDiscordId ?? alt.get(treffer.einladung.code)?.inviterDiscordId ?? null,
      inviterUsername:
        treffer.einladung.inviterUsername ?? alt.get(treffer.einladung.code)?.inviterUsername ?? null,
      uses: treffer.einladung.uses,
    };
  }

  if (gestiegen.length > 1) {
    return OHNE_ZUORDNUNG('MEHRDEUTIG');
  }

  /*
   * Kein Zaehler gestiegen - aber vielleicht ist eine Einladung gerade
   * aufgebraucht worden.
   *
   * Discord loescht eine Einladung, sobald ihr letzter Platz verbraucht ist.
   * Sie taucht dann nicht mehr in der Liste auf, und ihr Zaehler kann gar
   * nicht mehr steigen. Genau ein solcher Fall ist belegbar: verschwindet
   * genau eine Einladung, der noch genau ein Platz fehlte, dann war sie es.
   * Verschwinden mehrere, oder war noch Luft, bleibt es unbekannt - eine
   * geloeschte Einladung sieht genauso aus wie eine aufgebrauchte.
   */
  const aufgebraucht = vorher.filter(
    (zeile) =>
      zeile.revokedAt === null &&
      !neu.has(zeile.code) &&
      zeile.maxUses > 0 &&
      zeile.uses + 1 === zeile.maxUses,
  );
  if (aufgebraucht.length === 1) {
    const treffer = aufgebraucht[0]!;
    return {
      art: 'AUFGEBRAUCHT',
      code: treffer.code,
      inviterDiscordId: treffer.inviterDiscordId,
      inviterUsername: treffer.inviterUsername,
      uses: treffer.maxUses,
    };
  }

  return OHNE_ZUORDNUNG('KEINE_AENDERUNG');
}

/** Klartext fuer das Log - je Art genau eine Aussage, ohne Vermutung. */
export const ZUORDNUNG_TEXT: Record<ZuordnungsArt, string> = {
  EINDEUTIG: 'eindeutig zugeordnet',
  MEHRERE_NUTZUNGEN: 'zugeordnet (mehrere Nutzungen seit dem letzten Abgleich)',
  AUFGEBRAUCHT: 'zugeordnet (Einladung damit aufgebraucht)',
  MEHRDEUTIG: 'nicht eindeutig - mehrere Einladungen wurden gleichzeitig genutzt',
  KEINE_AENDERUNG: 'unbekannt - kein Zähler hat sich verändert',
  KEIN_ZUGRIFF: 'unbekannt - dem Bot fehlt „Server verwalten“',
  DISCORD_FEHLER: 'unbekannt - Discord war nicht erreichbar',
};
