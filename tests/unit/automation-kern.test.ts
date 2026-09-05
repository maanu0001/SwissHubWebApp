import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRegistries,
  einstieg,
  flache,
  istInterneAdresse,
  naechsterTermin,
  registerAction,
  registerCondition,
  render,
  renderConfig,
  stepsSchema,
  listActions,
  vergleiche,
  werteBaumAus,
  zaehleSchritte,
  type AutomationContext,
  type ConditionNode,
  type StepNode,
} from '@swisshub/automation';
import { z } from 'zod';

/**
 * Der Kern der Automation Engine - alles, was ohne Datenbank prüfbar ist.
 *
 * Die Zusagen hier sind zum grössten Teil Zusagen darüber, was **nicht**
 * geschehen kann: kein Code aus einer Vorlage, kein Zugriff auf
 * Umgebungsvariablen, keine Anfrage ins interne Netz, kein Zyklus in einer
 * Schrittfolge. Für jede davon steht hier ein Test, der fehlschlägt, sobald
 * die Zusage bricht - nicht erst produktiv.
 */

/**
 * Die mitgelieferten Aktionen - festgehalten, ehe ein Test die Registries leert.
 *
 * `clearRegistries()` in einem `beforeEach` weiter unten würde die Liste sonst
 * leeren, und die Sanktionsprüfung liefe über null Einträge: gruen, ohne
 * etwas geprüft zu haben. Genau diese Art von stillem Test soll es hier nicht
 * geben.
 */
const KERN_AKTIONEN = listActions();

function kontext(zusatz: Partial<AutomationContext> = {}): AutomationContext {
  return {
    runId: 'run-1',
    automationId: 'auto-1',
    guildId: '900000000000000001',
    correlationId: 'corr-1',
    depth: 0,
    dryRun: false,
    gateway: {} as AutomationContext['gateway'],
    event: {
      id: 'evt-1',
      type: 'member.joined',
      actorId: '100000000000000001',
      subjectId: '100000000000000002',
      entityId: null,
      occurredAt: new Date('2026-08-28T18:00:00Z'),
    },
    payload: { displayName: 'Manu', level: 12, kontoAlterTage: 3, istBot: false },
    steps: {},
    now: new Date('2026-08-28T18:00:00Z'),
    emitted: 0,
    ...zusatz,
  };
}

describe('Platzhalter', () => {
  it('setzt einen erlaubten Pfad ein', () => {
    expect(render('Hoi {{payload.displayName}}', kontext()).text).toBe('Hoi Manu');
  });

  it('meldet einen unbekannten Pfad, statt zu scheitern', () => {
    const ergebnis = render('Hoi {{payload.gibtsNicht}}', kontext());
    expect(ergebnis.text).toBe('Hoi ');
    expect(ergebnis.fehlend).toContain('payload.gibtsNicht');
  });

  /**
   * Der wichtigste Test dieser Datei.
   *
   * Ein Platzhalter ist ein Pfad in eine Freigabeliste - nichts sonst. Wer
   * hier eine Zeile ändert und diesen Test grün lässt, hat aus der Engine
   * eine Plattform gemacht, auf der sich Code ausführen lässt (§44).
   */
  it.each([
    ['{{process.env.DATABASE_URL}}', 'process.env.DATABASE_URL'],
    ['{{constructor.constructor("return 1")()}}', 'constructor.constructor("return 1")()'],
    ['{{payload.__proto__.polluted}}', 'payload.__proto__.polluted'],
    ['{{global.process}}', 'global.process'],
    ['{{payload["displayName"]}}', 'payload["displayName"]'],
  ])('lässt %s nicht durch', (vorlage, pfad) => {
    const ergebnis = render(vorlage, kontext());
    expect(ergebnis.text).toBe('');
    expect(ergebnis.fehlend).toContain(pfad);
  });

  /**
   * Der Discord-Zugang liegt im Kontext - erreichbar ist er nicht.
   *
   * Dieser Test hängt an einem Wert, den es wirklich gibt: würde die
   * Freigabeliste um `gateway` erweitert, stünde er im Text. Ein Test gegen
   * einen Pfad, den das Objekt ohnehin nicht kennt, könnte das nicht zeigen.
   */
  it('erreicht den Discord-Zugang nicht, obwohl er im Kontext liegt', () => {
    const mitZugang = kontext({
      gateway: { geheimnis: 'nicht-in-eine-nachricht' } as unknown as AutomationContext['gateway'],
    });
    const ergebnis = render('X{{gateway.geheimnis}}X', mitZugang);
    expect(ergebnis.text).toBe('XX');
    expect(ergebnis.fehlend).toContain('gateway.geheimnis');
  });

  /**
   * Dasselbe für `runId` - der steht auf der Freigabeliste und muss lesbar
   * sein. Ohne diesen Gegentest liesse sich die Liste einfach leeren und alle
   * Tests darüber blieben grün.
   */
  it('erreicht, was auf der Freigabeliste steht', () => {
    expect(render('{{runId}}', kontext()).text).toBe('run-1');
    expect(render('{{guildId}}', kontext()).text).toBe('900000000000000001');
  });

  it('löst auch verschachtelte Konfigurationen auf', () => {
    const aufgeloest = renderConfig(
      { titel: 'Level {{payload.level}}', tief: { text: 'Hoi {{payload.displayName}}' } },
      kontext(),
    );
    expect(aufgeloest).toEqual({ titel: 'Level 12', tief: { text: 'Hoi Manu' } });
  });
});

