// The key picker's catalogue: finding a keycode by what a person calls it, the
// tap and hold combinations QMK can build, and keys pressed on the computer.

import { describe, expect, it } from 'vitest';
import { checkKeycode, compose, decompose, keyFromCode, makeCatalogue, search } from './catalogue';

const catalogue = makeCatalogue({
  layers: ['Base', 'Symbol', 'Number', 'Function'],
  custom: ['SCRSHOT_AREA', 'SCRSHOT_FULL', 'UK_TOGG'],
  defines: { TH_EISU: 'LALT_T(KC_LNG2)' },
  labels: { UK_TOGG: { en: 'UK mode', ja: 'UKモード' } },
});
const first = (query: string) => search(catalogue, query)[0]?.code;
const codes = (query: string) => search(catalogue, query).map((e) => e.code);

describe('search', () => {
  it('finds a key by its QMK name, with or without KC_', () => {
    expect(first('KC_ESC')).toBe('KC_ESC');
    expect(first('esc')).toBe('KC_ESC');
    expect(first('a')).toBe('KC_A');
  });

  it('finds a key by what it prints', () => {
    expect(first('@')).toBe('KC_AT');
    expect(first('[')).toBe('KC_LBRC');
  });

  it('finds keys by English and Japanese words', () => {
    expect(first('left click')).toBe('KC_BTN1');
    expect(first('左クリック')).toBe('KC_BTN1');
    expect(first('英数')).toBe('KC_LNG2');
    expect(first('eisu')).toBe('KC_LNG2');
    expect(codes('volume')).toEqual(expect.arrayContaining(['KC_VOLU', 'KC_VOLD']));
  });

  it('finds symbols by their names', () => {
    expect(first('semicolon')).toBe('KC_SCLN');
    expect(first('セミコロン')).toBe('KC_SCLN');
    expect(first('comma')).toBe('KC_COMM');
    expect(first('backslash')).toBe('KC_BSLS');
    expect(first('underscore')).toBe('KC_UNDS');
    expect(first('アットマーク')).toBe('KC_AT');
  });

  it('finds layer keys by the layer name', () => {
    expect(codes('symbol')).toEqual(expect.arrayContaining(['MO(1)', 'TG(1)']));
  });

  it('finds the keymap own keys, by name and by label', () => {
    expect(first('uk mode')).toBe('UK_TOGG');
    expect(first('UKモード')).toBe('UK_TOGG');
    expect(first('scrshot_a')).toBe('SCRSHOT_AREA');
  });

  it('finds the keymap #define aliases and one-shot modifiers', () => {
    expect(first('th_eisu')).toBe('TH_EISU');
    expect(first('one-shot shift')).toBe('OSM(MOD_LSFT)');
  });

  it('finds nothing for nonsense', () => {
    expect(codes('zzzzqq')).toEqual([]);
  });
});

