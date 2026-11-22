// The LED settings model (docs/plans/led-settings.md): RGB Lighting's effects as QMK 0.22.14
// numbers them (quantum/rgblight/rgblight_modes.h), and the firmware size estimate. Expected
// sizes are Keyball+ builds of am338 measured on Actions on 2026-11-22.

import { describe, expect, it } from 'vitest';
import { axesOf, estimateSize, ledCost, modeText, readMode, variantOf, type LedSize } from './leds';

describe('effects and their variants', () => {
  it('writes an effect with its variant as RGB Lighting numbers it', () => {
    expect(modeText({ effect: 'static', variant: 0 })).toBe('RGBLIGHT_MODE_STATIC_LIGHT');
    expect(modeText({ effect: 'breathing', variant: 0 })).toBe('RGBLIGHT_MODE_BREATHING');
    expect(modeText({ effect: 'breathing', variant: 3 })).toBe('RGBLIGHT_MODE_BREATHING + 3');
    expect(modeText({ effect: 'twinkle', variant: 4 })).toBe('RGBLIGHT_MODE_TWINKLE + 4');
  });

  it('reads what config.h has, and nothing it cannot place', () => {
    expect(readMode(undefined)).toEqual({ effect: 'static', variant: 0 });
    expect(readMode('RGBLIGHT_MODE_RAINBOW_SWIRL+5')).toEqual({ effect: 'rainbowSwirl', variant: 5 });
    expect(readMode('RGBLIGHT_MODE_BREATHING + 2')).toEqual({ effect: 'breathing', variant: 2 });
    // Breathing has four variants, and a number alone depends on which effects are included.
    expect(readMode('RGBLIGHT_MODE_BREATHING + 4')).toBeNull();
    expect(readMode('3')).toBeNull();
    expect(readMode('RGBLIGHT_MODE_RGB_TEST')).toBeNull();
  });

  it('splits a variant into its speed, direction, spread or colours, as rgblight.c reads them', () => {
    // Rainbow swirl: speed is delta / 2 and direction delta % 2.
    expect(axesOf('rainbowSwirl', 5)).toEqual([2, 1]);
    expect(variantOf('rainbowSwirl', [1, 0])).toBe(2);
    // Twinkle: random colours are delta / 3, speed delta % 3.
    expect(axesOf('twinkle', 4)).toEqual([1, 1]);
    // Static gradient: the spread is delta / 2, the direction delta % 2.
    expect(variantOf('gradient', [4, 1])).toBe(9);
    expect(axesOf('breathing', 3)).toEqual([3]);
    expect(axesOf('christmas', 0)).toEqual([]);
  });
});

describe('firmware size', () => {
  const off: LedSize = { leds: false, effects: [], stamp: false };
  const lit = (...effects: LedSize['effects']): LedSize => ({ leds: true, effects, stamp: false });

  it('costs what the builds measured', () => {
    // 23,838 bytes without LEDs.
    expect(23838 + ledCost(lit()) - ledCost(off)).toBe(26282);
    expect(23838 + ledCost(lit('breathing'))).toBe(27210);
    expect(23838 + ledCost(lit('twinkle'))).toBe(27850);
    expect(23838 + ledCost(lit('gradient'))).toBe(26536);
    // Effects share their animation code, so all nine cost less than their sum (measured 29,462).
    const all = lit('breathing', 'rainbowMood', 'rainbowSwirl', 'snake', 'knight', 'christmas', 'gradient', 'twinkle', 'alternating');
    expect(Math.abs(23838 + ledCost(all) - 29462)).toBeLessThanOrEqual(3);
  });

  it('estimates a change from the latest build’s size', () => {
    expect(estimateSize(26282, lit(), lit('breathing', 'rainbowMood'))).toBe(26282 + 595 + 333 + 65);
    expect(estimateSize(27210, lit('breathing'), off)).toBe(23838);
    // The stamps block (keymap.c) adds 102 bytes without LEDs (Keyball39: 23,834 to 23,936), so
    // Keyball+ without LEDs would be 23,940; with LEDs it measured 26,604.
    expect(estimateSize(23940, { ...off, stamp: true }, { ...lit(), stamp: true })).toBe(26604);
  });
});
