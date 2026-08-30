import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_ACTIONS, type AuditLogEntry, type DiscordGateway } from '@swisshub/discord';
import { moderation } from '@swisshub/modules';

/**
 * Die Erkennung von Massnahmen, die nicht über SwissHub liefen.
 *
 * Alles hier ist ohne Datenbank prüfbar: die Zuordnung eines Audit-Eintrags
 * zu einem Ereignis und die Einordnung einer Timeout-Änderung. Beides sind
 * Zusagen darüber, was **nicht** geschieht - kein fremder Eintrag wird
 * zugeordnet, kein Ablauf wird zur Aufhebung.
 */

const JETZT = new Date('2026-08-30T12:00:00.000Z');

function eintrag(teile: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '900000000000000001',
    actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD,
    userId: '100000000000000001',
    username: 'moderatorin',
    bot: false,
    targetId: '200000000000000002',
    reason: null,
    count: 1,
    channelId: null,
    createdAt: JETZT,
    ...teile,
  };
}

function gatewayMit(...antworten: Array<AuditLogEntry[] | Error>): {
  gateway: DiscordGateway;
  aufrufe: () => number;
} {
  let index = 0;
  const gateway = {
    guild: {
      auditLog: async () => {
        const antwort = antworten[Math.min(index, antworten.length - 1)];
        index += 1;
        if (antwort instanceof Error) {
          throw antwort;
        }
        return antwort;
      },
    },
  } as unknown as DiscordGateway;
  return { gateway, aufrufe: () => index };
}

/** Wartet im Test nicht wirklich - sonst dauerte jeder Lauf drei Sekunden. */
const sofort = async (): Promise<void> => {};

const suche = {
  actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD,
  targetId: '200000000000000002',
  occurredAt: JETZT,
};

