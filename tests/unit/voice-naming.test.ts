import { describe, expect, it } from 'vitest';
import {
  baueKanalName,
  pruefeName,
  saeubere,
} from '../../packages/modules/src/voice/naming';
import {
  besitzerRechte,
  everyoneAusnahme,
  verschmelze,
  EVERYONE_VERWALTET,
  TEILNEHMER_ERLAUBT,
  BESITZER_MODERATION,
  BESITZER_VERWALTUNG,
} from '../../packages/modules/src/voice/permissions';
import { DISCORD_PERMISSIONS } from '@swisshub/discord';

/**
 * Namen und Rechte temporaerer Sprachkanaele.
 *
 * Beides ohne Datenbank und ohne Discord pruefbar - und beides Stellen, an
 * denen ein Fehler erst auffiele, wenn jemand davorsteht.
 */

describe('Kanalnamen', () => {
  it('setzt die Platzhalter ein', () => {
    expect(baueKanalName("🔊 {username}'s Talk", { username: 'manuel' })).toBe(
      "🔊 manuel's Talk",
    );
    expect(baueKanalName('👥 {displayName} & Co', { username: 'm', displayName: 'Manuel' })).toBe(
      '👥 Manuel & Co',
    );
  });

  it('entfernt, was in einer Kanalliste nichts zu suchen hat', () => {
    // Ein Kanalname erzeugt keine Erwaehnung, aber `@everyone` im Namen ist
    // trotzdem ein Trick, den niemand braucht.
    const name = baueKanalName('{username}', { username: '@everyone <#123>' });
    expect(name).not.toContain('@');
    expect(name).not.toContain('<');
    expect(name).not.toContain('#');
  });

  it('bleibt innerhalb der Discord-Grenze von 100 Zeichen', () => {
    const lang = baueKanalName('{username} '.repeat(30), { username: 'x'.repeat(40) });
    expect(lang.length).toBeLessThanOrEqual(100);
  });

  it('liefert auch bei unbrauchbarer Vorlage einen Namen', () => {
    // Ein Talk, der wegen eines Tippfehlers in den Einstellungen gar nicht
    // entsteht, waere schlimmer als einer mit merkwuerdigem Namen.
    expect(baueKanalName('', { username: 'anna' })).toBeTruthy();
    expect(baueKanalName('***', { username: 'anna' })).toBeTruthy();
  });

  it('lässt unbekannte Platzhalter stehen', () => {
    // Sichtbar und behebbar - besser als ein Talk, der nicht entsteht.
    expect(baueKanalName('{unbekannt}', { username: 'anna' })).toContain('{unbekannt}');
  });

  it('weist Namen ab, die nach dem Säubern nichts übrig lassen', () => {
    expect(pruefeName('   ')).toMatchObject({ ok: false });
    expect(pruefeName('@@@')).toMatchObject({ ok: false });
    expect(pruefeName('a')).toMatchObject({ ok: false });
    expect(pruefeName('Annas Runde')).toMatchObject({ ok: true, name: 'Annas Runde' });
  });

  it('behält Emoji im Namen', () => {
    // Sie sind das, was einen Kanal in der Liste auffindbar macht.
    expect(saeubere('🔊 Talk')).toContain('🔊');
  });
});

describe('Rechte im Talk', () => {
  it('gibt dem Besitzer die Verwaltung seines eigenen Kanals', () => {
    // Er soll seinen Talk direkt in Discord einstellen koennen - Name,
    // Limit, Berechtigungen. «Berechtigungen verwalten» heisst auf
    // Kanalebene MANAGE_ROLES.
    const rechte = besitzerRechte(true);
    expect(rechte & DISCORD_PERMISSIONS.MANAGE_CHANNELS).toBe(DISCORD_PERMISSIONS.MANAGE_CHANNELS);
    expect(rechte & DISCORD_PERMISSIONS.MANAGE_ROLES).toBe(DISCORD_PERMISSIONS.MANAGE_ROLES);
  });

  it('hängt die Verwaltung nicht am Moderationsschalter', () => {
    // Der Schalter entscheidet, ob der Besitzer andere stummschalten und
    // verschieben darf. Ob ihm sein eigener Kanal gehoert, ist eine andere
    // Frage - und sie wird nicht mit demselben Schalter beantwortet.
    expect(besitzerRechte(false) & BESITZER_VERWALTUNG).toBe(BESITZER_VERWALTUNG);
    expect(besitzerRechte(true) & BESITZER_VERWALTUNG).toBe(BESITZER_VERWALTUNG);
  });

  it('gibt Moderationsrechte nur, wenn das Preset es erlaubt', () => {
    expect(besitzerRechte(true) & BESITZER_MODERATION).toBe(BESITZER_MODERATION);
    expect(besitzerRechte(false) & BESITZER_MODERATION).toBe(0n);
    expect(besitzerRechte(false)).toBe(TEILNEHMER_ERLAUBT | BESITZER_VERWALTUNG);
  });

  it('gibt einem gewöhnlichen Teilnehmer keine Verwaltung', () => {
    // Die Rechte gehoeren dem Besitzer, nicht jedem im Kanal.
    expect(TEILNEHMER_ERLAUBT & BESITZER_VERWALTUNG).toBe(0n);
  });

  it('unterscheidet Sperre und Sichtbarkeit', () => {
    const gesperrt = everyoneAusnahme('1', { locked: true, hidden: false });
    expect(gesperrt).not.toBeNull();
    // Gesperrt: sichtbar, aber nicht betretbar.
    expect(gesperrt?.deny).toBe(DISCORD_PERMISSIONS.CONNECT);
    expect((gesperrt?.deny ?? 0n) & DISCORD_PERMISSIONS.VIEW_CHANNEL).toBe(0n);

    const versteckt = everyoneAusnahme('1', { locked: false, hidden: true });
    expect(versteckt).not.toBeNull();
    // Versteckt: gar nicht zu sehen - und damit auch nicht zu betreten.
    expect((versteckt?.deny ?? 0n) & DISCORD_PERMISSIONS.VIEW_CHANNEL).toBe(
      DISCORD_PERMISSIONS.VIEW_CHANNEL,
    );
    expect((versteckt?.deny ?? 0n) & DISCORD_PERMISSIONS.CONNECT).toBe(
      DISCORD_PERMISSIONS.CONNECT,
    );
  });

  it('entfernt die Ausnahme, wenn weder gesperrt noch versteckt', () => {
    // Der Kanal erbt dann wieder von seiner Kategorie - ein oeffentlicher
    // Talk in einer geschlossenen Kategorie soll geschlossen bleiben.
    expect(everyoneAusnahme('1', { locked: false, hidden: false })).toBeNull();
  });

  it('lässt fremde Bits einer Ausnahme unberührt', () => {
    // Hat ein Administrator dem @everyone hier etwas anderes verboten, soll
    // das Entsperren das nicht mit aufheben.
    const fremd = DISCORD_PERMISSIONS.SEND_MESSAGES;
    const vorhanden = { allow: 0n, deny: fremd | DISCORD_PERMISSIONS.CONNECT };

    const entsperrt = verschmelze(vorhanden, { allow: 0n, deny: 0n }, EVERYONE_VERWALTET);
    expect(entsperrt.deny & fremd).toBe(fremd);
    expect(entsperrt.deny & DISCORD_PERMISSIONS.CONNECT).toBe(0n);
  });
});
