import { describe, expect, it } from 'vitest';
import { levelSettingsSchema, resolveCardBanner, isCardBannerSlot } from '@swisshub/modules/level';

/**
 * Welcher Hintergrund für eine Levelkarte gilt.
 *
 * Es gibt zwei Quellen (hochgeladene Datei und Adresse) und zwei Plätze
 * (normale Karte und Höchstlevel). Ohne festgehaltene Reihenfolge wäre nicht
 * absehbar, welches Bild im Chat landet.
 */
const settings = (overrides: Record<string, unknown> = {}) => levelSettingsSchema.parse(overrides);

describe('Hintergrund der Levelkarte', () => {
  it('nimmt ohne Angabe gar keinen Hintergrund', () => {
    expect(resolveCardBanner(settings(), false)).toEqual({ path: '', url: '' });
  });

  it('bevorzugt die hochgeladene Datei vor der Adresse', () => {
    const config = settings({
      cardBannerPath: 'levelcard-aaaa.png',
      cardBannerUrl: 'https://example.test/b.png',
    });
    expect(resolveCardBanner(config, false).path).toBe('levelcard-aaaa.png');
  });

  it('nimmt die Adresse, wenn keine Datei hochgeladen wurde', () => {
    const config = settings({ cardBannerUrl: 'https://example.test/b.png' });
    expect(resolveCardBanner(config, false)).toEqual({
      path: '',
      url: 'https://example.test/b.png',
    });
  });

  it('nutzt im Höchstlevel den eigenen Hintergrund', () => {
    const config = settings({
      cardBannerPath: 'levelcard-normal.png',
      cardPrestigeBannerPath: 'levelcard-gold.png',
    });
    expect(resolveCardBanner(config, true).path).toBe('levelcard-gold.png');
    expect(resolveCardBanner(config, false).path).toBe('levelcard-normal.png');
  });

  it('fällt im Höchstlevel auf den normalen Hintergrund zurück', () => {
    // Genau das Verhalten des Vorgängers: ohne lvl31_banner.png galt banner.png.
    const config = settings({ cardBannerPath: 'levelcard-normal.png' });
    expect(resolveCardBanner(config, true).path).toBe('levelcard-normal.png');
  });

  it('kennt nur die beiden vorgesehenen Plätze', () => {
    expect(isCardBannerSlot('normal')).toBe(true);
    expect(isCardBannerSlot('prestige')).toBe(true);
    expect(isCardBannerSlot('../../etc/passwd')).toBe(false);
    expect(isCardBannerSlot('logo')).toBe(false);
  });
});
