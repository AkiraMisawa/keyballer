// Keymap edits in a session: keys, combos and layers, and what a save would
// commit. Fixtures are the real am338 files; expected lines are written out by
// hand from them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readCombos, readKeymap } from '../config/keymap';
import viewFixture from '../keymap/fixtures/am338.view.json';
import type { ViewFile } from '../keymap/view';
import {
  apply,
  ballModeEditable,
  comboProblem,
  currentFiles,
  editedView,
  keymapProblem,
  keyProblem,
  openSession,
  rebase,
  review,
  undo,
  type Session,
} from './session';

const fixture = (name: string) => readFileSync(new URL(`../config/fixtures/${name}`, import.meta.url), 'utf8');
const KEYMAP = 'keymaps/am338/keymap.c';

const am338 = (): Session =>
  openSession({
    commit: 'base000',
    buildId: 'keyballplus',
    keymapDir: 'keymaps/am338',
    files: {
      [KEYMAP]: fixture('am338.keymap.c'),
      'keymaps/am338/rules.mk': fixture('am338.rules.mk'),
      'keymaps/am338/config.h': fixture('am338.config.h'),
      'keyballer.json': fixture('keyballer.json'),
    },
  });
const keymapOf = (s: Session) => readKeymap(currentFiles(s)[KEYMAP]);

describe('keys', () => {
  it('changes a key, lists it, and drafts the message', () => {
    const s = apply(am338(), { type: 'key', layer: 0, index: 1, keycode: 'KC_Z' });
    expect(keymapOf(s).layers[0][1]).toBe('KC_Z');
    const r = review(s);
    expect(r.keys).toEqual([{ layer: 0, index: 1, from: 'KC_W', to: 'KC_Z' }]);
    expect(r.files.map((f) => f.path)).toEqual([KEYMAP]);
    expect(r.message).toBe('Change W to Z on Base');
  });

  it('counts several keys in the message, by layer', () => {
    let s = apply(am338(), { type: 'key', layer: 0, index: 1, keycode: 'KC_Z' });
    s = apply(s, { type: 'key', layer: 1, index: 0, keycode: 'KC_TILD' });
    s = apply(s, { type: 'key', layer: 1, index: 1, keycode: 'KC_NO' });
    expect(review(s).message).toBe('Change 3 keys on Base and Symbol');
  });

  it('treats changing the same key again as one step, and drops it when it goes back', () => {
    let s = apply(am338(), { type: 'key', layer: 0, index: 1, keycode: 'KC_Z' });
    s = apply(s, { type: 'key', layer: 0, index: 1, keycode: 'KC_X' });
    expect(keymapOf(undo(s)).layers[0][1]).toBe('KC_W');
    s = apply(s, { type: 'key', layer: 0, index: 1, keycode: 'KC_W' });
    expect(review(s)).toEqual(expect.objectContaining({ keys: [], files: [], message: '' }));
  });

  it('keeps combos on their keys when a base key they use changes', () => {
    // combo_comma is M + L click; M is key 26 on Base.
    const s = apply(am338(), { type: 'key', layer: 0, index: 26, keycode: 'KC_SCLN' });
    expect(readCombos(currentFiles(s)[KEYMAP])[0]).toEqual({ name: 'combo_comma', keys: ['KC_SCLN', 'KC_BTN1'], output: 'KC_COMM' });
  });
});

