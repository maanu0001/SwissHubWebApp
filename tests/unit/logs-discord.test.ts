import { describe, expect, it } from 'vitest';
import { logs, analytics } from '@swisshub/modules';
import { DiscordApiError } from '@swisshub/discord';
import type { DiscordEvent, ModerationAction } from '@swisshub/database';

/**
 * Die Discord-Ausgabe der Logs - alles, was ohne Datenbank prüfbar ist.
 *
 * Die wichtigsten Zusagen sind Zusagen darüber, was **nicht** in Discord
 * landet: keine internen Notizen, kein `@everyone`, kein Embed jenseits der
 * Grenzen, und nichts zweimal.
 */

const JETZT = new Date('2026-08-30T20:32:00.000Z');

function massnahme(teile: Partial<ModerationAction> = {}): ModerationAction {
  return {
    id: 'mod-1',
    type: 'BAN',
    module: 'moderation',
    actorDiscordId: '100000000000000001',
    actorUsername: 'nina.mod',
    actorType: 'HUMAN',
    targetDiscordId: '200000000000000002',
    targetUsername: 'spammer',
    reason: 'Spam nach mehrfacher Verwarnung',
    status: 'COMPLETED',
    referenceId: null,
    expiresAt: null,
    source: 'DISCORD',
    discordAuditLogEntryId: null,
    detectedAt: null,
    metadata: {},
    createdAt: JETZT,
    ...teile,
  } as ModerationAction;
}

function ereignis(teile: Partial<DiscordEvent> = {}): DiscordEvent {
  return {
    id: 'ev-1',
    guildId: '900000000000000009',
    category: 'MESSAGE',
    type: analytics.EVENT_TYPES.MESSAGE_DELETE,
    severity: 'WARNING',
    actorDiscordId: null,
    actorUsername: null,
    actorSource: 'UNKNOWN',
    subjectDiscordId: '200000000000000002',
    subjectUsername: 'spammer',
    channelId: '300000000000000003',
    channelName: 'general',
    messageId: '400000000000000004',
    contentBefore: 'Hallo Welt',
    contentAfter: null,
    moderationActionId: null,
    bulkId: null,
    metadata: {},
    occurredAt: JETZT,
    createdAt: JETZT,
    ...teile,
  } as DiscordEvent;
}

/** Alle Textstücke eines Embeds - für die Frage «steht das drin?». */
function alsText(embed: unknown): string {
  return JSON.stringify(embed);
}

describe('Kategorien', () => {
  it('kennt für jede Kategorie eine Beschreibung', () => {
    for (const id of logs.LOG_KATEGORIE_IDS) {
      const definition = logs.kategorie(id);
      expect(definition.label).toBeTruthy();
      expect(definition.beschreibung).toBeTruthy();
    }
  });

  it.each([
    ['MESSAGE', 'MESSAGES'],
    ['VOICE', 'VOICE'],
    ['MEMBER', 'MEMBERS'],
    ['ROLE', 'ADMIN'],
    ['CHANNEL', 'ADMIN'],
    ['SERVER', 'ADMIN'],
  ] as Array<[DiscordEvent['category'], string]>)('ordnet %s nach %s', (category, erwartet) => {
    expect(logs.kategorieFuerEreignis({ category, type: 'IRGENDWAS' })).toBe(erwartet);
  });

  /**
   * Ein Bann steht einmal in Discord, nicht zweimal.
   *
   * Er erzeugt beides: einen Akteneintrag und ein Statistikereignis. Die Akte
   * meldet ihn, der Statistikpfad schweigt.
   */
  it.each([
    analytics.EVENT_TYPES.MEMBER_BAN,
    analytics.EVENT_TYPES.MEMBER_UNBAN,
    analytics.EVENT_TYPES.MEMBER_TIMEOUT,
    analytics.EVENT_TYPES.MEMBER_TIMEOUT_END,
  ])('lässt %s über den Statistikpfad nicht hinaus', (type) => {
    expect(logs.kategorieFuerEreignis({ category: 'MEMBER', type })).toBeNull();
  });

  /** Ein Austritt bleibt ein Austritt - auch wenn er ein Kick war. */
  it('gibt einen Austritt weiterhin aus', () => {
    expect(
      logs.kategorieFuerEreignis({ category: 'MEMBER', type: analytics.EVENT_TYPES.MEMBER_LEAVE }),
    ).toBe('MEMBERS');
  });

  /** Was zu einer Massnahme dieses Dashboards gehört, meldet die Akte. */
  it('überspringt ein Ereignis, das an einer Massnahme hängt', () => {
    expect(
      logs.kategorieFuerEreignis({
        category: 'MESSAGE',
        type: analytics.EVENT_TYPES.MESSAGE_DELETE,
        moderationActionId: 'mod-1',
      }),
    ).toBeNull();
  });
});

