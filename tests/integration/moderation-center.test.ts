import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_moderation_center');

/**
 * Das Moderation Center gegen eine echte Datenbank.
 *
 * Zwei Dinge sind hier wichtiger als alles andere:
 *
 * 1. **Die Akte lügt nicht.** Scheitert der Discord-Aufruf, darf kein
 *    «erfolgreich gebannt» in der Historie stehen. Der Versuch bleibt drin,
 *    aber als gescheitert.
 * 2. **Die Berechtigung entscheidet vor Discord.** Wer nicht bannen darf,
 *    löst gar keinen Discord-Aufruf aus - sonst wäre die Aktion schon
 *    geschehen, wenn die Prüfung greift.
 */
const { prisma } = await import('@swisshub/database');
const { moderation } = await import('@swisshub/modules');
const { createMockGateway } = await import('@swisshub/discord');

/** Nina (Moderator, Position 70). */
const NINA = '100000000000000002';
/** Spammer (nur Member, Position 5) - das übliche Ziel. */
const SPAMMER = '100000000000000004';
/** Manuel ist im Mock der Serverinhaber. */
const INHABER = '100000000000000001';

const MODERATOR_ROLLE = '900000000000000003';
const MEMBER_ROLLE = '900000000000000008';

function actor(erlaubt: string[], discordId = NINA) {
  return {
    discordId,
    username: 'nina.mod',
    roleIds: [MODERATOR_ROLLE, MEMBER_ROLLE],
    isOwner: false,
    can: (permission: string) => erlaubt.includes(permission),
  };
}

const ALLES = Object.values(moderation.MODERATION_PERMISSIONS);