describe('Vergleiche', () => {
  /**
   * Zahlen als Zahlen.
   *
   * `'10' > '9'` ist in JavaScript falsch. Eine Bedingung, die auf «Level >=
   * 10» prüft, dürfte daran nicht scheitern - und der Fehler wäre still.
   */
  it('vergleicht Zahlen als Zahlen, auch als Text', () => {
    expect(vergleiche('10', 'gt', '9')).toBe(true);
    expect(vergleiche(10, 'gte', '10')).toBe(true);
  });

  it('gilt als nicht erfüllt, wenn ein Grössenvergleich keine Zahl bekommt', () => {
    expect(vergleiche('abc', 'gt', 5)).toBe(false);
    expect(vergleiche(5, 'lt', 'abc')).toBe(false);
  });

  it('unterscheidet vorhanden von leer', () => {
    expect(vergleiche('', 'exists', null)).toBe(false);
    expect(vergleiche('x', 'exists', null)).toBe(true);
    expect(vergleiche(undefined, 'notExists', null)).toBe(true);
  });

  it('versteht Listen als Liste und Texte als Text', () => {
    expect(vergleiche(['a', 'b'], 'contains', 'a')).toBe(true);
    expect(vergleiche('Hallo Welt', 'contains', 'Welt')).toBe(true);
    expect(vergleiche('b', 'in', 'a, b, c')).toBe(true);
  });
});

describe('Bedingungsbaum', () => {
  beforeEach(() => {
    clearRegistries();
    registerCondition({
      id: 'immer',
      label: 'Immer',
      description: '',
      group: 'Test',
      configSchema: z.object({ wert: z.boolean() }),
      fields: [],
      evaluate: async (config) => (config as { wert: boolean }).wert,
    });
  });

  const blatt = (wert: boolean, negiert = false): ConditionNode => ({
    art: 'bedingung',
    typ: 'immer',
    negiert,
    config: { wert },
  });

  it('verknüpft mit UND und ODER', async () => {
    const und = await werteBaumAus(
      { art: 'gruppe', verknuepfung: 'UND', kinder: [blatt(true), blatt(false)] },
      kontext(),
    );
    expect(und.erfuellt).toBe(false);

    const oder = await werteBaumAus(
      { art: 'gruppe', verknuepfung: 'ODER', kinder: [blatt(true), blatt(false)] },
      kontext(),
    );
    expect(oder.erfuellt).toBe(true);
  });

  it('kehrt einen negierten Knoten um', async () => {
    const ergebnis = await werteBaumAus(blatt(false, true), kontext());
    expect(ergebnis.erfuellt).toBe(true);
  });

  /**
   * Ohne Kurzschluss - damit der Probelauf jeden Zweig zeigen kann.
   *
   * Wer hier `&&` einsetzt, spart nichts Messbares und nimmt dem Probelauf
   * genau die Auskunft, für die es ihn gibt.
   */
  it('prüft jeden Zweig, auch wenn das Ergebnis feststeht', async () => {
    const ergebnis = await werteBaumAus(
      { art: 'gruppe', verknuepfung: 'UND', kinder: [blatt(false), blatt(true), blatt(true)] },
      kontext(),
    );
    expect(ergebnis.schritte).toHaveLength(3);
  });

  /**
   * Fail closed.
   *
   * Eine Bedingung, die es nicht mehr gibt - etwa weil ein Modul abgeschaltet
   * wurde -, gilt als nicht erfüllt. Andersherum handelte die Automation,
   * ohne dass jemand geprüft hat, ob sie darf.
   */
  it('gilt als nicht erfüllt, wenn die Bedingung fehlt', async () => {
    const ergebnis = await werteBaumAus({ art: 'bedingung', typ: 'gibtsNicht', config: {} }, kontext());
    expect(ergebnis.erfuellt).toBe(false);
    expect(ergebnis.schritte[0]?.fehler).toContain('nicht mehr verfügbar');
  });

  it('gilt als nicht erfüllt, wenn die Prüfung selbst scheitert', async () => {
    registerCondition({
      id: 'kaputt',
      label: 'Kaputt',
      description: '',
      group: 'Test',
      configSchema: z.object({}),
      fields: [],
      evaluate: async () => {
        throw new Error('Datenbank weg');
      },
    });
    const ergebnis = await werteBaumAus({ art: 'bedingung', typ: 'kaputt', config: {} }, kontext());
    expect(ergebnis.erfuellt).toBe(false);
  });

  it('behandelt eine leere Gruppe als keine Einschränkung', async () => {
    const ergebnis = await werteBaumAus({ art: 'gruppe', verknuepfung: 'UND', kinder: [] }, kontext());
    expect(ergebnis.erfuellt).toBe(true);
  });
});