describe('tap and hold', () => {
  it('builds mod-taps, layer-taps and plain keys', () => {
    expect(compose({ tap: 'KC_A' })).toEqual({ keycode: 'KC_A' });
    expect(compose({ tap: 'KC_A', hold: { mods: ['ctrl'] } })).toEqual({ keycode: 'LCTL_T(KC_A)' });
    expect(compose({ tap: 'KC_A', hold: { mods: ['ctrl', 'shift'] } })).toEqual({ keycode: 'MT(MOD_LCTL | MOD_LSFT, KC_A)' });
    expect(compose({ tap: 'KC_SPC', hold: { layer: 2 } })).toEqual({ keycode: 'LT(2, KC_SPC)' });
  });

  it('refuses what QMK cannot build, with the reason', () => {
    // Hold keys take a basic keycode as their tap: no shifted symbols, shortcuts or custom keys.
    expect(compose({ tap: 'KC_AT', hold: { layer: 1 } })).toEqual({ refused: 'picker.err.notBasic' });
    expect(compose({ tap: 'C(KC_W)', hold: { mods: ['alt'] } })).toEqual({ refused: 'picker.err.notBasic' });
    expect(compose({ tap: 'UK_TOGG', hold: { layer: 1 } })).toEqual({ refused: 'picker.err.notBasic' });
    // LT() holds layers 0 to 15.
    expect(compose({ tap: 'KC_A', hold: { layer: 16 } })).toEqual({ refused: 'picker.err.layerTooHigh' });
  });

  it('splits a key into tap and hold for editing', () => {
    expect(decompose('LT(3, KC_K)')).toEqual({ tap: 'KC_K', hold: { layer: 3 } });
    expect(decompose('ALT_T(KC_Q)')).toEqual({ tap: 'KC_Q', hold: { mods: ['alt'] } });
    expect(decompose('MT(MOD_LCTL | MOD_LSFT, KC_A)')).toEqual({ tap: 'KC_A', hold: { mods: ['ctrl', 'shift'] } });
    expect(decompose('KC_A')).toEqual({ tap: 'KC_A' });
  });

  it('keeps right-hand modifiers on the right', () => {
    expect(decompose('RSFT_T(KC_SLSH)')).toEqual({ tap: 'KC_SLSH', hold: { mods: ['shift'], right: true } });
    expect(compose({ tap: 'KC_SLSH', hold: { mods: ['shift'], right: true } })).toEqual({ keycode: 'RSFT_T(KC_SLSH)' });
    expect(decompose('MT(MOD_RCTL | MOD_RSFT, KC_A)')).toEqual({ tap: 'KC_A', hold: { mods: ['ctrl', 'shift'], right: true } });
    expect(compose({ tap: 'KC_A', hold: { mods: ['ctrl', 'shift'], right: true } })).toEqual({ keycode: 'MT(MOD_RCTL | MOD_RSFT, KC_A)' });
  });

  it('builds keys sent with modifiers, which cannot also have a hold action', () => {
    expect(decompose('C(KC_W)')).toEqual({ tap: 'KC_W', withMods: ['ctrl'] });
    expect(decompose('LCA(KC_DEL)')).toEqual({ tap: 'KC_DEL', withMods: ['ctrl', 'alt'] });
    expect(compose({ tap: 'KC_W', withMods: ['ctrl'] })).toEqual({ keycode: 'C(KC_W)' });
    expect(compose({ tap: 'KC_DEL', withMods: ['ctrl', 'alt'] })).toEqual({ keycode: 'C(A(KC_DEL))' });
    expect(compose({ tap: 'KC_W', withMods: ['ctrl'], hold: { layer: 1 } })).toEqual({ refused: 'picker.err.notBasic' });
  });

  it('checks a keycode typed on the command line', () => {
    expect(checkKeycode('KC_A')).toBeUndefined();
    expect(checkKeycode('MO(1)')).toBeUndefined();
    expect(checkKeycode('TH_EISU')).toBeUndefined();
    expect(checkKeycode('KC_A, KC_B')).toBe('picker.err.notOneKey');
    expect(checkKeycode('LT(1, KC_A')).toBe('picker.err.notOneKey');
    expect(checkKeycode('')).toBe('picker.err.notOneKey');
    expect(checkKeycode('LSFT_T(KC_EXLM)')).toBe('picker.err.notBasic');
  });
});

describe('keys pressed on the computer', () => {
  it('maps KeyboardEvent.code to the keycode at that position on a US keyboard', () => {
    expect(keyFromCode('KeyQ')).toBe('KC_Q');
    expect(keyFromCode('Digit2')).toBe('KC_2');
    expect(keyFromCode('Semicolon')).toBe('KC_SCLN');
    expect(keyFromCode('ShiftRight')).toBe('KC_RSFT');
    expect(keyFromCode('MetaLeft')).toBe('KC_LGUI');
    expect(keyFromCode('Lang2')).toBe('KC_LNG2');
    expect(keyFromCode('IntlYen')).toBe('KC_INT3');
    expect(keyFromCode('ArrowUp')).toBe('KC_UP');
    expect(keyFromCode('Fn')).toBeNull();
  });
});
