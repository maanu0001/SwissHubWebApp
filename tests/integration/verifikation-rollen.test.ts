import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_verifikation_rollen');

/**
 * Zwei Rollen nach der Verifikation.
 *
 * «Mitglied» öffnet den Server, «Verifiziert» sagt, dass jemand die Prüfung
 * bestanden hat. Auf vielen Servern hängen daran verschiedene Rechte -
 * deshalb zwei Einstellungen und nicht eine.
 *
 * Der interessante Teil ist nicht, dass beide vergeben werden, sondern dass
 * es keinen Zwischenstand gibt: beide Rollen gehen in einem Aufruf an
 * Discord. Ein halb verifiziertes Mitglied kann gar nicht entstehen.
 */
const { prisma } = await import('@swisshub/database');
const { verification, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');
const { setDiscordGateway } = await import('@swisshub/discord');

const GUILD = '200000000000000000';
const UNVERIFIZIERT = '900000000000000701';
const MITGLIED = '900000000000000702';
const VERIFIZIERT = '900000000000000703';
const NEULING = '900000000000004001';

/** Ein Discord-Zugang, der die gesetzten Rollen festhält. */
function attrappe(options: { scheitern?: boolean; startrollen?: string[] } = {}) {
  const gesetzt: Array<{ discordId: string; roleIds: string[] }> = [];
  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'neuling',
        displayName: 'Neuling',
        globalName: null,
        nickname: null,
        avatarHash: null,
        isBot: false,
        roleIds: options.startrollen ?? [UNVERIFIZIERT],
        joinedAt: new Date(),
        accountCreatedAt: new Date('2020-01-01'),
        boosting: false,
        timedOutUntil: null,
      })),
      setRoles: vi.fn(async (discordId: string, roleIds: string[]) => {
        if (options.scheitern) {
          throw new Error('Missing Permissions');
        }
        gesetzt.push({ discordId, roleIds });
      }),
    },
    channels: { send: vi.fn(async () => ({ id: 'm-1', channelId: 'c-1' })), edit: vi.fn(async () => undefined) },
    roles: { list: vi.fn(async () => []) },
    guild: { get: vi.fn(async () => ({ id: GUILD, name: 'SwissHub', ownerId: '9' })) },
    bot: { identity: vi.fn(async () => ({ discordId: 'bot', username: 'Bot' })), highestRolePosition: vi.fn(async () => 100) },
  };
  return { gateway, gesetzt };
}

async function einstellungen(options: { verifiziert?: string | null } = {}) {
  await setModuleSettings(
    verification.VERIFICATION_MODULE_ID,
    {
      unverifiedRoleId: UNVERIFIZIERT,
      memberRoleId: MITGLIED,
      verifiedRoleId: options.verifiziert === undefined ? VERIFIZIERT : options.verifiziert,
      verificationChannelId: '900000000000000801',
      moderatorChannelId: '900000000000000802',
      aiEnabled: false,
      aiAutoVerify: false,
      trustReturningMembers: false,
    },
    'test',
  );
  return verification.verificationSettings();
}

describeWithDatabase('Verifikation vergibt zwei Rollen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "VerificationMessage","VerificationRequest","ModuleState" RESTART IDENTITY CASCADE',
    );
    await setModuleEnabled(verification.VERIFICATION_MODULE_ID, true, 'test');
  });

  it('vergibt Mitglied und Verifiziert in einem Zug', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    const settings = await einstellungen();

    const ergebnis = await verification.tauscheRollen(NEULING, settings, discord.gateway as never);

    expect(ergebnis.ok).toBe(true);
    // Ein einziger Aufruf - deshalb gibt es keinen Zwischenstand.
    expect(discord.gesetzt).toHaveLength(1);
    expect(discord.gesetzt[0]?.roleIds).toContain(MITGLIED);
    expect(discord.gesetzt[0]?.roleIds).toContain(VERIFIZIERT);
  });

  it('nimmt die Rolle «Noch nicht verifiziert» weg', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    const settings = await einstellungen();

    await verification.tauscheRollen(NEULING, settings, discord.gateway as never);
    expect(discord.gesetzt[0]?.roleIds).not.toContain(UNVERIFIZIERT);
  });

  it('lässt die zweite Rolle weg, wenn keine eingestellt ist', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    const settings = await einstellungen({ verifiziert: null });

    await verification.tauscheRollen(NEULING, settings, discord.gateway as never);
    expect(discord.gesetzt[0]?.roleIds).toContain(MITGLIED);
    expect(discord.gesetzt[0]?.roleIds).not.toContain(VERIFIZIERT);
  });

  it('ist ein No-op, wenn die Rollen schon sitzen', async () => {
    const discord = attrappe({ startrollen: [MITGLIED, VERIFIZIERT] });
    setDiscordGateway(discord.gateway as never);
    const settings = await einstellungen();

    const ergebnis = await verification.tauscheRollen(NEULING, settings, discord.gateway as never);

    // Kein Fehler, keine doppelte Rolle - die Menge entscheidet.
    expect(ergebnis.ok).toBe(true);
    const rollen = discord.gesetzt[0]?.roleIds ?? [];
    expect(rollen.filter((eintrag) => eintrag === MITGLIED)).toHaveLength(1);
    expect(rollen.filter((eintrag) => eintrag === VERIFIZIERT)).toHaveLength(1);
  });

  it('behält bestehende Rollen', async () => {
    const SONDERROLLE = '900000000000000777';
    const discord = attrappe({ startrollen: [UNVERIFIZIERT, SONDERROLLE] });
    setDiscordGateway(discord.gateway as never);
    const settings = await einstellungen();

    await verification.tauscheRollen(NEULING, settings, discord.gateway as never);
    expect(discord.gesetzt[0]?.roleIds).toContain(SONDERROLLE);
  });

  it('meldet einen Fehler statt Erfolg vorzutäuschen', async () => {
    // Häufigste Ursache: die Zielrolle steht über der Bot-Rolle.
    const discord = attrappe({ scheitern: true });
    setDiscordGateway(discord.gateway as never);
    const settings = await einstellungen();

    const ergebnis = await verification.tauscheRollen(NEULING, settings, discord.gateway as never);

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toContain('Bot-Rolle');
    // Und keine der beiden Rollen sitzt - kein Teilerfolg.
    expect(discord.gesetzt).toEqual([]);
  });

  it('meldet eine fehlende Mitgliederrolle sauber', async () => {
    const discord = attrappe();
    setDiscordGateway(discord.gateway as never);
    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { unverifiedRoleId: UNVERIFIZIERT, memberRoleId: null, verifiedRoleId: VERIFIZIERT },
      'test',
    );
    const settings = await verification.verificationSettings();

    const ergebnis = await verification.tauscheRollen(NEULING, settings, discord.gateway as never);
    expect(ergebnis.ok).toBe(false);
    expect(discord.gesetzt).toEqual([]);
  });

  it('lässt beide Rollen frei einstellen', async () => {
    const settings = await einstellungen();
    expect(settings.memberRoleId).toBe(MITGLIED);
    expect(settings.verifiedRoleId).toBe(VERIFIZIERT);

    await setModuleSettings(
      verification.VERIFICATION_MODULE_ID,
      { memberRoleId: '900000000000000999', verifiedRoleId: '900000000000000998' },
      'test',
    );
    const geaendert = await verification.verificationSettings();
    expect(geaendert.memberRoleId).toBe('900000000000000999');
    expect(geaendert.verifiedRoleId).toBe('900000000000000998');
  });
});