describe('Zuordnung eines Audit-Eintrags', () => {
  it('findet den passenden Eintrag', async () => {
    const { gateway } = gatewayMit([eintrag()]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('gefunden');
    if (befund.status === 'gefunden') {
      expect(befund.eintrag.userId).toBe('100000000000000001');
    }
  });

  /**
   * Der wichtigste Test dieser Datei.
   *
   * Zwei Banns kurz hintereinander: ohne Prüfung des Ziels bekäme der eine
   * den Moderator des anderen zugeschrieben. Das stünde dann dauerhaft in
   * einer Akte, und niemand könnte es je bemerken.
   */
  it('weist einen Eintrag für ein anderes Ziel ab', async () => {
    const { gateway } = gatewayMit([eintrag({ targetId: '300000000000000003' })]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('kein-treffer');
  });

  it('weist einen Eintrag anderen Typs ab', async () => {
    const { gateway } = gatewayMit([
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_REMOVE }),
    ]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('kein-treffer');
  });

  /** Ein Bann von gestern gehört nicht zum Ereignis von heute. */
  it('weist einen zu alten Eintrag ab', async () => {
    const alt = new Date(JETZT.getTime() - 60 * 60 * 1000);
    const { gateway } = gatewayMit([eintrag({ createdAt: alt })]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('kein-treffer');
  });

  it('nimmt einen Eintrag am Rand des Fensters noch an', async () => {
    const knapp = new Date(JETZT.getTime() + moderation.AUDIT_FENSTER_MS - 1);
    const { gateway } = gatewayMit([eintrag({ createdAt: knapp })]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('gefunden');
  });

  it('nimmt den passenden aus mehreren Einträgen', async () => {
    const { gateway } = gatewayMit([
      eintrag({ id: '1', targetId: '300000000000000003', userId: '999' }),
      eintrag({ id: '2', targetId: '200000000000000002', userId: '111' }),
    ]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('gefunden');
    if (befund.status === 'gefunden') {
      expect(befund.eintrag.userId).toBe('111');
    }
  });
});

describe('Verspätete Audit-Einträge', () => {
  /**
   * Discord schreibt das Audit Log nicht synchron zum Gateway.
   *
   * Ohne Wiederholung verlöre ein Teil der Massnahmen genau das Wertvollste:
   * wer sie ergriffen hat.
   */
  it('findet einen Eintrag, der erst beim zweiten Versuch da ist', async () => {
    const { gateway, aufrufe } = gatewayMit([], [eintrag()]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('gefunden');
    expect(befund.versuche).toBe(2);
    expect(aufrufe()).toBe(2);
  });

  it('gibt nach der festgelegten Zahl von Versuchen auf', async () => {
    const { gateway, aufrufe } = gatewayMit([]);
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('kein-treffer');
    expect(aufrufe()).toBe(moderation.AUDIT_VERSUCHE_MS.length);
  });

  /** Kein Dauerfragen an einer Schnittstelle mit Rate Limit. */
  it('fragt nie öfter als dreimal', () => {
    expect(moderation.AUDIT_VERSUCHE_MS.length).toBeLessThanOrEqual(3);
    expect(moderation.AUDIT_VERSUCHE_MS.at(-1)).toBeLessThanOrEqual(5_000);
  });
});

describe('Wenn das Audit Log nicht lesbar ist', () => {
  /**
   * «Nicht abrufbar» ist etwas anderes als «nichts gefunden».
   *
   * Bei einem Austritt entscheidet genau dieser Unterschied darüber, ob
   * jemand freiwillig gegangen ist oder ob wir es schlicht nicht wissen. Aus
   * dem zweiten darf nie ein Kick werden.
   */
  it('unterscheidet fehlendes Recht von leerem Ergebnis', async () => {
    const { gateway } = gatewayMit(new Error('403 Missing Permissions'));
    const befund = await moderation.findeAuditEintrag(suche, { gateway, warte: sofort });

    expect(befund.status).toBe('nicht-abrufbar');
  });

  it('wirft nicht, sondern antwortet', async () => {
    const { gateway } = gatewayMit(new Error('Discord ist weg'));
    await expect(
      moderation.findeAuditEintrag(suche, { gateway, warte: sofort }),
    ).resolves.toBeDefined();
  });
});

describe('Einordnung einer Timeout-Änderung', () => {
  const spaeter = new Date(JETZT.getTime() + 3_600_000);
  const nochSpaeter = new Date(JETZT.getTime() + 7_200_000);
  const vorbei = new Date(JETZT.getTime() - 1_000);

  it('erkennt einen neuen Timeout', () => {
    expect(moderation.ordneTimeoutEin(null, spaeter, JETZT)).toEqual({
      art: 'TIMEOUT',
      bis: spaeter,
    });
  });

  it('erkennt eine geänderte Frist', () => {
    expect(moderation.ordneTimeoutEin(spaeter, nochSpaeter, JETZT)).toEqual({
      art: 'TIMEOUT_UPDATE',
      vorher: spaeter,
      bis: nochSpaeter,
    });
  });

  it('erkennt eine vorzeitige Aufhebung', () => {
    expect(moderation.ordneTimeoutEin(spaeter, null, JETZT)).toEqual({
      art: 'TIMEOUT_REMOVE',
      vorher: spaeter,
    });
  });

  /**
   * Ein abgelaufener Timeout ist keine Aufhebung.
   *
   * Er sieht wie eine aus - das Feld verschwindet in beiden Fällen. Es hat
   * aber niemand gehandelt, und in der Akte stünde sonst eine Massnahme, die
   * nie jemand ergriffen hat.
   */
  it('macht aus einem Ablauf keine Aufhebung', () => {
    expect(moderation.ordneTimeoutEin(vorbei, null, JETZT)).toBeNull();
  });

  it('ergibt nichts, wenn sich nichts geändert hat', () => {
    expect(moderation.ordneTimeoutEin(null, null, JETZT)).toBeNull();
    expect(moderation.ordneTimeoutEin(spaeter, new Date(spaeter), JETZT)).toBeNull();
  });
});

describe('Was die Zuordnung ausdrücklich prüft', () => {
  const basis = eintrag();

  it.each([
    ['anderer Typ', { actionType: AUDIT_LOG_ACTIONS.MEMBER_KICK }],
    ['anderes Ziel', { targetId: '400000000000000004' }],
    ['ausserhalb des Fensters', { createdAt: new Date(JETZT.getTime() + 60_000) }],
  ] as Array<[string, Partial<AuditLogEntry>]>)('lehnt ab: %s', (_name, abweichung) => {
    expect(moderation.passt({ ...basis, ...abweichung }, suche)).toBe(false);
  });

  it('nimmt an, wenn alles stimmt', () => {
    expect(moderation.passt(basis, suche)).toBe(true);
  });
});
