import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_appeals_zwei_reiter');

/**
 * Zwei Reiter statt sieben.
 *
 * Das Team hat genau zwei Fragen an die Fallliste: woran muss ich arbeiten,
 * und was ist erledigt. Vorher standen dort sieben Reiter - jeder einzelne
 * nachvollziehbar, zusammen eine Sortieraufgabe vor der eigentlichen Arbeit,
 * und mehrere zeigten dieselben Fälle noch einmal.
 *
 * Die heikle Stelle ist nicht die Anzeige, sondern die Vollständigkeit: wenn
 * ein Endzustand in keinen der beiden Reiter fällt, verschwindet der Fall aus
 * der Liste, ohne dass es jemandem auffällt. Genau das prüft diese Datei
 * zuerst.
 */
const { prisma } = await import('@swisshub/database');
const { appeals } = await import('@swisshub/modules');
const { AppealStatus } = await import('@prisma/client');

const GILDE = '900000000000000900';

let zaehler = 0;
async function antrag(status: string, bearbeiter: string | null = null) {
  zaehler += 1;
  return prisma.appeal.create({
    data: {
      guildId: GILDE,
      caseNumber: zaehler,
      caseYear: 2026,
      applicantDiscordId: `90000000000000${String(zaehler).padStart(4, '0')}`,
      applicantUsername: `antragsteller${zaehler}`,
      status: status as never,
      answers: { antrag: 'Ich möchte gerne zurück auf den Server.' },
      ...(bearbeiter ? { assignedToDiscordId: bearbeiter, assignedToUsername: 'mod' } : {}),
      submittedAt: new Date(),
    },
  });
}

