// Reading and editing keymap.c's layer arrays, changing as little text as
// possible. The fixture is the real am338 keymap.c (UK mode and OS detection).
// Expected lines are written out by hand from the file.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addCombo,
  addLayer,
  readCombos,
  readCustomKeycodes,
  readKeymap,
  readScrollLayers,
  removeCombo,
  removeLastLayer,
  setCombo,
  setKey,
  setScrollLayers,
} from './keymap';

const am338 = readFileSync(new URL('./fixtures/am338.keymap.c', import.meta.url), 'utf8');

/** The edit changed exactly this one line, and nothing else. */
function onlyLineChanged(before: string, after: string, oldLine: string, newLine: string) {
  expect(before.split(oldLine).length).toBe(2); // the line is unique, so the check means something
  expect(after).toBe(before.replace(oldLine, newLine));
}

const BASE_ROW_1 =
  '    ALT_T(KC_Q) , KC_W    , KC_E    , KC_R          , KC_T          ,                                KC_Y    , KC_U          , KC_I        , KC_O    , KC_P            ,';

describe('reading keymap.c', () => {
  it('finds the layout macro and every layer in order', () => {
    const keymap = readKeymap(am338);
    expect(keymap.layout).toBe('LAYOUT_universal');
    expect(keymap.layers.length).toBe(4);
    expect(keymap.layers.every((l) => l.length === 42)).toBe(true);
  });

  it('gives each key as written', () => {
    const { layers } = readKeymap(am338);
    expect(layers[0][0]).toBe('ALT_T(KC_Q)');
    expect(layers[0][17]).toBe('LT(3, KC_K)');
    expect(layers[0][38]).toBe('_______');
    expect(layers[3][20]).toBe('SCRSHOT_FULL');
    expect(layers[3][25]).toBe('SCRSHOT_AREA');
    expect(layers[3][41]).toBe('UK_TOGG');
  });
});

describe('changing a key', () => {
  it('replaces one argument and keeps the columns', () => {
    onlyLineChanged(am338, setKey(am338, 0, 1, 'KC_Z'), BASE_ROW_1, BASE_ROW_1.replace('KC_W    ,', 'KC_Z    ,'));
  });

  it('pads a shorter key so the next column starts where it did', () => {
    onlyLineChanged(am338, setKey(am338, 0, 0, 'KC_A'), BASE_ROW_1, BASE_ROW_1.replace('ALT_T(KC_Q) ,', 'KC_A        ,'));
  });

  it('keeps one space before the comma when a longer key does not fit, and moves the rest of that line only', () => {
    onlyLineChanged(
      am338,
      setKey(am338, 0, 1, 'LT(1, KC_W)'),
      BASE_ROW_1,
      BASE_ROW_1.replace('KC_W    , KC_E', 'LT(1, KC_W) , KC_E'),
    );
  });

  it('keeps a key written right up against its comma that way', () => {
    const row = '    SCRSHOT_FULL, KC_F1   , KC_F2       , KC_F3   , KC_F12  ,                  SCRSHOT_AREA , KC_BTN4  , KC_F2  , KC_APP   , KC_BTN5  ,';
    onlyLineChanged(am338, setKey(am338, 3, 20, 'KC_A'), row, row.replace('SCRSHOT_FULL,', 'KC_A        ,'));
  });

  it('changes the last key of a layer, which has no comma after it', () => {
    const row = '    _______     , _______ , LCA(KC_DEL) , _______ , _______ , KC_ESC  ,   KC_DEL , KC_ENT    , _______  , _______ , _______  , UK_TOGG';
    onlyLineChanged(am338, setKey(am338, 3, 41, 'KC_NO'), row, row.replace('UK_TOGG', 'KC_NO'));
  });

  it('leaves the text identical when the key is the same', () => {
    expect(setKey(am338, 0, 17, 'LT(3, KC_K)')).toBe(am338);
  });

  it('reads back what was written', () => {
    const after = setKey(setKey(am338, 2, 5, 'KC_DEL'), 0, 41, 'KC_RCTL');
    const { layers } = readKeymap(after);
    expect(layers[2][5]).toBe('KC_DEL');
    expect(layers[0][41]).toBe('KC_RCTL');
    expect(layers[0][40]).toBe('_______');
  });
});

