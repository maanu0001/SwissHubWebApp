import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_jail_unter_moderation');

/**
 * Jail ist eine Moderationsmassnahme geworden - und der Vote Jail nicht.
 *
 * Die Strafakte stand historisch als eigenes Hauptmodul neben der Moderation,
 * weil sie zuerst da war. Für das Team hiess das: dieselbe Person, zwei
 * Bereiche, und bei jedem Vorgang die Frage, welchen man aufmacht.
 *
 * Was sich dabei NICHT ändern durfte, ist der Kern: derselbe Jail Service,
 * dieselben Berechtigungen, dieselben Seiten, dieselbe Freilassung. Diese
 * Datei hält beides fest - dass die Wege sich geändert haben und dass die
 * Fachlichkeit es nicht hat.
 *
 * Der Vote Jail bleibt ausdrücklich für sich: er ist keine Massnahme des
 * Teams, sondern eine Abstimmung der Gemeinschaft. Wer daran teilnimmt, sieht
 * in aller Regel gar keinen Moderationsbereich - und soll ihn nicht brauchen.
 */
const { prisma } = await import('@swisshub/database');
const { jail, buildNavigation, listModuleDefinitions, moduleViewPermission } = await import(
  '@swisshub/modules'
);
const { PERMISSION_PRESETS, resolvePreset } = await import('@swisshub/permissions');

const P = jail.JAIL_PERMISSIONS;
const JAIL_SEHEN = moduleViewPermission('jail');
const ALLE_MODULE = new Set(listModuleDefinitions().map((modul) => modul.id));

const nav = (rechte: string[]) => buildNavigation(rechte, ALLE_MODULE);

const seite = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(`../../apps/web/src/${pfad}`, import.meta.url)), 'utf8');

const gibtEs = (pfad: string): boolean =>
  existsSync(fileURLToPath(new URL(`../../apps/web/src/${pfad}`, import.meta.url)));