describe('combos', () => {
  it('adds a combo from positions on the board, with the keys on Base there', () => {
    // H and J are keys 15 and 16 on Base.
    const s = apply(am338(), { type: 'comboAdd', positions: [15, 16], output: 'KC_ESC' });
    expect(readCombos(currentFiles(s)[KEYMAP]).at(-1)).toEqual({ name: 'combo_4', keys: ['KC_H', 'KC_J'], output: 'KC_ESC' });
    expect(review(s).combos).toEqual([{ change: 'added', keys: ['KC_H', 'KC_J'], output: 'KC_ESC' }]);
    expect(review(s).message).toBe('Add a combo for Esc');
  });

  it('changes and removes combos', () => {
    let s = apply(am338(), { type: 'comboSet', name: 'combo_dot', positions: [27, 28], output: 'KC_SCLN' });
    expect(review(s).combos).toEqual([{ change: 'changed', keys: ['KC_BTN1', 'KC_BTN2'], output: 'KC_SCLN', was: 'KC_DOT' }]);
    s = apply(am338(), { type: 'comboRemove', name: 'combo_bsls' });
    expect(readCombos(currentFiles(s)[KEYMAP]).map((c) => c.name)).toEqual(['combo_comma', 'combo_dot']);
    expect(review(s).message).toBe('Remove the combo for \\');
  });

  it('refuses a combo whose keys are not unique on Base, with the reason', () => {
    // Keys 38 and 39 are both _______ on Base (under the ball); # appears twice on Symbol but
    // combos read Base. A single key is not a combo.
    expect(comboProblem(am338(), [38, 39])).toBe('picker.err.comboNotUnique');
    expect(comboProblem(am338(), [15])).toBe('picker.err.comboTooFew');
    expect(comboProblem(am338(), [15, 16])).toBeUndefined();
  });
});

describe('layers', () => {
  it('adds a layer and names it', () => {
    let s = apply(am338(), { type: 'layerAdd' });
    s = apply(s, { type: 'layerName', layer: 4, name: 'Mouse' });
    expect(keymapOf(s).layers.length).toBe(5);
    const json = currentFiles(s)['keyballer.json'];
    expect(json).toContain('        "Function",\n        "Mouse"\n');
    expect(review(s).layers).toEqual([{ change: 'added', layer: 4 }, { change: 'renamed', layer: 4, name: 'Mouse' }]);
    expect(review(s).message).toBe('Add layer 4 and name layer 4 Mouse');
  });

  it('renames a layer in keyballer.json only', () => {
    const s = apply(am338(), { type: 'layerName', layer: 1, name: 'Sym' });
    const files = currentFiles(s);
    expect(files['keyballer.json']).toBe(fixture('keyballer.json').replace('        "Symbol",', '        "Sym",'));
    expect(review(s).files.map((f) => f.path)).toEqual(['keyballer.json']);
  });

  it('removes the last layer and its name', () => {
    const s = apply(am338(), { type: 'layerRemove' });
    expect(keymapOf(s).layers.length).toBe(3);
    expect(currentFiles(s)['keyballer.json']).toContain('        "Number"\n      ],');
    expect(review(s).message).toBe('Remove layer 3');
  });
});

describe('ball modes', () => {
  // am338 sets its scroll layer in code; with KEYBALLER_SCROLL_LAYERS the editor can change it.
  const withDefine = (): Session => {
    const s = am338();
    const src = s.base.files[KEYMAP].replace('#include QMK_KEYBOARD_H\n', '#include QMK_KEYBOARD_H\n\n#define KEYBALLER_SCROLL_LAYERS (1 << 3)\n');
    return openSession({ ...s.base, files: { ...s.base.files, [KEYMAP]: src } });
  };

  it('makes the ball scroll on another layer, in keymap.c and in the view settings', () => {
    const s = apply(withDefine(), { type: 'ballMode', layer: 2, mode: 'scroll' });
    const files = currentFiles(s);
    expect(files[KEYMAP]).toContain('#define KEYBALLER_SCROLL_LAYERS ((1 << 2) | (1 << 3))\n');
    expect(files['keyballer.json']).toContain('"3": "scroll",\n        "2": "scroll"\n');
    expect(review(s).layers).toEqual([{ change: 'ball', layer: 2, mode: 'scroll' }]);
    expect(review(s).message).toBe('Make the ball scroll on Number');
  });

  it('only where keymap.c says which layers scroll', () => {
    expect(ballModeEditable(withDefine())).toBe(true);
    expect(ballModeEditable(am338())).toBe(false);
  });
});