describe('Was nicht nach Discord geht', () => {
  /**
   * Eine interne Notiz ist intern.
   *
   * Sie in einen Kanal zu schreiben, den das halbe Team liest, wäre kein
   * Versehen mit kleiner Wirkung - es ist genau das, wogegen es sie gibt.
   */
  it('führt Notizen und Jail-Vorgänge nicht in der Discord-Ausgabe', () => {
    expect(logs.NICHT_NACH_DISCORD.has('NOTE')).toBe(true);
    expect(logs.NICHT_NACH_DISCORD.has('JAIL_CREATE')).toBe(true);
    expect(logs.NICHT_NACH_DISCORD.has('BAN')).toBe(false);
  });
});

describe('Embed einer Massnahme', () => {
  it('nennt Mitglied, Moderator, Grund und Quelle', () => {
    const text = alsText(logs.formatiereMassnahme(massnahme()));
    expect(text).toContain('gebannt');
    expect(text).toContain('spammer');
    expect(text).toContain('nina.mod');
    expect(text).toContain('Spam nach mehrfacher Verwarnung');
    expect(text).toContain('Discord');
  });

  it.each([
    ['WEBAPP', 'SwissHub WebApp'],
    ['BOT', 'SwissHub Bot'],
    ['DISCORD', 'Discord'],
    ['SYSTEM', 'System'],
  ] as Array<[ModerationAction['source'], string]>)('zeigt die Quelle %s als «%s»', (source, label) => {
    const text = alsText(logs.formatiereMassnahme(massnahme({ source })));
    expect(text).toContain(label);
  });

  /** Ohne Grund wird keiner erfunden - aber das Feld schweigt auch nicht. */
  it('sagt ausdrücklich, wenn kein Grund angegeben wurde', () => {
    const text = alsText(logs.formatiereMassnahme(massnahme({ reason: null })));
    expect(text).toContain('Kein Grund angegeben');
  });

  /** Ein unbekannter Handelnder bekommt keinen Namen angedichtet. */
  it('nennt einen unbekannten Moderator «Unbekannt»', () => {
    const embed = logs.formatiereMassnahme(
      massnahme({ actorType: 'UNKNOWN', actorDiscordId: 'unknown', actorUsername: 'Unbekannt' }),
    );
    const text = alsText(embed);
    expect(text).toContain('Unbekannt');
    expect(text).not.toContain('`unknown`');
  });

  it('kennzeichnet einen Bot als Bot', () => {
    const text = alsText(
      logs.formatiereMassnahme(massnahme({ actorType: 'BOT', actorUsername: 'AutoMod' })),
    );
    expect(text).toContain('AutoMod (Bot)');
  });

  /**
   * Die Metadaten gehen nicht mit hinaus.
   *
   * Sie tragen bei einem Jail interne Vermerke. Ein Formatter, der «einfach
   * alles» ausgäbe, trüge beim nächsten neuen Feld etwas nach Discord, das
   * niemand dorthin gestellt hat.
   */
  it('gibt die Metadaten der Massnahme nicht aus', () => {
    const text = alsText(
      logs.formatiereMassnahme(
        massnahme({ metadata: { interneNotiz: 'GEHEIMER VERMERK', deleteMessageSeconds: 604_800 } }),
      ),
    );
    expect(text).not.toContain('GEHEIMER VERMERK');
    expect(text).not.toContain('interneNotiz');
  });
});

