// The keymap view model: given a view file, a layer and display options, what
// is drawn. The fixture is the view file the build wrote for am338 on Keyball+.

import { describe, expect, it } from 'vitest';
import fixture from './fixtures/am338.view.json';
import meteorite40 from '../edit/fixtures/meteorite40.view.json';
import roba from '../edit/fixtures/roba-right.view.json';
import { drawLayer, nextKey, parseLayerList, parseView, type Display, type ViewFile } from './view';

const view = fixture as unknown as ViewFile;
const mac: Display = { lang: 'en', os: 'mac', layout: 'us' };
const windows: Display = { lang: 'en', os: 'windows', layout: 'us' };

const keyOn = (layer: number, index: number, display: Display = mac) => {
  const k = drawLayer(view, layer, display).keys.find((k) => k.index === index);
  if (!k) throw new Error(`no key ${index} on layer ${layer}`);
  return k;
};

/** A one-key view, for keycodes am338 does not use. */
const single = (keycode: string, display: Display = mac) => {
  const one: ViewFile = {
    ...view,
    keys: [{ index: 0, matrix: [0, 0], present: true, x: 0, y: 0, w: 1, h: 1, r: 0, rx: 0, ry: 0 }],
    layers: [{ name: 'Base', ball: null, keys: [keycode] }],
    combos: [],
    code: {},
  };
  return drawLayer(one, 0, display).keys[0];
};

