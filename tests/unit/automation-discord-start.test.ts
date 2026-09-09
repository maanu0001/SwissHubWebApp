import { describe, expect, it } from 'vitest';
import { darfAusDiscordStarten, discordTriggerConfigSchema, MAX_DISCORD_ROLLEN } from '@swisshub/automation';

/**
 * Wer eine Automation aus Discord starten darf.
 *
 * Die eine Frage, die hier falsch zu beantworten teuer wäre. Eine Automation
 * kann bannen, Rollen vergeben und Webhooks aufrufen - wer sie starten darf,
 * ist damit eine Sicherheitsentscheidung und keine Bequemlichkeit.
 *
 * Der gefährlichste Fehler wäre die naheliegende Lesart «leere Liste heisst
 * alle». Sie machte aus jeder halbfertig eingerichteten Automation einen
 * Befehl, den der ganze Server ausführen darf. Deshalb steht sie hier
 * ausdrücklich als Test und nicht nur als Kommentar.
 */

const TEAM = '900000000000007001';
const PREMIUM = '900000000000007002';
const FREMD = '900000000000007003';

describe('Freigabe des Discord-Triggers', () => {
  it('lässt jemanden mit freigegebener Rolle starten', () => {
    expect(darfAusDiscordStarten('discord', { rollen: [TEAM] }, [TEAM])).toBe(true);
  });

  it('lässt auch starten, wenn nur eine von mehreren Rollen passt', () => {
    expect(darfAusDiscordStarten('discord', { rollen: [TEAM, PREMIUM] }, [FREMD, PREMIUM])).toBe(true);
  });

  it('lehnt jemanden ohne passende Rolle ab', () => {
    expect(darfAusDiscordStarten('discord', { rollen: [TEAM] }, [FREMD])).toBe(false);
  });

  it('lehnt jemanden ganz ohne Rollen ab', () => {
    expect(darfAusDiscordStarten('discord', { rollen: [TEAM] }, [])).toBe(false);
  });

  it('versteht eine leere Freigabe als «niemand», nicht als «alle»', () => {
    // Die wichtigste Zeile dieser Datei. Die umgekehrte Lesart wäre die
    // bequeme - und machte jede unfertige Automation zum offenen Befehl.
    expect(darfAusDiscordStarten('discord', { rollen: [] }, [TEAM])).toBe(false);
    expect(darfAusDiscordStarten('discord', {}, [TEAM])).toBe(false);
  });

  it('lehnt eine Automation mit einem anderen Trigger ab', () => {
    // Eine zeitgesteuerte Automation ist über /automation nicht startbar -
    // sonst wäre der Befehl ein Weg, jede Automation auszulösen.
    expect(darfAusDiscordStarten('schedule', { rollen: [TEAM] }, [TEAM])).toBe(false);
    expect(darfAusDiscordStarten('event', { rollen: [TEAM] }, [TEAM])).toBe(false);
    expect(darfAusDiscordStarten('manual', { rollen: [TEAM] }, [TEAM])).toBe(false);
  });

  it('lehnt eine kaputte Konfiguration ab, statt sie zu übergehen', () => {
    expect(darfAusDiscordStarten('discord', null, [TEAM])).toBe(false);
    expect(darfAusDiscordStarten('discord', { rollen: 'alle' }, [TEAM])).toBe(false);
    expect(darfAusDiscordStarten('discord', { rollen: ['keine-id'] }, [TEAM])).toBe(false);
  });
});

describe('Konfiguration des Discord-Triggers', () => {
  it('nimmt nur echte Rollen-IDs an', () => {
    expect(discordTriggerConfigSchema.safeParse({ rollen: [TEAM] }).success).toBe(true);
    expect(discordTriggerConfigSchema.safeParse({ rollen: ['abc'] }).success).toBe(false);
  });

  it('begrenzt die Anzahl der Rollen', () => {
    const zuviele = Array.from({ length: MAX_DISCORD_ROLLEN + 1 }, (_unused, index) =>
      String(900000000000008000 + index),
    );
    expect(discordTriggerConfigSchema.safeParse({ rollen: zuviele }).success).toBe(false);
  });

  it('lässt einen Hinweis zu, aber keinen Roman', () => {
    expect(discordTriggerConfigSchema.safeParse({ rollen: [TEAM], hinweis: 'Nur Notfälle' }).success).toBe(
      true,
    );
    expect(discordTriggerConfigSchema.safeParse({ rollen: [TEAM], hinweis: 'x'.repeat(200) }).success).toBe(
      false,
    );
  });

  it('setzt ohne Angabe eine leere Freigabe - also niemand', () => {
    const geprueft = discordTriggerConfigSchema.parse({});
    expect(geprueft.rollen).toEqual([]);
  });
});