describeWithDatabase('Entbannungsanträge - zwei Reiter', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    zaehler = 0;
    await prisma.appealEvent.deleteMany({});
    await prisma.appealAttachment.deleteMany({});
    await prisma.appealInternalComment.deleteMany({});
    await prisma.appealMessage.deleteMany({});
    await prisma.appeal.deleteMany({});
    await prisma.appealCounter.deleteMany({});
  });

  // --- Vollständigkeit ----------------------------------------------------

  it('ordnet jeden eingereichten Status genau einem Reiter zu', () => {
    // Der eigentliche Punkt: kein Fall darf zwischen den Reitern
    // verschwinden, und keiner in beiden stehen.
    const offen = new Set(appeals.statusFuerAnsicht('offen'));
    const entschieden = new Set(appeals.statusFuerAnsicht('entschieden'));

    for (const status of Object.values(AppealStatus)) {
      if (status === 'DRAFT') {
        // Ein angefangener, nie eingereichter Antrag ist für das Team noch
        // nicht entstanden.
        expect(offen.has(status), status).toBe(false);
        expect(entschieden.has(status), status).toBe(false);
        continue;
      }
      const treffer = Number(offen.has(status)) + Number(entschieden.has(status));
      expect(treffer, `${status} gehört in genau einen Reiter`).toBe(1);
    }
  });

  it('zählt die wartenden Anträge zu «Offen»', () => {
    // Sie hatten vorher einen eigenen Reiter und fehlten dadurch in «Offen» -
    // ein Fall, auf den jemand wartet, ist trotzdem nicht erledigt.
    expect(appeals.statusFuerAnsicht('offen')).toContain('WAITING_FOR_APPLICANT');
    expect(appeals.statusFuerAnsicht('offen')).toContain('ESCALATED');
    expect(appeals.statusFuerAnsicht('offen')).toContain('DECISION_PENDING');
  });

  it('zählt zurückgezogene und abgelaufene Anträge zu «Entschieden»', () => {
    // Eine «Entscheidung» ist das streng genommen nicht - sie aus beiden
    // Reitern herauszuhalten hiesse aber, sie ganz verschwinden zu lassen.
    // Welcher Endzustand es war, steht an jeder Zeile.
    for (const status of ['WITHDRAWN', 'EXPIRED', 'RESOLVED_EXTERNALLY', 'CLOSED']) {
      expect(appeals.statusFuerAnsicht('entschieden'), status).toContain(status);
    }
    expect(appeals.statusFuerAnsicht('entschieden')).toContain('APPROVED');
    expect(appeals.statusFuerAnsicht('entschieden')).toContain('REJECTED');
  });

  // --- Listen und Zahlen ---------------------------------------------------

  it('listet unter «Offen» genau die offenen Fälle', async () => {
    await antrag('SUBMITTED');
    await antrag('WAITING_FOR_APPLICANT');
    await antrag('APPROVED');

    const { zeilen } = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('offen')],
    });

    expect(zeilen).toHaveLength(2);
    expect(zeilen.map((zeile) => zeile.status).sort()).toEqual(['SUBMITTED', 'WAITING_FOR_APPLICANT']);
  });

  it('listet unter «Entschieden» genau die beendeten Fälle', async () => {
    await antrag('SUBMITTED');
    await antrag('APPROVED');
    await antrag('REJECTED');
    await antrag('WITHDRAWN');

    const { zeilen } = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('entschieden')],
    });

    expect(zeilen).toHaveLength(3);
  });

  it('zählt am Reiter dasselbe, was darunter steht', async () => {
    await antrag('SUBMITTED');
    await antrag('UNDER_REVIEW');
    await antrag('APPROVED');
    await antrag('DRAFT');

    const zahlen = await appeals.zaehleAnsichten(GILDE);
    const offen = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('offen')],
    });
    const entschieden = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('entschieden')],
    });

    expect(zahlen.offen).toBe(offen.zeilen.length);
    expect(zahlen.entschieden).toBe(entschieden.zeilen.length);
    // Der Entwurf steht in keiner der beiden Zahlen.
    expect(zahlen.offen + zahlen.entschieden).toBe(3);
  });

  it('grenzt die Zahl genauso ein wie die Liste, wenn jemand nur eigene Fälle sieht', async () => {
    await antrag('SUBMITTED', 'mod-1');
    await antrag('SUBMITTED', 'mod-2');
    await antrag('SUBMITTED');

    const zahlen = await appeals.zaehleAnsichten(GILDE, 'mod-1');
    const { zeilen } = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('offen')],
      bearbeiter: 'mod-1',
    });

    expect(zahlen.offen).toBe(1);
    expect(zeilen).toHaveLength(1);
  });

  it('rechnet die Kennzahl «offen» nach derselben Liste', async () => {
    // Sie stand einmal ein zweites Mal ausgeschrieben - und eine Zahl, die
    // anders zählt als die Liste darunter, ist schlimmer als keine Zahl.
    await antrag('SUBMITTED');
    await antrag('WAITING_FOR_APPLICANT');
    await antrag('APPROVED');

    const zahlen = await appeals.kennzahlen(GILDE);
    const reiter = await appeals.zaehleAnsichten(GILDE);

    expect(zahlen.offen).toBe(reiter.offen);
  });

  // --- Daten bleiben, wie sie sind ----------------------------------------

  it('ändert keinen einzigen Antrag', async () => {
    const vorher = await antrag('WAITING_FOR_APPLICANT');

    await appeals.zaehleAnsichten(GILDE);
    await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('offen')],
    });

    const nachher = await prisma.appeal.findUniqueOrThrow({ where: { id: vorher.id } });
    expect(nachher.status).toBe('WAITING_FOR_APPLICANT');
    expect(nachher.updatedAt.getTime()).toBe(vorher.updatedAt.getTime());
  });

  it('lässt Suche und Blättern unverändert', async () => {
    for (let i = 0; i < 3; i += 1) {
      await antrag('SUBMITTED');
    }

    const gesucht = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('offen')],
      suche: 'antragsteller2',
    });
    expect(gesucht.zeilen).toHaveLength(1);

    const ersteSeite = await appeals.listeAppeals({
      guildId: GILDE,
      status: [...appeals.statusFuerAnsicht('offen')],
      limit: 2,
    });
    expect(ersteSeite.zeilen).toHaveLength(2);
    expect(ersteSeite.naechsterCursor).not.toBeNull();
  });
});

/** Und die Seite selbst zeigt wirklich nur zwei. */
const seite = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/appeals/page.tsx'), 'utf8');

it('bietet in der Oberfläche genau zwei Reiter an', () => {
  const block = seite.slice(seite.indexOf('const ANSICHTEN'), seite.indexOf('type AnsichtKey'));

  expect(block).toContain("offen: { label: 'Offen' }");
  expect(block).toContain("entschieden: { label: 'Entschieden' }");
  for (const weg of ['meine', 'unzugewiesen', 'wartet', 'eskaliert', 'abgeschlossen']) {
    expect(block, weg).not.toContain(`${weg}:`);
  }
});

it('holt Liste und Zahl über dasselbe Prädikat', () => {
  expect(seite).toContain('appeals.statusFuerAnsicht(ansicht)');
  expect(seite).toContain('appeals.zaehleAnsichten(guildId, bearbeiterFilter)');
});

it('behält Suche und Bearbeitereinschränkung', () => {
  expect(seite).toContain('name="q"');
  expect(seite).toContain('can(context, P.viewAll)');
});
