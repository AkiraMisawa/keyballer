// Editing a ZMK keymap through the session (docs/plans/zmk.md, phase 4). The fixtures are the
// owner's real files: each view as the build published it on the firmware branch (2026-11-22),
// and the .keymap file it was built from, whose SHA-256 the view records. Expected lines are
// copied by hand from the .keymap files.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseView, type ViewFile } from '../keymap/view';
import {
  apply,
  comboOutputProblem,
  comboProblem,
  currentFiles,
  editedView,
  keymapProblem,
  keyProblem,
  openSession,
  ownKeycodes,
  review,
  savedBase,
  type Edit,
  type Session,
} from './session';
import { openZmk } from './zmk';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ROBA_VIEW = parseView(JSON.parse(read('./fixtures/roba-right.view.json')));
const M40_VIEW = parseView(JSON.parse(read('./fixtures/meteorite40.view.json')));
const ROBA = read('../config/fixtures/roBa.keymap');
const M40 = read('../config/fixtures/meteorite40.keymap');
const PATH = 'config/roBa.keymap';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function session(view: ViewFile, path: string, src: string): Session {
  const zmk = openZmk(view, src, sha(src));
  const files: Record<string, string> = { 'keyballer.json': '{"firmware": "zmk", "builds": []}' };
  if ('base' in zmk) files[path] = src;
  return openSession({ commit: 'base000', buildId: 'roba-right', keymapDir: '', files, zmk });
}

const roba = () => session(ROBA_VIEW, PATH, ROBA);
const edits = (s: Session, ...list: Edit[]) => list.reduce(apply, s);
const fileOf = (s: Session) => currentFiles(s)[PATH];

/** The change replaced exactly this text, once, and nothing else. */
function onlyChanged(before: string, after: string, from: string, to: string) {
  expect(before.split(from).length).toBe(2);
  expect(after).toBe(before.replace(from, to));
}

describe('opening a ZMK keymap', () => {
  it('opens the file the build was made from', () => {
    const s = roba();
    expect(keymapProblem(s, ROBA_VIEW.layout)).toBeUndefined();
    expect(review(s)).toEqual({ changes: [], keys: [], combos: [], layers: [], files: [], message: '' });
  });

  it('says why when the file is not the one built, or the build did not record one', () => {
    const changed = ROBA.replace('&kp W ', '&kp Z ');
    expect(openZmk(ROBA_VIEW, changed, sha(changed))).toEqual({ problem: 'edit.err.zmkChanged' });
    expect(openZmk(ROBA_VIEW, undefined, '')).toEqual({ problem: 'edit.err.zmkChanged' });
    const { zmk, ...old } = ROBA_VIEW;
    expect(openZmk(old as ViewFile, ROBA, sha(ROBA))).toEqual({ problem: 'edit.err.zmkNoSource' });
    // A path that would leave the repository's contents is not one Keyballer reads.
    const outside = { ...ROBA_VIEW, zmk: { ...zmk, keymap: { path: '../config/roBa.keymap', sha256: sha(ROBA) } } };
    expect(openZmk(outside, ROBA, sha(ROBA))).toEqual({ problem: 'edit.err.zmkNoSource' });
    // keymapProblem passes it on to the screen.
    const s = openSession({ commit: 'c', buildId: 'roba-right', keymapDir: '', files: {}, zmk: { problem: 'edit.err.zmkChanged' } });
    expect(keymapProblem(s, ROBA_VIEW.layout)).toBe('edit.err.zmkChanged');
  });

  it('refuses a file whose structure is not the build’s, such as keys written with a macro', () => {
    const macro = ROBA.replace('&kp W ', 'MY_W  ');
    const view = { ...ROBA_VIEW, zmk: { ...ROBA_VIEW.zmk, keymap: { path: PATH, sha256: sha(macro) } } };
    expect(openZmk(view, macro, sha(macro))).toEqual({ problem: 'edit.err.zmkUnreadable' });
    const renamed = ROBA.replace('        SYMBOL {', '        SYMBOLS {');
    const view2 = { ...ROBA_VIEW, zmk: { ...ROBA_VIEW.zmk, keymap: { path: PATH, sha256: sha(renamed) } } };
    expect(openZmk(view2, renamed, sha(renamed))).toEqual({ problem: 'edit.err.zmkUnreadable' });
  });
});

