import type { DiscordGateway, GuildChannel, GuildRole } from '@swisshub/discord';
import { prisma } from '@swisshub/database';
import { getModuleDefinition } from '../registry';
import { referenzenIn, uebersetzeReferenzen } from './referenzen';
import type { MigrationPackage } from './package';

/**
 * Was eine Übertragung täte - bevor sie es tut.
 *
 * Der Plan ist die einzige Stelle, an der sich der ganze Vorgang ansehen
 * lässt: welche Rolle auf welche zeigt, welche Einstellung sich ändert, was
 * angelegt werden müsste, was nicht zugeordnet ist. Er wird berechnet und
 * nicht angewendet - dieselbe Funktion, die der Probelauf aufruft, benutzt
 * auch das Anwenden, damit beide dasselbe meinen.
 */

export type Zuordnungsart = 'MAP' | 'CREATE' | 'SKIP';

export interface Zuordnung {
  /** Die ID in der Quell-Guild. */
  quelle: string;
  /** Wie sie dort hiess - zum Wiedererkennen. */
  quellName: string;
  art: Zuordnungsart;
  /** Die ID in der Ziel-Guild, wenn `art === 'MAP'`. */
  ziel: string | null;
  zielName: string | null;
  /** Wurde das automatisch vorgeschlagen oder von Hand gewählt? */
  vorschlag: boolean;
}

export interface Mappings {
  roles: Zuordnung[];
  channels: Zuordnung[];
}

export type Aenderungsart = 'NO_CHANGE' | 'UPDATE' | 'CREATE' | 'SKIP';

export interface ModulAenderung {
  moduleId: string;
  label: string;
  art: Aenderungsart;
  /** Felder, die sich ändern - alt und neu, für die Gegenüberstellung. */
  felder: Array<{ key: string; label: string; vorher: string; nachher: string }>;
  /** Referenzen ohne Zuordnung. Sie werden geleert, nicht durchgereicht. */
  fehlend: Array<{ key: string; art: 'role' | 'channel'; quelle: string }>;
}

export type AutomationBefund = 'VALID' | 'WARNING' | 'INVALID';

export interface AutomationAenderung {
  name: string;
  art: Aenderungsart;
  befund: AutomationBefund;
  hinweise: string[];
}

export interface MigrationsPlan {
  roles: Zuordnung[];
  channels: Zuordnung[];
  module: ModulAenderung[];
  automationen: AutomationAenderung[];
  /** Rollen der Berechtigungsverwaltung, die übernommen werden. */
  rollenRechte: Array<{
    quelle: string;
    ziel: string | null;
    label: string;
    rechte: number;
    art: Aenderungsart;
  }>;
  integrationen: Array<{ id: string; label: string; hinweis: string }>;
  warnungen: string[];
}

/**
 * Automatische Vorschläge für die Zuordnung.
 *
 * Nach Namen, und zwar exakt vor ungefähr: «Moderator» auf «Moderator» ist
 * eine Zuordnung, «Moderator» auf «Moderatoren-Chat» wäre eine Vermutung.
 * Vermutungen gehören nicht in eine Übertragung, die Rechte verteilt - was
 * nicht eindeutig passt, bleibt offen und wartet auf einen Menschen.
 */
export function schlageRollenVor(quelle: MigrationPackage['roles'], ziel: readonly GuildRole[]): Zuordnung[] {
  const nachName = new Map(ziel.map((rolle) => [normal(rolle.name), rolle]));

  return quelle.map((rolle) => {
    const treffer = nachName.get(normal(rolle.sourceName));
    return {
      quelle: rolle.discordRoleId,
      quellName: rolle.sourceName,
      art: treffer ? ('MAP' as const) : ('SKIP' as const),
      ziel: treffer?.id ?? null,
      zielName: treffer?.name ?? null,
      vorschlag: true,
    };
  });
}