describe('Schrittfolge', () => {
  const aktion = (label: string): StepNode => ({
    art: 'aktion',
    label,
    typ: 'test',
    config: {},
    beiFehler: 'ABBRECHEN',
    retry: { versuche: 1, basisSekunden: 30 },
  });

  it('macht aus dem Baum eine Liste mit Sprungzielen', () => {
    const flach = flache([aktion('a'), aktion('b'), aktion('c')]);
    expect(flach).toHaveLength(3);
    const start = einstieg(flach, [aktion('a')]);
    expect(start === null || typeof start === 'number').toBe(true);
  });

  /**
   * Nach einem Zweig geht es weiter, wo die Verzweigung aufhört.
   *
   * Ohne dieses Sprungziel verschluckte ein Dann-Zweig den Rest der
   * Automation - und zwar still: der Lauf endete mit SUCCESS.
   */
  it('führt nach einer Verzweigung die Folge fort', () => {
    const knoten: StepNode[] = [
      {
        art: 'wenn',
        bedingung: { art: 'gruppe', verknuepfung: 'UND', kinder: [] },
        dann: [aktion('dann')],
        sonst: [],
      },
      aktion('danach'),
    ];
    const flach = flache(knoten);
    const verzweigung = flach.find((eintrag) => eintrag.knoten.art === 'wenn');
    expect(verzweigung).toBeDefined();

    const nachDannZweig = flach.find((eintrag) => eintrag.index === verzweigung!.dann?.[0]);
    expect(nachDannZweig?.weiter).toBe(verzweigung!.weiter);
    expect(verzweigung!.weiter).not.toBeNull();
  });

  it('zählt Schritte einschliesslich beider Zweige', () => {
    expect(
      zaehleSchritte([
        {
          art: 'wenn',
          bedingung: { art: 'gruppe', verknuepfung: 'UND', kinder: [] },
          dann: [aktion('a'), aktion('b')],
          sonst: [aktion('c')],
        },
      ]),
    ).toBe(4);
  });

  /**
   * Eine Schleife ist nicht formulierbar.
   *
   * Verzweigungen tragen ihre Zweige in sich, statt auf Stellungen zu zeigen.
   * Damit ist die Folge ein Baum - und ein Baum hat keinen Zyklus.
   */
  it('weist eine Schrittfolge ab, die auf eine Stellung zeigt', () => {
    const geprueft = stepsSchema.safeParse([{ art: 'sprung', ziel: 0 }]);
    expect(geprueft.success).toBe(false);
  });

  it('begrenzt die Wartezeit auf ein Jahr', () => {
    const geprueft = stepsSchema.safeParse([{ art: 'warten', sekunden: 400 * 24 * 3600 }]);
    expect(geprueft.success).toBe(false);
  });
});