describe('what the board draws while editing', () => {
  const view = viewFixture as unknown as ViewFile;

  it('shows the edited keys, layers and names over the built view', () => {
    let s = apply(am338(), { type: 'key', layer: 0, index: 1, keycode: 'KC_Z' });
    s = apply(s, { type: 'layerAdd' });
    s = apply(s, { type: 'layerName', layer: 4, name: 'Mouse' });
    const drawn = editedView(view, s);
    expect(drawn.layers[0].keys[1]).toBe('KC_Z');
    expect(drawn.layers[0].keys[0]).toBe('ALT_T(KC_Q)');
    expect(drawn.layers.map((l) => l.name)).toEqual(['Base', 'Symbol', 'Number', 'Function', 'Mouse']);
    expect(drawn.layers[4].keys.every((k) => k === '_______')).toBe(true);
    expect(drawn.keys).toBe(view.keys); // the board's shape comes from the build
  });

  it('shows combos where their keys are, keeping the source line of those not changed', () => {
    const s = apply(am338(), { type: 'comboAdd', positions: [15, 16], output: 'KC_ESC' });
    const combos = editedView(view, s).combos;
    expect(combos[0]).toEqual({ ...view.combos[0], name: 'combo_comma' });
    expect(combos.at(-1)).toEqual({ name: 'combo_4', keys: ['KC_H', 'KC_J'], positions: [15, 16], output: 'KC_ESC', line: 0 });
  });

  it('is the built view itself when nothing has been read yet', () => {
    expect(editedView(view, null)).toBe(view);
  });
});

describe('found in review', () => {
  it('says when only the keys of a combo change', () => {
    // combo_dot moves from L click + R click to M + L click.
    const s = apply(am338(), { type: 'comboSet', name: 'combo_dot', positions: [26, 27], output: 'KC_DOT' });
    expect(review(s).message).toBe('Change the keys of the combo for .');
  });

  it('refuses a base key change that would leave a combo without unique keys', () => {
    // M (26) is in combo_comma; L click (27) is in combo_comma and combo_dot.
    expect(keyProblem(am338(), 0, 26, '_______')).toBe('picker.err.comboWouldBreak');
    expect(keyProblem(am338(), 0, 27, 'KC_BTN2')).toBe('picker.err.comboWouldBreak');
    expect(keyProblem(am338(), 0, 26, 'KC_N')).toBe('picker.err.comboWouldBreak'); // N is on Base already
    expect(keyProblem(am338(), 0, 26, 'KC_SCLN')).toBeUndefined();
    expect(keyProblem(am338(), 1, 26, '_______')).toBeUndefined(); // combos read Base only
  });

  it('skips changes that no longer apply after the repository moved on', () => {
    const s = apply(am338(), { type: 'comboRemove', name: 'combo_dot' });
    const files = { ...s.base.files, [KEYMAP]: s.base.files[KEYMAP].replaceAll('combo_dot', 'combo_period') };
    const moved = rebase(s, { ...s.base, commit: 'newer00', files });
    expect(() => review(moved)).not.toThrow();
    expect(review(moved).combos).toEqual([]);
  });

  it('reports the mode the ball ends up with on each layer', () => {
    const withDefine = openSession({
      ...am338().base,
      files: { ...am338().base.files, [KEYMAP]: am338().base.files[KEYMAP].replace('#include QMK_KEYBOARD_H\n', '#include QMK_KEYBOARD_H\n#define KEYBALLER_SCROLL_LAYERS (1 << 3)\n') },
    });
    let s = apply(withDefine, { type: 'ballMode', layer: 2, mode: 'cursor' });
    s = apply(s, { type: 'ballMode', layer: 1, mode: 'scroll' });
    s = apply(s, { type: 'ballMode', layer: 2, mode: 'scroll' });
    expect(review(s).layers).toEqual([
      { change: 'ball', layer: 1, mode: 'scroll' },
      { change: 'ball', layer: 2, mode: 'scroll' },
    ]);
    // Removing the last layer takes its scroll bit too.
    const removed = currentFiles(apply(withDefine, { type: 'layerRemove' }))[KEYMAP];
    expect(removed).toContain('#define KEYBALLER_SCROLL_LAYERS 0\n');
  });

  it('says why a keymap cannot be edited, instead of failing', () => {
    expect(keymapProblem(am338(), 'LAYOUT_universal')).toBeUndefined();
    expect(keymapProblem(am338(), 'LAYOUT_other')).toBe('edit.err.layoutMismatch');
    const broken = openSession({ ...am338().base, files: { ...am338().base.files, [KEYMAP]: 'int main(void) { return 0; }\n' } });
    expect(keymapProblem(broken, 'LAYOUT_universal')).toBe('edit.err.noKeymaps');
    expect(() => review(broken)).not.toThrow();
  });
});