describe('changing keys', () => {
  it('writes the key, shows it on the board, and lists it for review', () => {
    const s = edits(roba(), { type: 'key', layer: 0, index: 1, keycode: 'KC_TAB' });
    const row = '&mt LEFT_ALT Q      &kp W             &kp E';
    onlyChanged(ROBA, fileOf(s), row, '&mt LEFT_ALT Q      &kp TAB           &kp E');
    expect(editedView(ROBA_VIEW, s).layers[0].keys[1]).toBe('KC_TAB');
    const r = review(s);
    expect(r.keys).toEqual([{ layer: 0, index: 1, from: 'KC_W', to: 'KC_TAB' }]);
    expect(r.files.map((f) => f.path)).toEqual([PATH]);
    expect(r.files[0].diff).toContain('+&mt LEFT_ALT Q      &kp TAB           &kp E');
    expect(r.message).toMatch(/^Change W to Tab on default_layer/);
  });

  it('writes a key the file already has the way the file writes it, custom behaviours too', () => {
    const s = edits(
      roba(),
      { type: 'key', layer: 4, index: 0, keycode: 'KC_LALT' },
      { type: 'key', layer: 4, index: 1, keycode: 'LT(5,ZMK_TO_LAYER_0_70034)' },
    );
    // MOUSE layer, first row. The long bindings move the rest of the row; the bindings with room
    // again are back in their columns, and no other line changes.
    const row = '&trans  &trans  &trans  &trans  &trans                      &trans  &trans    &trans    &trans    &trans';
    const after = fileOf(s).split('\n');
    const before = ROBA.split('\n');
    const at = before.indexOf(row);
    expect(after[at]).toMatch(/^&kp LEFT_ALT &lt_to_layer_0 5 APOSTROPHE &trans /);
    expect(after[at].lastIndexOf('&trans')).toBe(row.lastIndexOf('&trans'));
    expect(after.filter((l, i) => l !== before[i])).toEqual([after[at]]);
  });

  it('refuses keys the firmware has no binding for, and offers the keymap’s own', () => {
    const s = roba();
    expect(keyProblem(s, 0, 0, 'KBC_SAVE')).toBe('picker.err.notInZmk');
    expect(keyProblem(s, 0, 0, 'TT(1)')).toBe('picker.err.notInZmk');
    // roBa uses &mkp and &bt already, so their features are on.
    expect(keyProblem(s, 0, 0, 'KC_BTN3')).toBeUndefined();
    expect(keyProblem(s, 0, 0, 'ZMK_BT_SEL_1')).toBeUndefined();
    // A ZMK combo is positions, so a key under one can become anything.
    expect(keyProblem(s, 0, 11, 'KC_NO')).toBeUndefined();
    expect(ownKeycodes(s)).toEqual(expect.arrayContaining(['LT(5,ZMK_TO_LAYER_0_70034)', 'ZMK_BT_SEL_0', 'ZMK_BT_CLR_ALL', 'ZMK_OUT_USB']));
  });
});