describe('Zeitplan', () => {
  /**
   * Sommer- und Winterzeit.
   *
   * «Jeden Tag um 20:00» heisst in Zürich im Winter 19:00 UTC und im Sommer
   * 18:00 UTC. Wer mit einer festen Stundenverschiebung rechnet, liegt
   * zweimal im Jahr daneben - und zwar an den beiden Tagen, an denen es
   * jemandem auffällt.
   */
  it('rechnet über die Zeitumstellung hinweg richtig', () => {
    const sommer = naechsterTermin(
      { modus: 'TAEGLICH', zeit: '20:00', zeitzone: 'Europe/Zurich' },
      new Date('2026-07-01T10:00:00Z'),
    );
    const winter = naechsterTermin(
      { modus: 'TAEGLICH', zeit: '20:00', zeitzone: 'Europe/Zurich' },
      new Date('2026-01-15T10:00:00Z'),
    );
    expect(sommer?.toISOString()).toBe('2026-07-01T18:00:00.000Z');
    expect(winter?.toISOString()).toBe('2026-01-15T19:00:00.000Z');
  });

  it('liegt immer echt nach dem Ausgangszeitpunkt', () => {
    const von = new Date('2026-07-01T18:00:00.000Z');
    const naechster = naechsterTermin({ modus: 'TAEGLICH', zeit: '20:00', zeitzone: 'Europe/Zurich' }, von);
    expect(naechster!.getTime()).toBeGreaterThan(von.getTime());
  });

  it('trifft nur die gewählten Wochentage', () => {
    // 2026-08-28 ist ein Freitag; gewählt ist Montag (1).
    const naechster = naechsterTermin(
      { modus: 'WOECHENTLICH', zeit: '09:00', wochentage: [1], zeitzone: 'Europe/Zurich' },
      new Date('2026-08-28T12:00:00Z'),
    );
    expect(naechster?.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('Webhook-Ziele', () => {
  /**
   * Die Sperrliste für interne Adressen (§30).
   *
   * `169.254.169.254` liefert bei mehreren Cloud-Anbietern die Zugangsdaten
   * der Maschine. Eine Automation, die dorthin sendet, wäre ein Weg, sie
   * herauszutragen.
   */
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('erkennt %s als intern', (adresse) => {
    expect(istInterneAdresse(adresse)).toBe(true);
  });

  it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'lässt %s als äussere Adresse zu',
    (adresse) => {
      expect(istInterneAdresse(adresse)).toBe(false);
    },
  );

  it('behandelt alles, was keine IP-Adresse ist, als intern', () => {
    expect(istInterneAdresse('nicht-eine-adresse')).toBe(true);
  });
});

describe('Aktionsregistrierung', () => {
  beforeEach(() => {
    clearRegistries();
  });

  /**
   * Keine Sanktion als Aktion (§7, §33).
   *
   * Dieser Test prüft die mitgelieferten Aktionen: keine davon darf bannen,
   * kicken, timeouten, jailen oder eine Verifikation ablehnen. Wer eine
   * solche Aktion künftig anmeldet, muss `requiresApproval` setzen - dann
   * hält die Engine den Lauf an und wartet auf einen Menschen.
   */
  it('liefert überhaupt Aktionen zum Prüfen', () => {
    // Ohne diese Zusicherung wäre der Test darunter gruen, weil er über eine
    // leere Liste läuft.
    expect(KERN_AKTIONEN.length).toBeGreaterThan(3);
  });

  it('kennt keine Aktion, die von selbst sanktioniert', () => {
    const verboten = /(ban|kick|timeout|jail|sperr|reject|ablehn|entfern.*server)/iu;
    for (const aktion of KERN_AKTIONEN) {
      if (verboten.test(aktion.id) || verboten.test(aktion.label)) {
        expect(
          aktion.requiresApproval,
          `«${aktion.label}» sanktioniert und braucht deshalb eine Freigabe`,
        ).toBe(true);
      }
    }
  });

  it('nimmt eine Aktion mit Freigabepflicht an', () => {
    const spion = vi.fn();
    registerAction({
      id: 'test.gefaehrlich',
      label: 'Gefährlich',
      description: '',
      group: 'Test',
      requiresApproval: true,
      configSchema: z.object({}),
      fields: [],
      execute: async () => {
        spion();
        return { status: 'SUCCESS' };
      },
    });
    expect(spion).not.toHaveBeenCalled();
  });
});