describe('Embed eines Ereignisses', () => {
  it('zeigt Kanal und Inhalt einer gelöschten Nachricht', () => {
    const text = alsText(logs.formatiereEreignis(ereignis()));
    expect(text).toContain('gelöscht');
    expect(text).toContain('#general');
    expect(text).toContain('Hallo Welt');
  });

  /**
   * «Gelöscht von X» nur mit Beleg.
   *
   * Discord nennt bei einer gelöschten Nachricht nicht, wer sie gelöscht hat.
   * Eine Vermutung in einem Kanal, den der halbe Server liest, ist etwas
   * anderes als eine Vermutung in einer Datenbankspalte.
   */
  it('nennt keinen Verursacher, wenn er nicht belegt ist', () => {
    const text = alsText(
      logs.formatiereEreignis(
        ereignis({ actorDiscordId: '999', actorUsername: 'jemand', actorSource: 'UNKNOWN' }),
      ),
    );
    expect(text).not.toContain('jemand');
  });

  it('nennt den Verursacher, wenn das Audit Log ihn belegt', () => {
    const text = alsText(
      logs.formatiereEreignis(
        ereignis({ actorDiscordId: '999', actorUsername: 'nina.mod', actorSource: 'AUDIT_LOG' }),
      ),
    );
    expect(text).toContain('nina.mod');
  });

  it('zeigt bei einer Bearbeitung vorher und nachher', () => {
    const text = alsText(
      logs.formatiereEreignis(
        ereignis({
          type: analytics.EVENT_TYPES.MESSAGE_EDIT,
          contentBefore: 'alte Nachricht',
          contentAfter: 'neue Nachricht',
        }),
      ),
    );
    expect(text).toContain('alte Nachricht');
    expect(text).toContain('neue Nachricht');
  });

  /** Ein Link auf eine gelöschte Nachricht führt ins Leere. */
  it('verlinkt eine bearbeitete Nachricht, eine gelöschte nicht', () => {
    const bearbeitet = alsText(
      logs.formatiereEreignis(ereignis({ type: analytics.EVENT_TYPES.MESSAGE_EDIT })),
    );
    const geloescht = alsText(logs.formatiereEreignis(ereignis()));
    expect(bearbeitet).toContain('discord.com/channels/');
    expect(geloescht).not.toContain('discord.com/channels/');
  });

  it('zeigt beim Kanalwechsel Von und Nach', () => {
    const text = alsText(
      logs.formatiereEreignis(
        ereignis({
          category: 'VOICE',
          type: analytics.EVENT_TYPES.VOICE_MOVE,
          channelName: 'CS2',
          metadata: { von: '111', vonName: 'Lobby' },
        }),
      ),
    );
    expect(text).toContain('Lobby');
    expect(text).toContain('CS2');
  });

  it('nutzt Discords Zeitschreibweise statt fester Schweizer Zeit', () => {
    const text = alsText(logs.formatiereEreignis(ereignis()));
    expect(text).toMatch(/<t:\d+:F>/u);
  });
});

