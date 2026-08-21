import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_communication_loading');

/**
 * Warum sich das Kommunikationsmodul nicht öffnen liess.
 *
 * Die Übersicht holte vor dem Rendern für **jeden** Textkanal einzeln die
 * Berechtigungen des Bots bei Discord. Auf einem Server mit vielen Kanälen
 * sind das ebenso viele Anfragen, bevor überhaupt etwas erscheint - unter
 * Discords Ratenbegrenzung dauert das zehn Sekunden bis Minuten. In der
 * Seitenleiste sah es so aus, als liesse sich "Kommunikation" nicht anklicken.
 *
 * Dieser Test hält fest, dass die Zahl der Discord-Anfragen nicht mehr mit der
 * Zahl der Kanäle wächst.
 */
const { prisma } = await import('@swisshub/database');
const { communication } = await import('@swisshub/modules');

const CHANNEL_COUNT = 60;

const ALL_ALLOWED = (1n << 62n) - 1n;

/**
 * Discord-Attrappe, die jede Anfrage zählt und verzögert.
 *
 * Beide Wege sind nachgebildet: die alte Abfrage je Channel und die neue
 * Sammelabfrage. So lässt sich messen, welchen der beiden der Service nimmt.
 */
function countingGateway(delayMs = 0) {
  let calls = 0;
  const wait = async (): Promise<void> => {
    calls += 1;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  };
  return {
    calls: () => calls,
    gateway: {
      channels: {
        async botPermissions() {
          await wait();
          return ALL_ALLOWED;
        },
        async botPermissionsForAll() {
          await wait();
          const result = new Map<string, bigint>();
          for (let index = 0; index < CHANNEL_COUNT; index += 1) {
            result.set(`40000000000000${(index + 100).toString().padStart(4, '0')}`, ALL_ALLOWED);
          }
          return result;
        },
      },
    } as never,
  };
}

describeWithDatabase('Kanalliste des Kommunikationsmoduls', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "DiscordChannelCache" RESTART IDENTITY CASCADE');
    await prisma.discordChannelCache.createMany({
      data: Array.from({ length: CHANNEL_COUNT }, (_unused, index) => ({
        channelId: `40000000000000${(index + 100).toString().padStart(4, '0')}`,
        name: `kanal-${index}`,
        type: 0,
        position: index,
      })),
    });
  });

  it('liefert alle Kanäle', async () => {
    const fake = countingGateway();
    const channels = await communication.listSendableChannels('NEWS', fake.gateway);
    expect(channels).toHaveLength(CHANNEL_COUNT);
  });

  it('fragt Discord nicht einmal je Kanal', async () => {
    const fake = countingGateway();
    await communication.listSendableChannels('NEWS', fake.gateway);

    // Der Kern der Sache: der Aufwand darf nicht mit der Zahl der Kanäle
    // wachsen. Vorher war es genau eine Discord-Anfrage je Kanal.
    expect(fake.calls()).toBeLessThan(CHANNEL_COUNT);
  });

  it('bleibt schnell, auch wenn Discord träge antwortet', async () => {
    // 50 ms je Anfrage. Unter Discords Ratenbegrenzung laufen viele Anfragen
    // nacheinander statt gleichzeitig - eine je Kanal ergäbe daraus drei
    // Sekunden Wartezeit, bevor die Seite überhaupt erscheint.
    const fake = countingGateway(50);
    const started = Date.now();
    await communication.listSendableChannels('NEWS', fake.gateway);
    const dauer = Date.now() - started;

    expect(fake.calls()).toBe(1);
    expect(dauer).toBeLessThan(500);
  });

  it('öffnet sich auch, wenn Discord gar nicht antwortet', async () => {
    const broken = {
      channels: {
        async botPermissions() {
          throw new Error('Discord nicht erreichbar');
        },
        async botPermissionsForAll() {
          throw new Error('Discord nicht erreichbar');
        },
      },
    } as never;

    // Ohne Discord ist die Liste da, nur ohne Angaben zu den Berechtigungen -
    // der Bereich muss sich trotzdem öffnen lassen.
    const channels = await communication.listSendableChannels('NEWS', broken);
    expect(channels).toHaveLength(CHANNEL_COUNT);
  });
});
