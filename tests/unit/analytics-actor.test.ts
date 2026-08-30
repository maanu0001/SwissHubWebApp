import { describe, expect, it } from 'vitest';
import { analytics } from '@swisshub/modules';
import { AUDIT_LOG_ACTIONS, type AuditLogEntry, type DiscordGateway } from '@swisshub/discord';

/**
 * Die Zuordnung eines Verursachers.
 *
 * Der wichtigste Fall in dieser Datei ist der, in dem **nichts** zugeordnet
 * wird. Discord nennt bei einer gelöschten Nachricht nicht, wer sie gelöscht
 * hat; die einzige weitere Quelle ist das Audit Log, und die ist unscharf.
 * Ein Protokoll, das in dieser Lage rät, ist schlimmer als eines, das
 * schweigt - es sieht aus wie ein Beweis.
 */

const JETZT = new Date('2026-08-26T12:00:00.000Z');

function gatewayMit(eintraege: AuditLogEntry[]): DiscordGateway {
  return {
    guild: { auditLog: async () => eintraege },
  } as unknown as DiscordGateway;
}

function eintrag(teile: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: '1',
    actionType: AUDIT_LOG_ACTIONS.MESSAGE_DELETE,
    userId: 'mod-1',
    username: 'nina.mod',
    bot: false,
    targetId: 'user-1',
    reason: null,
    count: 1,
    channelId: 'kanal-1',
    createdAt: JETZT,
    ...teile,
  };
}

const ANFRAGE = {
  actionType: AUDIT_LOG_ACTIONS.MESSAGE_DELETE,
  targetId: 'user-1',
  occurredAt: JETZT,
  channelId: 'kanal-1',
};

describe('Analytics - Zuordnung des Verursachers', () => {
  it('ordnet zu, wenn Ziel, Kanal und Zeitpunkt passen', async () => {
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([eintrag()]) });

    expect(urteil.discordId).toBe('mod-1');
    expect(urteil.source).toBe('AUDIT_LOG');
  });

  it('ordnet nicht zu, wenn kein Eintrag vorliegt', async () => {
    // Der Normalfall bei einer Selbstlöschung: Discord schreibt dafür gar
    // keinen Audit-Eintrag.
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([]) });

    expect(urteil.discordId).toBeNull();
    expect(urteil.source).toBe('UNKNOWN');
  });

  it('ordnet nicht zu, wenn der Eintrag zu alt ist', async () => {
    // Discord zählt bei wiederholtem Löschen denselben Eintrag hoch und lässt
    // den Zeitstempel stehen. Ein alter Eintrag beweist deshalb nichts über
    // das, was gerade geschehen ist.
    const alt = eintrag({ createdAt: new Date(JETZT.getTime() - 60_000) });
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([alt]) });

    expect(urteil.source).toBe('UNKNOWN');
  });

  it('ordnet nicht zu, wenn ein anderes Ziel betroffen war', async () => {
    const fremd = eintrag({ targetId: 'user-2' });
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([fremd]) });

    expect(urteil.source).toBe('UNKNOWN');
  });

  it('ordnet nicht zu, wenn es in einem anderen Kanal geschah', async () => {
    const anderswo = eintrag({ channelId: 'kanal-2' });
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([anderswo]) });

    expect(urteil.source).toBe('UNKNOWN');
  });

  it('ordnet nicht zu, wenn Discord keinen Benutzer nennt', async () => {
    const ohneBenutzer = eintrag({ userId: null });
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([ohneBenutzer]) });

    expect(urteil.source).toBe('UNKNOWN');
  });

  it('ordnet nicht zu, wenn das Audit Log gar nicht abrufbar ist', async () => {
    // Fehlt dem Bot `VIEW_AUDIT_LOG`, ist «unbekannt» die richtige Antwort -
    // nicht ein Fehler, der den Aufrufer beschäftigt.
    const kaputt = {
      guild: {
        auditLog: async () => {
          throw new Error('Missing Permissions');
        },
      },
    } as unknown as DiscordGateway;

    await expect(analytics.correlateActor(ANFRAGE, { gateway: kaputt })).resolves.toEqual(
      analytics.UNBEKANNT,
    );
  });

  it('übernimmt den Grund aus dem Audit Log, wenn einer angegeben wurde', async () => {
    const mitGrund = eintrag({ reason: 'Werbung' });
    const urteil = await analytics.correlateActor(ANFRAGE, { gateway: gatewayMit([mitGrund]) });

    expect(urteil.reason).toBe('Werbung');
  });
});

describe('Analytics - CSV-Export', () => {
  const zeile = {
    id: 'e1',
    guildId: 'g1',
    category: 'MESSAGE' as const,
    type: 'MESSAGE_DELETE',
    severity: 'NOTICE' as const,
    actorDiscordId: null,
    actorUsername: null,
    actorSource: 'UNKNOWN' as const,
    subjectDiscordId: '100000000000000004',
    subjectUsername: 'spammer99',
    channelId: 'k1',
    channelName: 'allgemein',
    messageId: 'm1',
    moderationActionId: null,
    bulkId: null,
    metadata: {},
    occurredAt: JETZT,
    createdAt: JETZT,
  };

  it('lässt die Inhaltsspalten ganz weg, wenn sie nicht gezeigt werden dürfen', () => {
    const ohne = analytics.toCsv([zeile], false);
    const mit = analytics.toCsv([{ ...zeile, contentBefore: 'geheim', contentAfter: null }], true);

    // Nicht leere Zellen, sondern gar keine Spalten: aus einer leeren Zelle
    // schlösse jemand, es habe nichts darin gestanden.
    expect(ohne).not.toContain('Vorher');
    expect(ohne).not.toContain('geheim');
    expect(mit).toContain('Vorher');
    expect(mit).toContain('geheim');
  });

  it('entschärft Felder, die Excel als Formel ausführen würde', () => {
    const boesartig = { ...zeile, subjectUsername: '=HYPERLINK("http://boese","klick")' };
    const csv = analytics.toCsv([boesartig], false);

    // Vorangestelltes Apostroph: der Text bleibt lesbar, wird aber nicht
    // ausgeführt.
    expect(csv).toContain('"\'=HYPERLINK');
  });

  it('maskiert Anführungszeichen nach RFC 4180', () => {
    const mitZitat = { ...zeile, channelName: 'der "gute" Kanal' };
    expect(analytics.toCsv([mitZitat], false)).toContain('"der ""gute"" Kanal"');
  });

  it('beginnt mit einem BOM, damit Excel Umlaute richtig liest', () => {
    expect(analytics.toCsv([zeile], false).startsWith('﻿')).toBe(true);
  });
});