describe('combos', () => {
  it('adds, changes and removes combos by their node', () => {
    // The file writes Esc as &kp ESCAPE elsewhere, so the combo does too.
    const added = edits(roba(), { type: 'comboAdd', positions: [1, 2], output: 'KC_ESC' });
    expect(fileOf(added)).toContain('        combo_escape {\n            bindings = <&kp ESCAPE>;\n            key-positions = <1 2>;\n        };\n    };');
    expect(editedView(ROBA_VIEW, added).combos.at(-1)).toMatchObject({ name: 'combo_escape', positions: [1, 2], keys: ['KC_W', 'KC_E'], output: 'KC_ESC' });
    expect(review(added).combos).toEqual([{ change: 'added', keys: ['KC_W', 'KC_E'], output: 'KC_ESC' }]);

    const changed = edits(roba(), { type: 'comboSet', name: 'tab', positions: [11, 12], output: 'KC_ESC' });
    onlyChanged(ROBA, fileOf(changed), '<&kp TAB>;\n            key-positions = <11 12>;', '<&kp ESCAPE>;\n            key-positions = <11 12>;');
    expect(review(changed).combos).toEqual([{ change: 'changed', keys: ['KC_S', 'KC_D'], output: 'KC_ESC', was: 'KC_TAB' }]);

    const removed = edits(roba(), { type: 'comboRemove', name: 'tab' });
    expect(fileOf(removed)).not.toContain('        tab {');
    expect(review(removed).combos).toEqual([{ change: 'removed', keys: ['KC_S', 'KC_D'], output: 'KC_TAB' }]);
  });

  it('needs two keys, and an output ZMK can type', () => {
    expect(comboProblem(roba(), [3])).toBe('picker.err.comboTooFew');
    expect(comboProblem(roba(), [3, 4])).toBeUndefined();
    expect(comboOutputProblem(roba(), 'CPI_I100')).toBe('picker.err.notInZmk');
    expect(comboOutputProblem(roba(), 'KC_LNG1')).toBeUndefined();
  });

  it('leaves combos limited to other layers as they are', () => {
    const s = edits(session(M40_VIEW, 'config/meteorite40.keymap', M40), { type: 'comboSet', name: 'lang1', positions: [12, 13], output: 'KC_LNG2' });
    const after = currentFiles(s)['config/meteorite40.keymap'];
    onlyChanged(M40, after, 'bindings = <&kp LANG1>;', 'bindings = <&kp LANG2>;');
    expect(after).toContain('key-positions = <16 17>; /* J + K (on layer 2) */\n            layers = <2>;');
  });
});

describe('layers', () => {
  it('adds a layer, and removing it again gives back the file', () => {
    const added = edits(roba(), { type: 'layerAdd' });
    expect(readLayers(fileOf(added))).toContain('layer_8 {');
    expect(editedView(ROBA_VIEW, added).layers).toHaveLength(9);
    expect(review(added).layers).toEqual([{ change: 'added', layer: 8 }]);
    expect(fileOf(edits(added, { type: 'layerRemove' }))).toBe(ROBA);
  });

  it('names a layer with its display-name', () => {
    const s = edits(roba(), { type: 'layerName', layer: 2, name: 'Numbers' });
    onlyChanged(ROBA, fileOf(s), '        NUM {\n', '        NUM {\n            display-name = "Numbers";\n');
    expect(review(s).layers).toEqual([{ change: 'renamed', layer: 2, name: 'Numbers' }]);
    expect(editedView(ROBA_VIEW, s).layers[2].name).toBe('Numbers');
  });
});

describe('after saving', () => {
  it('starts again from the saved file, which means what was edited', () => {
    const edited = edits(roba(), { type: 'key', layer: 0, index: 1, keycode: 'KC_TAB' }, { type: 'layerAdd' });
    const next = openSession(savedBase(edited, 'saved01'));
    expect(next.base.commit).toBe('saved01');
    expect(review(next).files).toEqual([]);
    expect(editedView(ROBA_VIEW, next).layers[0].keys[1]).toBe('KC_TAB');
    expect(editedView(ROBA_VIEW, next).layers).toHaveLength(9);
    // And it can be edited again from there.
    const again = edits(next, { type: 'key', layer: 8, index: 0, keycode: 'KC_A' });
    expect(review(again).keys).toEqual([{ layer: 8, index: 0, from: 'KC_TRNS', to: 'KC_A' }]);
  });
});

function readLayers(src: string) {
  return src.slice(src.indexOf('keymap {'));
}
