// Writing keys as ZMK bindings. Every name written is checked against ZMK's own keys.h: the
// table zmk-keys.json (which the app also reads keys with) lists each name keys.h defines (at both pinned ZMK commits, acfd8e5e and
// abb64ba3, which have the same keys.h) with the keycode the build's reader, scripts/zmk_view.py,
// makes of its value. It is made by scripts/zmk_keys.py.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCatalogue } from './catalogue';
import { canonical, shiftedBase } from './keycodes';
import { parseKeycode } from './view';
import { zmkBinding, type ZmkContext } from './zmkKeys';

const KEYS = JSON.parse(readFileSync(new URL('./zmk-keys.json', import.meta.url), 'utf8')) as Record<string, string | null>;

const none: ZmkContext = { known: new Map(), mouse: false, bluetooth: false };
const text = (keycode: string, context = none) => {
  const out = zmkBinding(keycode, context);
  return 'text' in out ? out.text : out.refused;
};

/** ZMK's implicit modifiers, as modifiers.h defines them (LS is MOD_LSFT…), by QMK's names. */
const ZMK_MODS: Record<string, string> = { LC: 'LCTL', LS: 'LSFT', LA: 'LALT', LG: 'LGUI', RC: 'RCTL', RS: 'RSFT', RA: 'RALT', RG: 'RGUI' };
const ORDER = ['LCTL', 'LSFT', 'LALT', 'LGUI', 'RCTL', 'RSFT', 'RALT', 'RGUI'];

/** What a `&kp` parameter means: its key and modifiers, read through keys.h (the fixture). */
function readZmk(param: string): string {
  const mods = new Set<string>();
  let expr = parseKeycode(param);
  while (ZMK_MODS[expr.name] && expr.args.length === 1) {
    mods.add(ZMK_MODS[expr.name]);
    expr = expr.args[0];
  }
  const named = KEYS[expr.name];
  if (named === undefined || named === null) throw new Error(`keys.h has no key ${expr.name}`);
  // A name such as EXCL carries its own shift: LSFT(KC_1).
  let inner = parseKeycode(named);
  while (inner.args.length === 1) {
    mods.add(inner.name);
    inner = inner.args[0];
  }
  return ORDER.filter((m) => mods.has(m)).reduceRight((t, m) => `${m}(${t})`, inner.name);
}

/** A QMK keycode in the same terms: S(KC_1), KC_EXLM and LSFT(KC_1) are one key. */
function readQmk(keycode: string): string {
  const mods = new Set<string>();
  let expr = parseKeycode(keycode);
  const QMK_MODS: Record<string, string[]> = {
    S: ['LSFT'], LSFT: ['LSFT'], C: ['LCTL'], LCTL: ['LCTL'], A: ['LALT'], LALT: ['LALT'], G: ['LGUI'], LGUI: ['LGUI'],
    RSFT: ['RSFT'], RCTL: ['RCTL'], RALT: ['RALT'], RGUI: ['RGUI'], MEH: ['LCTL', 'LSFT', 'LALT'],
  };
  while (QMK_MODS[expr.name] && expr.args.length === 1) {
    QMK_MODS[expr.name].forEach((m) => mods.add(m));
    expr = expr.args[0];
  }
  const name = canonical(expr.name);
  const base = shiftedBase(name);
  if (base) mods.add('LSFT');
  return ORDER.filter((m) => mods.has(m)).reduceRight((t, m) => `${m}(${t})`, base ?? name);
}

describe('keys ZMK has a name for', () => {
  it('writes every plain key the picker offers with a name keys.h defines for that key', () => {
    const catalogue = makeCatalogue({ layers: [], custom: [], labels: {} });
    const plain = catalogue.entries
      .filter((e) => ['letters', 'numbers', 'symbols', 'editing', 'modifiers', 'japanese', 'function', 'media'].includes(e.category))
      .filter((e) => !e.code.startsWith('OSM'))
      .map((e) => e.code);
    expect(plain.length).toBeGreaterThan(130);
    for (const code of plain) {
      const binding = text(code);
      expect(binding, code).toMatch(/^&kp /);
      expect(readZmk(binding.slice(4)), `${code} → ${binding}`).toBe(readQmk(code));
    }
  });

  it('writes modifiers held with a key as ZMK’s modifier functions', () => {
    for (const code of ['LSFT(LGUI(KC_S))', 'C(KC_W)', 'LCTL(LALT(KC_DEL))', 'RALT(KC_E)', 'MEH(KC_A)', 'LSFT(KC_1)', 'S(KC_TAB)']) {
      const binding = text(code);
      expect(binding, code).toMatch(/^&kp /);
      expect(readZmk(binding.slice(4)), `${code} → ${binding}`).toBe(readQmk(code));
    }
    // A shifted character keeps ZMK's name for it.
    expect(text('LSFT(KC_1)')).toBe('&kp EXCL');
    expect(text('KC_EXLM')).toBe('&kp EXCL');
  });
});