describe('legends', () => {
  it('shows a plain key as its printed letter', () => {
    expect(keyOn(0, 1).legend).toEqual({ tap: 'W' });
  });

  it('shows a mod-tap with the tap in the centre and the modifier as the hold', () => {
    expect(keyOn(0, 0, windows).legend).toEqual({ tap: 'Q', hold: 'Alt' });
    expect(keyOn(0, 0, mac).legend).toEqual({ tap: 'Q', hold: '⌥' });
  });

  it('writes modified keys the way each OS prints shortcuts', () => {
    expect(keyOn(2, 0, mac).legend).toEqual({ tap: '⌃W' }); // C(KC_W)
    expect(keyOn(2, 0, windows).legend).toEqual({ tap: 'Ctrl+W' });
    expect(keyOn(3, 32, mac).legend).toEqual({ tap: '⌃⌥Del' }); // LCA(KC_DEL)
    expect(keyOn(3, 32, windows).legend).toEqual({ tap: 'Ctrl+Alt+Del' });
    expect(single('S(KC_TAB)', mac).legend).toEqual({ tap: '⇧Tab' });
    expect(single('S(KC_TAB)', windows).legend).toEqual({ tap: 'Shift+Tab' });
  });

  it('shows the shifted character for the OS keyboard layout', () => {
    expect(keyOn(1, 10).legend).toEqual({ tap: '@' }); // KC_AT
    expect(keyOn(1, 10, { ...mac, layout: 'jis' }).legend).toEqual({ tap: '"' });
    expect(single('S(KC_2)').legend).toEqual({ tap: '@' });
    expect(single('S(KC_2)', { ...mac, layout: 'jis' }).legend).toEqual({ tap: '"' });
    expect(keyOn(1, 0).legend).toEqual({ tap: '%' }); // KC_PERC
  });

  it('shows modifiers as each OS prints them: symbols on Mac, names on Windows', () => {
    const gui = keyOn(0, 30, mac); // KC_LGUI
    expect(gui.kind).toBe('modifier');
    expect(gui.legend).toEqual({ tap: '⌘' });
    expect(keyOn(0, 30, windows).legend).toEqual({ tap: 'Win' });
  });

  it('shows the characters of the Windows UK layout', () => {
    const uk: Display = { ...windows, layout: 'uk' };
    expect(keyOn(1, 10, uk).legend).toEqual({ tap: '"' }); // KC_AT is Shift+2
    expect(single('S(KC_3)', uk).legend).toEqual({ tap: '£' });
    expect(single('KC_DQUO', uk).legend).toEqual({ tap: '@' });
    expect(single('KC_BSLS', uk).legend).toEqual({ tap: '#' });
    expect(single('KC_NUBS', uk).legend).toEqual({ tap: '\\' });
    expect(single('KC_TILD', uk).legend).toEqual({ tap: '¬' });
  });

  it('resolves aliases from the keymap and names Japanese input keys', () => {
    expect(keyOn(0, 31, mac).legend).toEqual({ tap: '英数', hold: '⌥' }); // TH_EISU
    expect(keyOn(0, 32, windows).legend).toEqual({ tap: 'かな', hold: 'Alt' }); // TH_KANA
    expect(single('KC_INT3').legend).toEqual({ tap: '¥' });
  });

  it('names custom keycodes from the configuration, in the display language', () => {
    expect(keyOn(3, 25, { ...mac, lang: 'en' }).legend).toEqual({ tap: 'Area shot' }); // SCRSHOT_AREA
    expect(keyOn(3, 25, { ...mac, lang: 'ja' }).legend).toEqual({ tap: '範囲スクショ' });
  });

  it('names mouse buttons and Keyball keys in the display language', () => {
    expect(keyOn(0, 27, { ...mac, lang: 'en' }).legend).toEqual({ tap: 'L click' }); // KC_BTN1
    expect(keyOn(0, 27, { ...mac, lang: 'ja' }).legend).toEqual({ tap: '左クリック' });
    expect(keyOn(3, 15).legend).toEqual({ tap: 'CPI', top: '−100' }); // CPI_D100
    expect(keyOn(3, 16, { ...mac, lang: 'ja' }).legend).toEqual({ tap: 'スクロール', top: '遅く' }); // SCRL_DVI
  });

  it('shows an unknown keycode by its name, without nested syntax', () => {
    const k = single('FOO_BAR');
    expect(k.kind).toBe('unknown');
    expect(k.legend).toEqual({ tap: 'FOO_BAR' });
    expect(single('FOO_BAR(KC_A, 3)').legend).toEqual({ tap: 'FOO_BAR' });
  });

  it('names every kind of layer key, with what it does on the top line', () => {
    expect(single('MO(1)').legend).toEqual({ tap: 'L1' });
    expect(single('MO(0)').legend).toEqual({ tap: 'Base' });
    expect(single('TG(0)').legend).toEqual({ tap: 'Base', top: 'Toggle' });
    expect(single('TG(0)', { ...mac, lang: 'ja' }).legend).toEqual({ tap: 'Base', top: '切替' });
    expect(single('TO(0)').legend).toEqual({ tap: 'Base', top: 'Go to' });
    expect(single('TT(0)').legend).toEqual({ tap: 'Base', top: 'Tap-toggle' });
    expect(single('OSL(0)').legend).toEqual({ tap: 'Base', top: 'One-shot' });
    expect(single('DF(0)').legend).toEqual({ tap: 'Base', top: 'Default' });
    expect(single('TG(0)').kind).toBe('layer');
    expect(single('TG(0)').target).toBe(0);
  });

  it('shows one-shot modifiers', () => {
    const k = single('OSM(MOD_LSFT)');
    expect(k.kind).toBe('modifier');
    expect(k.legend).toEqual({ tap: '⇧', top: 'One-shot' });
    expect(single('OSM(MOD_LCTL | MOD_LALT)', windows).legend).toEqual({ tap: 'Ctrl+Alt', top: 'One-shot' });
  });

  it('names layers written as enum names, which QMK keeps as written', () => {
    const k = single('LT(_SYM, KC_A)');
    expect(k.legend).toEqual({ tap: 'A', hold: 'SYM' });
    expect(k.kind).toBe('layer');
    expect(k.target).toBeUndefined();
    expect(single('MO(_NAV)').legend).toEqual({ tap: 'NAV' });
  });

  it('names the layer a layer-tap key holds', () => {
    const k = keyOn(0, 17); // LT(3, KC_K)
    expect(k.legend).toEqual({ tap: 'K', hold: 'Function' });
    expect(k.kind).toBe('layer');
    expect(k.target).toBe(3);
  });
});