describe('combos', () => {
  it('reads each combo: its name, keys and output, in key_combos[] order', () => {
    expect(readCombos(am338)).toEqual([
      { name: 'combo_comma', keys: ['KC_M', 'KC_BTN1'], output: 'KC_COMM' },
      { name: 'combo_dot', keys: ['KC_BTN1', 'KC_BTN2'], output: 'KC_DOT' },
      { name: 'combo_bsls', keys: ['KC_BTN2', 'RSFT_T(KC_SLSH)'], output: 'KC_BSLS' },
    ]);
  });

  it('changes a combo in place: its key array and its output', () => {
    const after = setCombo(am338, 0, { keys: ['KC_N', 'KC_M'], output: 'KC_SCLN' });
    expect(after).toBe(
      am338
        .replace('combo_comma[] = {KC_M, KC_BTN1, COMBO_END};', 'combo_comma[] = {KC_N, KC_M, COMBO_END};')
        .replace('COMBO(combo_comma, KC_COMM),', 'COMBO(combo_comma, KC_SCLN),'),
    );
  });

  it('adds a combo after the last one, with a name not used yet', () => {
    const after = addCombo(am338, { keys: ['KC_J', 'KC_K'], output: 'KC_ESC' });
    expect(after).toBe(
      am338
        .replace(
          'const uint16_t PROGMEM combo_bsls[] = {KC_BTN2, RSFT_T(KC_SLSH), COMBO_END};\n',
          'const uint16_t PROGMEM combo_bsls[] = {KC_BTN2, RSFT_T(KC_SLSH), COMBO_END};\nconst uint16_t PROGMEM combo_4[] = {KC_J, KC_K, COMBO_END};\n',
        )
        .replace('    COMBO(combo_bsls, KC_BSLS),\n', '    COMBO(combo_bsls, KC_BSLS),\n    COMBO(combo_4, KC_ESC),\n'),
    );
    expect(readCombos(after).at(-1)).toEqual({ name: 'combo_4', keys: ['KC_J', 'KC_K'], output: 'KC_ESC' });
  });

  it('removes both parts of a combo', () => {
    const after = removeCombo(am338, 1);
    expect(after).toBe(
      am338
        .replace('const uint16_t PROGMEM combo_dot[] = {KC_BTN1, KC_BTN2, COMBO_END};\n', '')
        .replace('    COMBO(combo_dot, KC_DOT),\n', ''),
    );
  });

  it('adds the first combo to a keymap without any, after keymaps[]', () => {
    const bare = [
      '#include QMK_KEYBOARD_H',
      '',
      'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {',
      '  [0] = LAYOUT(KC_A, KC_B, KC_C),',
      '};',
      '',
      'void keyboard_post_init_user(void) {}',
      '',
    ].join('\n');
    expect(readCombos(bare)).toEqual([]);
    expect(addCombo(bare, { keys: ['KC_A', 'KC_B'], output: 'KC_ESC' })).toBe(
      [
        '#include QMK_KEYBOARD_H',
        '',
        'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {',
        '  [0] = LAYOUT(KC_A, KC_B, KC_C),',
        '};',
        '',
        '#ifdef COMBO_ENABLE',
        'const uint16_t PROGMEM combo_1[] = {KC_A, KC_B, COMBO_END};',
        '',
        'combo_t key_combos[] = {',
        '    COMBO(combo_1, KC_ESC),',
        '};',
        '#endif',
        '',
        'void keyboard_post_init_user(void) {}',
        '',
      ].join('\n'),
    );
  });
});

describe('layers', () => {
  it('adds a transparent layer after the last, shaped like it', () => {
    const after = addLayer(am338);
    const { layers } = readKeymap(after);
    expect(layers.length).toBe(5);
    expect(layers[4]).toEqual(new Array(42).fill('_______'));
    // Inserted right after layer 3's "),"; everything else is as it was.
    const at = am338.indexOf('  ),', am338.indexOf('[3] = LAYOUT_universal(')) + '  ),'.length;
    expect(after.slice(0, at)).toBe(am338.slice(0, at));
    expect(after.slice(after.length - (am338.length - at))).toBe(am338.slice(at));
    const inserted = after.slice(at, after.length - (am338.length - at));
    // Each key becomes _______; the comma keeps its column, or the key keeps one space before it.
    expect(inserted.split('\n')).toEqual([
      '',
      '',
      '  [4] = LAYOUT_universal(',
      '    _______     , _______ , _______     , _______ , _______ ,                     _______   , _______  , _______ , _______  , _______  ,',
      '    _______     , _______ , _______     , _______ , _______ ,                     _______   , _______  , _______ , _______  , _______  ,',
      '    _______     , _______ , _______     , _______ , _______ ,                  _______      , _______  , _______ , _______  , _______  ,',
      '    _______     , _______ , _______     , _______ , _______ , _______ ,   _______ , _______   , _______  , _______ , _______  , _______',
      '  ),',
    ]);
  });

  it('removes the last layer with the comment above it', () => {
    const start = am338.indexOf('\n\n  // function');
    const end = am338.indexOf('  ),', am338.indexOf('[3] = LAYOUT_universal(')) + '  ),'.length;
    expect(removeLastLayer(am338)).toBe(am338.slice(0, start) + am338.slice(end));
    expect(readKeymap(removeLastLayer(am338)).layers.length).toBe(3);
  });

  it('does not remove the only layer', () => {
    const one = 'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n  [0] = LAYOUT(KC_A),\n};\n';
    expect(() => removeLastLayer(one)).toThrow();
  });
});

