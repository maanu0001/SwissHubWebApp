import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { ADMIN_FULL } from '@swisshub/permissions';
import { invalidateRoleConfiguration } from '@swisshub/permissions';
import { listModuleDefinitions, moduleViewPermissionOf, type ModuleDefinition } from './registry';

const log = createLogger('modules:module-view');

/**
 * Nachtrag der «Modul sehen»-Berechtigungen.
 *
 * Vor dieser Aenderung entschied irgendeine Berechtigung eines Moduls
 * darueber, ob sein Eintrag in der Seitenleiste erschien. Jetzt entscheidet
 * ein eigener Schluessel. Ohne Nachtrag verloere jede bestehende Rolle beim
 * Deployment schlagartig ihre gesamte Navigation - und niemand kaeme mehr an
 * die Stelle, an der sich das beheben liesse.
 *
 * Der Nachtrag beantwortet deshalb genau eine Frage, und zwar pro Rolle und
 * Modul: haette diese Rolle den Eintrag *gestern* gesehen? Wenn ja, bekommt
 * sie den neuen Schluessel. Der Zustand nach dem Deployment ist damit der
 * Zustand davor; erst danach laesst sich «Modul sehen» ueberhaupt sinnvoll
 * von Hand administrieren.
 *
 * Er laeuft genau einmal, und dass er gelaufen ist, steht in der Datenbank.
 * Das ist der Unterschied zwischen einem Nachtrag und einer Dauerueberwachung:
 * wer einer Rolle spaeter bewusst «Modul sehen» entzieht, hat das entschieden -
 * und findet den Bereich beim naechsten Neustart nicht wieder offen. Ein
 * Nachtrag, der eine Entscheidung jede Nacht rueckgaengig macht, waere schlimmer
 * als gar keiner.
 *
 * Er wird trotzdem bei jedem Start aufgerufen: er sieht nach, ob er schon
 * gelaufen ist, und tut dann nichts. So braucht es keinen separaten
 * Deployment-Schritt, den jemand vergessen kann.
 */

/** Kennzeichnet die Zeilen, die dieser Nachtrag angelegt hat. */
const HERKUNFT = 'module-view-backfill';

/** Der Vermerk, dass der Nachtrag gelaufen ist. */
const MARKE = 'modules.moduleView.backfill';

/**
 * Die Berechtigungen, die einer Rolle den Eintrag eines Moduls frueher
 * sichtbar gemacht haben.
 *
 * Genau die drei Wege, die `buildNavigation` kannte: die Hauptberechtigung
 * eines Eintrags, seine Ausweichziele und seine Zweitberechtigungen.
 */
export function alteSichtbarkeitsKeys(definition: ModuleDefinition): string[] {
  const keys = new Set<string>();
  for (const item of definition.navigation) {
    keys.add(item.permission);
    for (const eintrag of item.alternatives ?? []) {
      keys.add(eintrag.permission);
    }
    for (const eintrag of item.altPermissions ?? []) {
      keys.add(eintrag);
    }
  }
  return [...keys];
}

/**
 * Deckt eine der vorhandenen Berechtigungen einen dieser Schluessel ab?
 *
 * Dieselbe Semantik wie die Permission Engine: `admin.full` deckt alles,
 * `<praefix>.*` den ganzen Praefix. Der Nachtrag darf nicht strenger sein als
 * die Pruefung, an deren Stelle er tritt - sonst verlieren genau die Rollen
 * ihre Navigation, die bisher ueber eine Wildcard hereinkamen.
 */
function deckt(vorhanden: ReadonlySet<string>, key: string): boolean {
  if (vorhanden.has(ADMIN_FULL) || vorhanden.has(key)) {
    return true;
  }
  const praefix = key.split('.')[0];
  return praefix !== undefined && vorhanden.has(`${praefix}.*`);
}

export interface BackfillErgebnis {
  /** Neu angelegte Rolle-/Berechtigungszeilen. */
  vergeben: number;
  /** Rollen, die mindestens einen Schluessel bekommen haben. */
  rollen: number;
  /** Der Nachtrag war schon gelaufen - es wurde nichts angefasst. */
  uebersprungen: boolean;
}

/** Ist der Nachtrag schon gelaufen? */
async function schonGelaufen(): Promise<boolean> {
  const marke = await prisma.systemConfig.findUnique({ where: { key: MARKE } });
  return marke !== null;
}

export async function backfillModuleViewPermissions(
  optionen: { erzwingen?: boolean } = {},
): Promise<BackfillErgebnis> {
  if (!optionen.erzwingen && (await schonGelaufen())) {
    return { vergeben: 0, rollen: 0, uebersprungen: true };
  }

  const module = listModuleDefinitions()
    .map((definition) => ({
      sehen: moduleViewPermissionOf(definition),
      alt: alteSichtbarkeitsKeys(definition),
    }))
    .filter((eintrag): eintrag is { sehen: string; alt: string[] } => eintrag.sehen !== null);

  if (module.length === 0) {
    // Die Registry ist nicht geladen. Hier jetzt nichts zu tun ist richtig -
    // ein leerer Nachtrag ist besser als einer, der die halbe Wahrheit kennt.
    log.warn('Kein Modul registriert - Nachtrag übersprungen');
    return { vergeben: 0, rollen: 0, uebersprungen: true };
  }

  const vorhandene = await prisma.rolePermission.findMany({
    select: { discordRoleId: true, permission: true },
  });

  const proRolle = new Map<string, Set<string>>();
  for (const zeile of vorhandene) {
    const menge = proRolle.get(zeile.discordRoleId) ?? new Set<string>();
    menge.add(zeile.permission);
    proRolle.set(zeile.discordRoleId, menge);
  }

  const anzulegen: Array<{ discordRoleId: string; permission: string }> = [];
  for (const [discordRoleId, menge] of proRolle) {
    for (const eintrag of module) {
      // Schon abgedeckt - sei es ausdruecklich, ueber `<praefix>.*` oder ueber
      // `admin.full`. Eine Zeile daneben aenderte nichts und stuende nur im
      // Berechtigungseditor herum.
      if (deckt(menge, eintrag.sehen)) {
        continue;
      }
      if (eintrag.alt.some((key) => deckt(menge, key))) {
        anzulegen.push({ discordRoleId, permission: eintrag.sehen });
      }
    }
  }

  const { count } =
    anzulegen.length > 0
      ? await prisma.rolePermission.createMany({
          data: anzulegen.map((zeile) => ({ ...zeile, createdBy: HERKUNFT })),
          skipDuplicates: true,
        })
      : { count: 0 };

  if (count > 0) {
    invalidateRoleConfiguration();
  }

  // Der Vermerk steht am Schluss: bricht etwas darueber ab, laeuft der
  // Nachtrag beim naechsten Start erneut. Er ist ohnehin wiederholbar.
  await prisma.systemConfig.upsert({
    where: { key: MARKE },
    create: { key: MARKE, value: { vergeben: count }, updatedBy: HERKUNFT },
    update: {},
  });

  const rollen = new Set(anzulegen.map((zeile) => zeile.discordRoleId)).size;
  log.info('«Modul sehen» für bestehende Rollen nachgetragen', { vergeben: count, rollen });
  return { vergeben: count, rollen, uebersprungen: false };
}