describe('key states', () => {
  it('shows what a transparent key falls through to on the base layer', () => {
    const k = keyOn(1, 30); // KC_TRNS over KC_LGUI
    expect(k.kind).toBe('transparent');
    expect(k.fallsTo).toEqual({ tap: '⌘' });
    expect(keyOn(3, 41, windows).fallsTo).toEqual({ tap: '-', hold: 'Ctrl' }); // over RCTL_T(KC_MINS)
  });

  it('follows a layer reached from another layer: held keys and fall-through on the way', () => {
    const three: ViewFile = {
      ...view,
      keys: [0, 1, 2].map((i) => ({ index: i, matrix: [0, i] as [number, number], present: true, x: i, y: 0 })),
      layers: [
        { name: 'Base', ball: null, keys: ['KC_A', 'MO(1)', 'KC_C'] },
        { name: 'Nav', ball: null, keys: ['KC_B', 'KC_TRNS', 'MO(2)'] },
        { name: 'Fn', ball: null, keys: ['KC_TRNS', 'KC_TRNS', 'KC_TRNS'] },
      ],
      combos: [],
      code: {},
    };
    const fn = drawLayer(three, 2, mac).keys;
    expect(fn.filter((k) => k.held).map((k) => k.index)).toEqual([1, 2]);
    expect(fn[0].fallsTo).toEqual({ tap: 'B' }); // Nav is under Fn, not Base
    expect(fn[1].fallsTo).toEqual({ tap: 'Nav' }); // through Nav to MO(1) on Base
  });

  it('keeps no-action keys apart from transparent ones', () => {
    expect(single('KC_NO').kind).toBe('none');
    expect(single('KC_NO').legend).toEqual({ tap: '—' });
    expect(single('XXXXXXX').kind).toBe('none');
  });

  it('marks the keys held to reach each layer', () => {
    const held = (layer: number) =>
      drawLayer(view, layer, mac).keys.filter((k) => k.held).map((k) => k.index);
    expect(held(0)).toEqual([]);
    expect(held(1)).toEqual([33]); // LT(1, KC_TAB)
    expect(held(2)).toEqual([34, 37]); // LT(2, KC_SPC), LT(2, KC_ENT)
    expect(held(3)).toEqual([17, 19, 35]); // LT(3, KC_K), LT(3, KC_QUOT), LT(3, KC_ESC)
  });

  it('marks keys whose behaviour is set in code, with the lines', () => {
    expect(keyOn(0, 0).code).toEqual([134]); // ALT_T(KC_Q)
    expect(keyOn(0, 31).code).toEqual([159]); // TH_EISU
    expect(keyOn(0, 33).code).toEqual([107]); // LT(1, KC_TAB)
    expect(keyOn(0, 1).code).toBeUndefined();
  });
});