describe('scroll layers', () => {
  const with3 = '#define KEYBALLER_SCROLL_LAYERS (1 << 3)\n';

  it('reads the layers where the ball scrolls, or null when the keymap does not say', () => {
    expect(readScrollLayers(with3)).toEqual([3]);
    expect(readScrollLayers('#define KEYBALLER_SCROLL_LAYERS ((1UL << 2) | (1UL << 3))\n')).toEqual([2, 3]);
    expect(readScrollLayers('#define KEYBALLER_SCROLL_LAYERS 0\n')).toEqual([]);
    expect(readScrollLayers(am338)).toBeNull();
  });

  it('writes the define', () => {
    expect(setScrollLayers(with3, [2, 3])).toBe('#define KEYBALLER_SCROLL_LAYERS ((1 << 2) | (1 << 3))\n');
    expect(setScrollLayers(with3, [])).toBe('#define KEYBALLER_SCROLL_LAYERS 0\n');
    expect(setScrollLayers(with3, [3])).toBe(with3);
  });
});

describe('custom keycodes', () => {
  it('lists the keymap own keycodes from its enum', () => {
    expect(readCustomKeycodes(am338)).toEqual(['SCRSHOT_AREA', 'SCRSHOT_FULL', 'UK_TOGG']);
    expect(readCustomKeycodes('const int x = 1;')).toEqual([]);
  });
});

describe('edits found in review', () => {
  it('adds a combo to an empty key_combos[] with its array before the list', () => {
    let src = removeCombo(removeCombo(removeCombo(am338, 2), 1), 0);
    src = addCombo(src, { keys: ['KC_H', 'KC_J'], output: 'KC_ESC' });
    expect(readCombos(src)).toEqual([{ name: 'combo_1', keys: ['KC_H', 'KC_J'], output: 'KC_ESC' }]);
    expect(src.indexOf('combo_1[] = {KC_H, KC_J, COMBO_END};')).toBeLessThan(src.indexOf('combo_t key_combos'));
  });

  it('removes one combo from a list written on one line', () => {
    const src = [
      'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = { [0] = LAYOUT(KC_A, KC_B, KC_C, KC_D) };',
      'const uint16_t PROGMEM ca[] = {KC_A, KC_B, COMBO_END};',
      'const uint16_t PROGMEM cb[] = {KC_C, KC_D, COMBO_END};',
      'combo_t key_combos[] = { COMBO(ca, KC_X), COMBO(cb, KC_Y) };',
      '',
    ].join('\n');
    expect(removeCombo(src, 0)).toBe(
      [
        'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = { [0] = LAYOUT(KC_A, KC_B, KC_C, KC_D) };',
        'const uint16_t PROGMEM cb[] = {KC_C, KC_D, COMBO_END};',
        'combo_t key_combos[] = { COMBO(cb, KC_Y) };',
        '',
      ].join('\n'),
    );
  });

  it('keeps a comment between a key and its comma', () => {
    const src = 'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n  [0] = LAYOUT(KC_A /* tap */ , KC_B),\n};\n';
    expect(setKey(src, 0, 0, 'KC_Q')).toBe(src.replace('KC_A /* tap */ ,', 'KC_Q /* tap */ ,'));
  });

  it('keeps the next column when the padding comes after the comma', () => {
    const src = 'const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {\n  [0] = LAYOUT(\n    KC_ESC,  KC_Q,\n    KC_W,    KC_E\n  ),\n};\n';
    expect(setKey(src, 0, 0, 'KC_A')).toBe(src.replace('    KC_ESC,  KC_Q,', '    KC_A,    KC_Q,'));
    expect(setKey(src, 0, 0, 'LT(1, KC_A)')).toBe(src.replace('    KC_ESC,  KC_Q,', '    LT(1, KC_A), KC_Q,'));
  });

  it('does not offer scroll layers it cannot read', () => {
    expect(readScrollLayers('#define KEYBALLER_SCROLL_LAYERS (1 << _MOUSE)\n')).toBeNull();
  });
});