export function schlageKanaeleVor(
  quelle: Array<{ id: string; name: string }>,
  ziel: readonly GuildChannel[],
): Zuordnung[] {
  const nachName = new Map(ziel.map((kanal) => [normal(kanal.name), kanal]));

  return quelle.map((kanal) => {
    const treffer = nachName.get(normal(kanal.name));
    return {
      quelle: kanal.id,
      quellName: kanal.name,
      art: treffer ? ('MAP' as const) : ('SKIP' as const),
      ziel: treffer?.id ?? null,
      zielName: treffer?.name ?? null,
      vorschlag: true,
    };
  });
}

/** Gross-/Kleinschreibung und Zierrat weg - «#Tickets» und «tickets» sind dasselbe. */
function normal(name: string): string {
  return name
    .toLowerCase()
    .replace(/^#/u, '')
    .replaceAll('_', '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .trim();
}

/** Die Zuordnungen als Nachschlagetabelle, wie `uebersetzeReferenzen` sie erwartet. */
export function alsTabelle(mappings: Mappings): {
  roles: Record<string, string>;
  channels: Record<string, string>;
} {
  const tabelle = (eintraege: Zuordnung[]): Record<string, string> =>
    Object.fromEntries(
      eintraege
        .filter((eintrag) => eintrag.art === 'MAP' && eintrag.ziel !== null)
        .map((eintrag) => [eintrag.quelle, eintrag.ziel!]),
    );
  return { roles: tabelle(mappings.roles), channels: tabelle(mappings.channels) };
}

/**
 * Den Plan berechnen.
 *
 * Liest den Ist-Zustand des Ziels und stellt ihn dem Paket gegenüber.
 * Schreibt nichts - weder in die Datenbank noch nach Discord.
 */
export async function berechnePlan(paket: MigrationPackage, mappings: Mappings): Promise<MigrationsPlan> {
  const tabelle = alsTabelle(mappings);
  const zustaende = await prisma.moduleState.findMany();
  const vorhanden = new Map(zustaende.map((zustand) => [zustand.moduleId, zustand]));

  const module: ModulAenderung[] = [];
  for (const modul of paket.modules) {
    const definition = getModuleDefinition(modul.id);
    if (!definition) {
      // Ein Modul, das es in dieser Fassung nicht gibt, wird uebersprungen
      // statt angelegt - der Zielstand entscheidet, was es geben kann.
      module.push({
        moduleId: modul.id,
        label: modul.id,
        art: 'SKIP',
        felder: [],
        fehlend: [],
      });
      continue;
    }

    const { settings: neu, fehlend } = uebersetzeReferenzen(modul.id, modul.settings, tabelle);
    const alt = (vorhanden.get(modul.id)?.settings ?? {}) as Record<string, unknown>;
    const felder = unterschiede(modul.id, alt, neu);

    module.push({
      moduleId: modul.id,
      label: definition.name,
      art: !vorhanden.has(modul.id)
        ? 'CREATE'
        : felder.length === 0 && vorhanden.get(modul.id)?.enabled === modul.enabled
          ? 'NO_CHANGE'
          : 'UPDATE',
      felder,
      fehlend,
    });
  }

  const automationen = paket.automations.map((eintrag) => beurteileAutomation(eintrag, tabelle));

  const rollenRechte = paket.roles.map((rolle) => {
    const ziel = tabelle.roles[rolle.discordRoleId] ?? null;
    return {
      quelle: rolle.discordRoleId,
      ziel,
      label: rolle.label,
      rechte: rolle.permissions.length,
      art: ziel ? ('UPDATE' as const) : ('SKIP' as const),
    };
  });

  const warnungen: string[] = [];
  const offeneRollen = mappings.roles.filter((eintrag) => eintrag.art === 'SKIP').length;
  if (offeneRollen > 0) {
    warnungen.push(`${offeneRollen} Rolle(n) ohne Zuordnung - die zugehörigen Einstellungen bleiben leer.`);
  }
  const offeneKanaele = mappings.channels.filter((eintrag) => eintrag.art === 'SKIP').length;
  if (offeneKanaele > 0) {
    warnungen.push(
      `${offeneKanaele} Kanal/Kanäle ohne Zuordnung - die zugehörigen Einstellungen bleiben leer.`,
    );
  }

  return {
    roles: mappings.roles,
    channels: mappings.channels,
    module,
    automationen,
    rollenRechte,
    integrationen: paket.integrations.map((eintrag) => ({
      id: eintrag.id,
      label: eintrag.label,
      hinweis: eintrag.guildScoped
        ? 'Hängt an der Guild und muss auf dem Ziel neu eingerichtet werden.'
        : eintrag.konfiguriert
          ? 'Gilt für die ganze Installation - nichts zu tun.'
          : 'Nicht eingerichtet.',
    })),
    warnungen,
  };
}

/**
 * Was sich an einem Modul ändert.
 *
 * Nur Felder, die das Modul selbst kennt: ein Wert, den das Zielschema nicht
 * annimmt, wäre ohnehin beim Speichern abgewiesen worden, und ihn in der
 * Gegenüberstellung zu zeigen weckte falsche Erwartungen.
 */
function unterschiede(
  moduleId: string,
  alt: Record<string, unknown>,
  neu: Record<string, unknown>,
): ModulAenderung['felder'] {
  const definition = getModuleDefinition(moduleId);
  const beschriftung = new Map((definition?.settingsFields ?? []).map((feld) => [feld.key, feld.label]));

  const felder: ModulAenderung['felder'] = [];
  for (const [key, wert] of Object.entries(neu)) {
    const vorher = JSON.stringify(alt[key] ?? null);
    const nachher = JSON.stringify(wert ?? null);
    if (vorher !== nachher) {
      felder.push({
        key,
        label: beschriftung.get(key) ?? key,
        vorher: kuerze(vorher),
        nachher: kuerze(nachher),
      });
    }
  }
  return felder;
}

const kuerze = (wert: string): string => (wert.length > 120 ? `${wert.slice(0, 117)}...` : wert);

/**
 * Ist eine Automation nach der Übertragung noch schlüssig?
 *
 * `INVALID` heisst nicht «wird nicht importiert» - sie wird importiert, aber
 * ausgeschaltet und mit dem Befund daneben. Eine Automation stillschweigend
 * wegzulassen wäre schlimmer: dann fehlt sie, und niemand weiss davon.
 */
function beurteileAutomation(
  automation: MigrationPackage['automations'][number],
  tabelle: { roles: Record<string, string>; channels: Record<string, string> },
): AutomationAenderung {
  const hinweise: string[] = [];
  const roh = JSON.stringify([automation.triggerConfig, automation.conditions, automation.steps]);

  // Jede Snowflake in der Definition, die weder als Rolle noch als Kanal
  // zugeordnet ist, ist ein offener Verweis.
  const ids = new Set(roh.match(/\d{17,20}/gu) ?? []);
  const offen = [...ids].filter((id) => !tabelle.roles[id] && !tabelle.channels[id]);
  if (offen.length > 0) {
    hinweise.push(`${offen.length} Verweis(e) ohne Zuordnung: ${offen.slice(0, 3).join(', ')}`);
  }

  return {
    name: automation.name,
    art: 'CREATE',
    befund: offen.length > 0 ? 'INVALID' : hinweise.length > 0 ? 'WARNING' : 'VALID',
    hinweise,
  };
}

/** Alle Kanal-IDs, die das Paket in Moduleinstellungen nennt. */
export function kanaeleImPaket(paket: MigrationPackage): string[] {
  const alle = new Set<string>();
  for (const modul of paket.modules) {
    for (const id of referenzenIn(modul.id, modul.settings).channels) {
      alle.add(id);
    }
  }
  return [...alle];
}

/** Alle Rollen-IDs, die das Paket nennt - aus Einstellungen und Berechtigungen. */
export function rollenImPaket(paket: MigrationPackage): string[] {
  const alle = new Set<string>(paket.roles.map((rolle) => rolle.discordRoleId));
  for (const modul of paket.modules) {
    for (const id of referenzenIn(modul.id, modul.settings).roles) {
      alle.add(id);
    }
  }
  return [...alle];
}

export type { DiscordGateway };