describeWithDatabase('Jail unter Moderation', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "JailEntry","VoteJailVote","VoteJail","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  // --- Wo die Seiten jetzt stehen ----------------------------------------

  it('führt die Jail-Seiten unter Moderation', () => {
    for (const pfad of [
      'app/(app)/moderation/jail/page.tsx',
      'app/(app)/moderation/jail/[id]/page.tsx',
      'app/(app)/moderation/jail/import/page.tsx',
    ]) {
      expect(gibtEs(pfad), pfad).toBe(true);
    }
  });

  it('lässt die alten Adressen nicht ins Leere laufen', () => {
    // Sie stehen in Lesezeichen, in Moderationsprotokollen und in alten
    // Discord-Nachrichten. Ein 404 wäre die schlechteste Antwort darauf.
    for (const [pfad, ziel] of [
      ['app/(app)/jail/page.tsx', '/moderation/jail'],
      ['app/(app)/jail/import/page.tsx', '/moderation/jail/import'],
      ['app/(app)/jail/votes/page.tsx', '/vote-jail'],
    ] as const) {
      const quelle = seite(pfad);
      expect(quelle, pfad).toContain('permanentRedirect');
      expect(quelle, pfad).toContain(ziel);
    }
  });

  it('leitet auch einen einzelnen Vorgang weiter', () => {
    // Genau diese Links stehen in der Mitgliederakte - ohne sie führte der
    // Verlauf eines Mitglieds ins Leere.
    const quelle = seite('app/(app)/jail/[id]/page.tsx');

    expect(quelle).toContain('permanentRedirect');
    expect(quelle).toContain('`/moderation/jail/${id}`');
  });

  it('zeigt in der Mitgliederakte und im Dashboard die neue Adresse', () => {
    expect(seite('app/(app)/members/[discordId]/page.tsx')).toContain('`/moderation/jail/${eintrag.id}`');
    expect(seite('app/(app)/dashboard/page.tsx')).toContain("href: '/moderation/jail'");
  });

  // --- Was in der Seitenleiste steht -------------------------------------

  it('gibt dem Team keinen eigenen Jail-Haupttab mehr', () => {
    const eintraege = nav([JAIL_SEHEN, P.view, P.create, P.release, P.import]);

    expect(eintraege.map((eintrag) => eintrag.href)).not.toContain('/jail');
    expect(eintraege.map((eintrag) => eintrag.href)).not.toContain('/moderation/jail');
  });

  it('lässt Premium den Vote Jail als eigenen Eintrag behalten', () => {
    // Der Kern von §28: Premium soll nicht gezwungen sein, das
    // Moderationsmodul zu öffnen.
    const premium = resolvePreset(PERMISSION_PRESETS.find((v) => v.id === 'premium')!);
    const eintraege = nav(premium).filter((eintrag) => eintrag.moduleId === 'jail');

    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.label).toBe('Vote Jail');
    expect(eintraege[0]?.href).toBe('/vote-jail');
  });

  it('gibt Premium dabei keinen Moderationsbereich', () => {
    const premium = resolvePreset(PERMISSION_PRESETS.find((v) => v.id === 'premium')!);
    const module = new Set(nav(premium).map((eintrag) => eintrag.moduleId));

    expect(module.has('moderation')).toBe(false);
  });

  it('gibt einem Moderator den Moderationsbereich', () => {
    const moderator = resolvePreset(PERMISSION_PRESETS.find((v) => v.id === 'moderator')!);
    const module = new Set(nav(moderator).map((eintrag) => eintrag.moduleId));

    expect(module.has('moderation')).toBe(true);
  });

  // --- Was fachlich gleich geblieben ist ----------------------------------

  it('legt einen Jail weiterhin über denselben Dienst an', async () => {
    // Kein zweiter Jail innerhalb der Moderation - es ist derselbe Eintrag,
    // dieselbe Tabelle, dieselbe Freilassung.
    const eintrag = await prisma.jailEntry.create({
      data: {
        targetDiscordId: '900000000000003001',
        targetUsername: 'ziel',
        moderatorDiscordId: '100000000000000010',
        moderatorUsername: 'verwaltung',
        reason: 'Test',
        type: 'PERMANENT',
        // `activeKey` ist der Unique-Index, der zwei gleichzeitig aktive
        // Jails für dieselbe Person verhindert - er ist die Definition von
        // «aktiv», nicht ein Statusfeld daneben.
        activeKey: '900000000000003001',
      },
    });

    const aktiv = await jail.getActiveJail(eintrag.targetDiscordId);
    expect(aktiv?.id).toBe(eintrag.id);
  });

  it('behält alle Jail-Berechtigungen', () => {
    // Die Navigation ändert sich, die Sicherheit nicht.
    for (const schluessel of [
      'view',
      'create',
      'edit',
      'release',
      'settings',
      'voteStart',
      'import',
    ] as const) {
      expect(P[schluessel], schluessel).toBeTruthy();
    }
  });

  it('behält die Jail-Einstellungen als eigene Einstellungen', () => {
    const modul = listModuleDefinitions().find((eintrag) => eintrag.id === 'jail');

    expect(modul?.settingsSchema).toBeTruthy();
    // Erreichbar über die Moduleinstellungen - dieselbe Adresse wie zuvor.
    expect(modul?.id).toBe('jail');
  });

  // --- Die neuen Gründe ---------------------------------------------------

  it('kennt «Unter 16» und «Bot» als Vorgabe', () => {
    const gruende = jail.jailReasonPresets({
      reasonPresets: jail.JAIL_STANDARD_GRUENDE.join('\n'),
    });

    expect(gruende).toContain('Unter 16');
    expect(gruende).toContain('Bot');
  });

  it('behält die bisherigen Gründe', () => {
    const gruende = jail.jailReasonPresets({
      reasonPresets: jail.JAIL_STANDARD_GRUENDE.join('\n'),
    });

    for (const bisher of [
      'Spam',
      'Beleidigung',
      'Provokation',
      'Regelverstoss',
      'Unangemessenes Verhalten',
      'Voice-Verhalten',
      'Werbung',
    ]) {
      expect(gruende, bisher).toContain(bisher);
    }
  });

  it('erzeugt keine Duplikate, wenn ein Grund doppelt dasteht', () => {
    const gruende = jail.jailReasonPresets({
      reasonPresets: ['Spam', 'Bot', 'Bot', ' Bot ', 'Unter 16'].join('\n'),
    });

    expect(gruende.filter((grund) => grund === 'Bot')).toHaveLength(1);
    expect(gruende).toEqual(['Spam', 'Bot', 'Unter 16']);
  });

  it('bleibt konfigurierbar - eine eigene Liste ersetzt die Vorgabe', () => {
    const eigene = jail.jailReasonPresets({ reasonPresets: 'Nur dieser eine Grund' });

    expect(eigene).toEqual(['Nur dieser eine Grund']);
  });
});