describe('Discords Grenzen', () => {
  it('kürzt einen zu langen Titel', () => {
    const embed = logs.begrenze({ title: 'A'.repeat(500) });
    expect(embed.title?.length).toBeLessThanOrEqual(logs.EMBED_LIMITS.title);
  });

  it('kürzt einen zu langen Feldwert und sagt es', () => {
    const embed = logs.begrenze({ fields: [{ name: 'Inhalt', value: 'B'.repeat(5_000) }] });
    expect(embed.fields?.[0]?.value.length).toBeLessThanOrEqual(logs.EMBED_LIMITS.fieldValue);
    expect(embed.fields?.[0]?.value).toContain('gekürzt');
  });

  it('lässt nie mehr als 25 Felder übrig', () => {
    const embed = logs.begrenze({
      fields: Array.from({ length: 40 }, (_, i) => ({ name: `F${i}`, value: 'x' })),
    });
    expect(embed.fields?.length).toBeLessThanOrEqual(logs.EMBED_LIMITS.fields);
  });

  /**
   * Ein Embed kann jede Einzelgrenze einhalten und trotzdem zu gross sein.
   *
   * Discord zählt Titel, Beschreibung, Feldnamen, Feldwerte und Fusszeile
   * zusammen. Genau daran scheitert sonst ausgerechnet das interessanteste
   * Log - eine sehr lange gelöschte Nachricht.
   */
  it('hält die Gesamtgrenze ein', () => {
    const embed = logs.begrenze({
      title: 'T'.repeat(200),
      description: 'D'.repeat(4_000),
      fields: Array.from({ length: 20 }, (_, i) => ({ name: `F${i}`, value: 'v'.repeat(1_000) })),
      footer: { text: 'SwissHub' },
    });
    expect(logs.gesamtlaenge(embed)).toBeLessThanOrEqual(logs.EMBED_LIMITS.gesamt);
  });

  it('erzeugt aus einer sehr langen Nachricht ein gültiges Embed', () => {
    const embed = logs.formatiereEreignis(ereignis({ contentBefore: 'X'.repeat(10_000) }));
    expect(logs.gesamtlaenge(embed)).toBeLessThanOrEqual(logs.EMBED_LIMITS.gesamt);
    for (const feld of embed.fields ?? []) {
      expect(feld.value.length).toBeLessThanOrEqual(logs.EMBED_LIMITS.fieldValue);
    }
  });

  it('lässt kein leeres Feld entstehen', () => {
    const embed = logs.formatiereEreignis(
      ereignis({ subjectUsername: null, subjectDiscordId: null, contentBefore: null }),
    );
    for (const feld of embed.fields ?? []) {
      expect(feld.value.length).toBeGreaterThan(0);
      expect(feld.name.length).toBeGreaterThan(0);
    }
  });
});

describe('Der Schlüssel gegen Doppelnachrichten', () => {
  it('ist für denselben Eintrag im selben Kanal derselbe', () => {
    expect(logs.dedupeKey('moderation', 'mod-1', 'kanal-1')).toBe(
      logs.dedupeKey('moderation', 'mod-1', 'kanal-1'),
    );
  });

  /** Zwei Kategorien im selben Kanal sind zwei Einträge, nicht einer. */
  it('unterscheidet Kanäle und Quellen', () => {
    expect(logs.dedupeKey('moderation', 'x', 'a')).not.toBe(logs.dedupeKey('moderation', 'x', 'b'));
    expect(logs.dedupeKey('moderation', 'x', 'a')).not.toBe(logs.dedupeKey('event', 'x', 'a'));
  });
});

describe('Wiederholen oder aufgeben', () => {
  class Fehler extends Error {
    constructor(
      readonly status: number,
      readonly discordCode: number | undefined,
    ) {
      super('discord');
      this.name = 'DiscordApiError';
    }
  }

  /**
   * Ein gelöschter Kanal wird nicht dadurch wieder da, dass man es nochmal
   * probiert. Solche Fehler beenden die Zustellung sofort.
   */
  it.each([
    [10_003, 'Unknown Channel'],
    [50_001, 'Missing Access'],
    [50_013, 'Missing Permissions'],
  ])('gibt bei %i (%s) auf', (code) => {
    expect(logs.istDauerhaft(new DiscordApiError(403, code as number, '/x', 'nope'))).toBe(true);
  });

  it('wiederholt bei einer Störung', () => {
    expect(logs.istDauerhaft(new DiscordApiError(502, undefined, '/x', 'bad gateway'))).toBe(false);
    expect(logs.istDauerhaft(new Fehler(500, undefined))).toBe(false);
    expect(logs.istDauerhaft(new Error('Netzwerk weg'))).toBe(false);
  });

  it('wiederholt nicht endlos', () => {
    expect(logs.MAX_VERSUCHE).toBeLessThanOrEqual(3);
  });

  /** Hundert Ereignisse ergeben keine hundert gleichzeitigen Anfragen. */
  it('begrenzt Stapel und Gleichzeitigkeit', () => {
    expect(logs.STAPEL).toBeLessThanOrEqual(50);
    expect(logs.PARALLEL).toBeLessThanOrEqual(5);
  });
});

describe('Die Testnachricht', () => {
  it('sagt ausdrücklich, dass sie kein Logeintrag ist', () => {
    const text = alsText(logs.formatiereTest('Moderation'));
    expect(text).toContain('Log-Test');
    expect(text).toContain('kein');
    expect(text).toContain('Moderation');
  });
});