describeWithDatabase('Moderation Center', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ModerationAction","AuditLog","ManagedRole","RolePermission" RESTART IDENTITY CASCADE',
    );
  });

  it('bannt und schreibt genau einen abgeschlossenen Eintrag', async () => {
    const gateway = createMockGateway();

    const eintrag = await moderation.banMember(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Werbung im Chat' },
      { gateway },
    );

    expect(eintrag.type).toBe('BAN');
    expect(eintrag.status).toBe('COMPLETED');
    expect(eintrag.reason).toBe('Werbung im Chat');

    // Und der Bann existiert bei Discord auch wirklich.
    await expect(gateway.bans.get(SPAMMER)).resolves.not.toBeNull();
  });

  it('vermerkt einen gescheiterten Discord-Aufruf als gescheitert - nicht als Erfolg', async () => {
    const gateway = createMockGateway();
    gateway.bans.add = async () => {
      throw new Error('Missing Permissions');
    };

    await expect(
      moderation.banMember(
        { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Werbung im Chat' },
        { gateway },
      ),
    ).rejects.toThrow();

    const zeilen = await prisma.moderationAction.findMany();
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.status).toBe('FAILED');

    // Das Audit Log sagt dasselbe - eine erfolgreiche Zeile wäre eine
    // Behauptung über etwas, das nicht geschehen ist.
    const audit = await prisma.auditLog.findMany();
    expect(audit.every((zeile) => zeile.success === false)).toBe(true);
  });

  it('lehnt eine Massnahme ohne Berechtigung ab, bevor Discord etwas tut', async () => {
    const gateway = createMockGateway();
    let aufgerufen = false;
    gateway.bans.add = async () => {
      aufgerufen = true;
    };

    await expect(
      moderation.banMember(
        { actor: actor([]), targetDiscordId: SPAMMER, reason: 'Werbung im Chat' },
        { gateway },
      ),
    ).rejects.toThrow(/bannen/i);

    expect(aufgerufen).toBe(false);
    // Kein Eintrag: ein Versuch, der die Berechtigung nicht hat, ist kein
    // Vorgang in der Akte des Mitglieds.
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  it('lehnt eine Massnahme gegen den Serverinhaber ab', async () => {
    const gateway = createMockGateway();

    await expect(
      moderation.kickMember(
        { actor: actor(ALLES), targetDiscordId: INHABER, reason: 'Test der Rangfolge' },
        { gateway },
      ),
    ).rejects.toThrow(/Owner/i);
  });

  it('lehnt Selbstmoderation ab und erklärt es verständlich', async () => {
    const gateway = createMockGateway();

    const fehler = await moderation
      .timeoutMember(
        { actor: actor(ALLES), targetDiscordId: NINA, reason: 'Selbstversuch', seconds: 600 },
        { gateway },
      )
      .then(
        () => null,
        (error: unknown) => error as { code?: string; userMessage?: string; message?: string },
      );

    // Der Grund für die Ablehnung steht im Code, die Erklärung für den
    // Menschen in `userMessage` - die interne Meldung landet nicht im Browser.
    expect(fehler?.message).toBe('SELF_TARGET');
    expect(fehler?.userMessage).toMatch(/dich selbst/i);
  });

  it('verlangt einen Grund', async () => {
    const gateway = createMockGateway();

    await expect(
      moderation.kickMember({ actor: actor(ALLES), targetDiscordId: SPAMMER, reason: '  ' }, { gateway }),
    ).rejects.toThrow(/Grund/i);
  });

  it('begrenzt den Timeout auf die 28 Tage, die Discord erlaubt', async () => {
    const gateway = createMockGateway();

    await expect(
      moderation.timeoutMember(
        {
          actor: actor(ALLES),
          targetDiscordId: SPAMMER,
          reason: 'Zu lang',
          seconds: moderation.MAX_TIMEOUT_SECONDS + 1,
        },
        { gateway },
      ),
    ).rejects.toThrow(/28 Tage/);
  });

  it('führt einen laufenden Timeout und lässt ihn durch die Aufhebung verschwinden', async () => {
    const gateway = createMockGateway();

    await moderation.timeoutMember(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Spam im Chat', seconds: 3600 },
      { gateway },
    );

    const laufend = await moderation.aktiveTimeouts();
    expect(laufend.map((eintrag) => eintrag.targetDiscordId)).toEqual([SPAMMER]);
    // Das geplante Ende steht in einer Spalte, nicht im Metadaten-JSON -
    // sonst liesse sich nicht danach filtern.
    expect(laufend[0]?.expiresAt).toBeInstanceOf(Date);

    await moderation.removeTimeout(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Einspruch angenommen' },
      { gateway },
    );

    expect(await moderation.aktiveTimeouts()).toEqual([]);
  });

  it('zählt einen gescheiterten Timeout nicht als laufend', async () => {
    const gateway = createMockGateway();
    gateway.members.timeout = async () => {
      throw new Error('Missing Permissions');
    };

    await expect(
      moderation.timeoutMember(
        { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Spam im Chat', seconds: 3600 },
        { gateway },
      ),
    ).rejects.toThrow();

    expect(await moderation.aktiveTimeouts()).toEqual([]);
  });

  it('hebt einen Bann auf und lehnt es ab, wenn keiner besteht', async () => {
    const gateway = createMockGateway();

    await expect(
      moderation.unbanMember(
        { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Es gibt gar keinen Bann' },
        { gateway },
      ),
    ).rejects.toThrow(/kein Bann/i);

    await moderation.banMember(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Werbung im Chat' },
      { gateway },
    );
    const aufhebung = await moderation.unbanMember(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Einspruch angenommen' },
      { gateway },
    );

    expect(aufhebung.status).toBe('COMPLETED');
    await expect(gateway.bans.get(SPAMMER)).resolves.toBeNull();
  });

  it('legt eine Notiz an, ohne Discord anzufassen', async () => {
    const gateway = createMockGateway();
    let angefasst = false;
    for (const name of ['kick', 'timeout'] as const) {
      gateway.members[name] = (async () => {
        angefasst = true;
      }) as never;
    }
    gateway.bans.add = async () => {
      angefasst = true;
    };

    const eintrag = await moderation.addModerationNote(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Vorwarnung ausgesprochen' },
      { gateway },
    );

    expect(eintrag.type).toBe('NOTE');
    expect(eintrag.status).toBe('COMPLETED');
    expect(angefasst).toBe(false);
  });

  it('blättert den Verlauf über einen Cursor ohne Lücken und ohne Dopplungen', async () => {
    const gateway = createMockGateway();
    for (let index = 0; index < 5; index += 1) {
      await moderation.addModerationNote(
        { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: `Notiz Nummer ${index}` },
        { gateway },
      );
    }

    const erste = await moderation.listActions({ pageSize: 2 });
    expect(erste.zeilen).toHaveLength(2);
    expect(erste.naechsterCursor).not.toBeNull();

    const zweite = await moderation.listActions({
      pageSize: 2,
      cursor: erste.naechsterCursor ?? undefined,
    });
    const dritte = await moderation.listActions({
      pageSize: 2,
      cursor: zweite.naechsterCursor ?? undefined,
    });

    const gesehen = [...erste.zeilen, ...zweite.zeilen, ...dritte.zeilen].map((zeile) => zeile.id);
    expect(new Set(gesehen).size).toBe(5);
    expect(dritte.naechsterCursor).toBeNull();
  });

  it('filtert den Verlauf nach Massnahme', async () => {
    const gateway = createMockGateway();
    await moderation.addModerationNote(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Nur eine Notiz' },
      { gateway },
    );
    await moderation.banMember(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Werbung im Chat' },
      { gateway },
    );

    const nurBanns = await moderation.listActions({ type: ['BAN'] });
    expect(nurBanns.zeilen).toHaveLength(1);
    expect(nurBanns.zeilen[0]?.type).toBe('BAN');
  });

  it('verschweigt Kennzahlen, die der Betrachter nicht sehen darf', async () => {
    const gateway = createMockGateway();
    await moderation.addModerationNote(
      { actor: actor(ALLES), targetDiscordId: SPAMMER, reason: 'Vorwarnung ausgesprochen' },
      { gateway },
    );

    const ohne = await moderation.moderationOverview(
      { moderation: false, jail: false, banns: false },
      { gateway },
    );
    // `undefined`, nicht `0`: eine Null wäre die Auskunft «es ist nichts
    // passiert», und die steht dieser Person nicht zu.
    expect(ohne.heute).toBeUndefined();
    expect(ohne.aktiveJails).toBeUndefined();
    expect(ohne.banns).toBeUndefined();

    const mit = await moderation.moderationOverview(
      { moderation: true, jail: true, banns: true },
      { gateway },
    );
    expect(mit.heute).toBe(1);
    expect(mit.aktiveJails).toBe(0);
    expect(mit.banns).toBe(0);
  });

  it('meldet die Bannzahl als unbekannt, wenn Discord nicht antwortet', async () => {
    const gateway = createMockGateway();
    gateway.bans.list = async () => {
      throw new Error('Service Unavailable');
    };

    const zahlen = await moderation.moderationOverview(
      { moderation: false, jail: false, banns: true },
      { gateway },
    );

    // `null` heisst «wir wissen es nicht». Eine Null hiesse «es gibt keine».
    expect(zahlen.banns).toBeNull();
  });
});