describe('trackball and combos', () => {
  it('says what the ball does on each layer, in the display language', () => {
    expect(drawLayer(view, 0, mac).balls).toEqual([{ x: 11.2, y: 3.75, d: 1.7848, mode: 'Cursor' }]);
    expect(drawLayer(view, 3, mac).balls[0].mode).toBe('Scroll');
    expect(drawLayer(view, 3, { ...mac, lang: 'ja' }).balls[0].mode).toBe('スクロール');
  });

  it('draws combos on the base layer with their output', () => {
    const combos = drawLayer(view, 0, mac).combos;
    expect(combos).toEqual([
      { positions: [26, 27], output: { tap: ',' }, line: 85 },
      { positions: [27, 28], output: { tap: '.' }, line: 86 },
      { positions: [28, 29], output: { tap: '\\' }, line: 87 },
    ]);
    expect(drawLayer(view, 0, { ...mac, layout: 'jis' }).combos[2].output).toEqual({ tap: ']' });
    expect(drawLayer(view, 1, mac).combos).toEqual([]);
  });

  it('draws a ZMK combo on each layer it fires on', () => {
    // meteorite40.keymap: D+F and J+K type LANG1 and LANG2 on layer 0; J+K types Home on layer 2.
    const m40 = meteorite40 as unknown as ViewFile;
    const at = (layer: number) => drawLayer(m40, layer, mac).combos.map((c) => `${c.positions.join('+')}=${c.output.tap}`);
    expect(at(0)).toEqual(['12+13=かな', '16+17=英数', '20+21=Esc', '0+1=Tab']);
    expect(at(1)).toEqual([]);
    expect(at(2)).toEqual(['16+17=Home', '18+19=End', '16+18=⌃Home', '17+19=⌃End']);
    // roBa's combos have no layers, so they fire on every layer.
    const r = roba as unknown as ViewFile;
    expect(drawLayer(r, 3, mac).combos.length).toBe(r.combos.length);
  });

  it('keeps a combo’s layers only when they are layer numbers', () => {
    // The view comes from the firmware branch, so its shape is not trusted.
    const combo = (layers: unknown) => ({ name: 'c', keys: [], positions: [0, 1], output: 'KC_A', line: 1, layers });
    const read = (layers: unknown) => parseView({ ...meteorite40, combos: [combo(layers)] }).combos[0].layers;
    expect(read([0, 2])).toEqual([0, 2]);
    for (const bad of ['2', [1.5], [-1], [32], { 0: 1 }, [null]]) expect(read(bad), JSON.stringify(bad)).toBeUndefined();
  });

  it('reads the layers typed for a combo: all, or numbers from the tabs', () => {
    expect(parseLayerList('all', 5)).toBeNull();
    expect(parseLayerList(' ALL ', 5)).toBeNull();
    expect(parseLayerList('2', 5)).toEqual([2]);
    expect(parseLayerList('0,2', 5)).toEqual([0, 2]);
    expect(parseLayerList('3 0, 3', 5)).toEqual([0, 3]);
    for (const bad of ['', '5', '-1', '1.5', 'base', '0x1', '1 all', '007']) expect(parseLayerList(bad, 5), bad).toBeUndefined();
  });

  it('leaves out combos that are not shaped as combos', () => {
    const good = { name: 'c', keys: ['KC_A', 'KC_B'], positions: [0, 1], output: 'KC_C', line: 1 };
    const bad = [null, 'c', { ...good, keys: 'KC_A' }, { ...good, positions: { 0: 1 } }, { ...good, positions: ['0'] }, { ...good, output: 3 }];
    expect(parseView({ ...meteorite40, combos: [good, ...bad] }).combos).toEqual([good]);
  });
});

describe('arrow-key navigation', () => {
  const drawn = drawLayer(view, 0, mac);

  it('moves across the gap between the halves', () => {
    expect(nextKey(drawn, 4, 'right')).toBe(5); // T → Y
    expect(nextKey(drawn, 5, 'left')).toBe(4); // Y → T
  });

  it('moves down from B to the nearest thumb key, which is rotated', () => {
    // B's centre is (4.5, 2.75). Space (34) is rotated 10° about (5.35, 5.5): its
    // centre (4.55, 4.225) lands at (4.78, 4.11), nearer than Tab (33) at (3.65, 4.0).
    expect(nextKey(drawn, 24, 'down')).toBe(34);
  });

  it('follows the stagger within a row and stops at the edge', () => {
    expect(nextKey(drawn, 1, 'right')).toBe(2); // W → E
    expect(nextKey(drawn, 2, 'up')).toBeNull(); // E is on the top row
    expect(nextKey(drawn, 0, 'left')).toBeNull(); // Q is the left edge
    expect(nextKey(drawn, 10, 'up')).toBe(0); // A → Q
  });
});