describe('tap and hold, layers and the rest', () => {
  it('writes mod-taps that hold one modifier, and layer-taps', () => {
    expect(text('LALT_T(KC_Q)')).toBe('&mt LALT Q');
    expect(text('RSFT_T(KC_SLSH)')).toBe('&mt RSHFT SLASH');
    expect(text('MT(MOD_LCTL, KC_A)')).toBe('&mt LCTRL A');
    expect(text('LT(5,KC_K)')).toBe('&lt 5 K');
    expect(text('LT(2, KC_SPC)')).toBe('&lt 2 SPACE');
    // ZMK's mod-tap holds one key; several modifiers at once are not written.
    expect(text('MT(MOD_LCTL | MOD_LSFT, KC_A)')).toBe('picker.err.notInZmk');
    expect(text('MEH_T(KC_A)')).toBe('picker.err.notInZmk');
  });

  it('writes layer keys, one-shot modifiers and ZMK’s own behaviours', () => {
    expect(['MO(1)', 'TG(2)', 'TO(6)', 'OSL(3)'].map((c) => text(c))).toEqual(['&mo 1', '&tog 2', '&to 6', '&sl 3']);
    expect(text('OSM(MOD_LSFT)')).toBe('&sk LSHFT');
    expect(['KC_TRNS', '_______', 'XXXXXXX', 'QK_BOOT', 'QK_RBT', 'CW_TOGG'].map((c) => text(c))).toEqual([
      '&trans', '&trans', '&none', '&bootloader', '&sys_reset', '&caps_word',
    ]);
    expect(text('ZMK_OUT_USB')).toBe('&out OUT_USB');
  });

  it('refuses keys ZMK has no binding for', () => {
    for (const code of ['TT(1)', 'DF(1)', 'MO(32)', 'KBC_SAVE', 'CPI_I100', 'KC_MS_U', 'EE_CLR', 'OSM(MOD_LCTL|MOD_LSFT)']) {
      expect(text(code), code).toBe('picker.err.notInZmk');
    }
  });

  it('offers mouse buttons and Bluetooth only when the keymap already uses them', () => {
    expect(text('KC_BTN1')).toBe('picker.err.zmkFeature');
    expect(text('ZMK_BT_SEL_2')).toBe('picker.err.zmkFeature');
    const used: ZmkContext = { ...none, mouse: true, bluetooth: true };
    expect(zmkBinding('KC_BTN1', used)).toEqual({ text: '&mkp MB1', header: 'dt-bindings/zmk/pointing.h' });
    expect(zmkBinding('ZMK_BT_SEL_2', used)).toEqual({ text: '&bt BT_SEL 2', header: 'dt-bindings/zmk/bt.h' });
    expect(text('ZMK_BT_CLR_ALL', used)).toBe('&bt BT_CLR_ALL');
    expect(text('ZMK_BT_DISC_1', used)).toBe('&bt BT_DISC 1');
  });

  it('writes a key the keymap already has as the keymap writes it', () => {
    const known: ZmkContext = {
      ...none,
      known: new Map([
        ['KC_LALT', '&kp LEFT_ALT'],
        ['LT(5,ZMK_TO_LAYER_0_70034)', '&lt_to_layer_0 5 APOSTROPHE'],
      ]),
    };
    expect(text('KC_LALT', known)).toBe('&kp LEFT_ALT');
    expect(text('LT(5, ZMK_TO_LAYER_0_70034)', known)).toBe('&lt_to_layer_0 5 APOSTROPHE');
    expect(text('ZMK_TO_LAYER_0_70034')).toBe('picker.err.notInZmk');
  });

  it('reuses the file’s text only when it means the same key', () => {
    // What a key means comes from the build's view; a view that says Esc where the file has
    // &bootloader must not make "Esc" write &bootloader.
    const lying: ZmkContext = {
      ...none,
      known: new Map([
        ['KC_ESC', '&bootloader'],
        ['KC_A', '&kp LG(L)'],
        ['MO(1)', '&mo 2'],
        ['LALT_T(KC_Q)', '&mt LEFT_ALT Q'],
        ['LSFT(KC_1)', '&kp EXCLAMATION'],
        ['LT(2,KC_SPC)', '&lt 0x2 SPACE'],
      ]),
    };
    expect(text('KC_ESC', lying)).toBe('&kp ESC');
    expect(text('KC_A', lying)).toBe('&kp A');
    expect(text('MO(1)', lying)).toBe('&mo 1');
    // The same key, spelled the file's way, is kept.
    expect(text('LALT_T(KC_Q)', lying)).toBe('&mt LEFT_ALT Q');
    expect(text('KC_EXLM', lying)).toBe('&kp EXCLAMATION');
    expect(text('LT(2, KC_SPC)', lying)).toBe('&lt 0x2 SPACE');
  });
});
