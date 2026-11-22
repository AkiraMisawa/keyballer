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

describe('a view that does not tell the truth', () => {
  it('never decides what a key is written as', () => {
    // The view names the &bootloader key F13; putting F13 on a key must still write F13.
    const boot = ROBA_VIEW.layers[6].keys.indexOf('QK_BOOT');
    const layers = ROBA_VIEW.layers.map((l, n) => (n === 6 ? { ...l, keys: l.keys.map((k, i) => (i === boot ? 'KC_F13' : k)) } : l));
    const s = edits(session({ ...ROBA_VIEW, layers }, PATH, ROBA), { type: 'key', layer: 0, index: 1, keycode: 'KC_F13' });
    expect(review(s).files[0].diff).toContain('+&mt LEFT_ALT Q      &kp F13           &kp E');
    expect(fileOf(s).match(/&bootloader/g)).toHaveLength(1);
  });

  it('is refused when its sizes do not fit the board', () => {
    const short = { ...ROBA_VIEW, layers: ROBA_VIEW.layers.map((l, n) => (n === 0 ? { ...l, keys: l.keys.slice(1) } : l)) };
    expect(openZmk(short, ROBA, sha(ROBA))).toEqual({ problem: 'edit.err.zmkUnreadable' });
    const many = { ...ROBA_VIEW, keys: [...ROBA_VIEW.keys, ...Array(2000).fill(ROBA_VIEW.keys[0])] };
    expect(openZmk(many, ROBA, sha(ROBA))).toEqual({ problem: 'edit.err.zmkUnreadable' });
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

describe('changes that are not changes', () => {
  it('lists no change for the same key written another way', () => {
    // SYMBOL has &kp EXCLAMATION, which the view reads as LSFT(KC_1); the picker calls it KC_EXLM.
    const at = ROBA_VIEW.layers[1].keys.indexOf('LSFT(KC_1)');
    expect(at).toBeGreaterThanOrEqual(0);
    const s = edits(roba(), { type: 'key', layer: 1, index: at, keycode: 'KC_EXLM' });
    expect(review(s)).toMatchObject({ keys: [], files: [] });
  });

  it('names a layer as ZMK will when its name is cleared', () => {
    // A layer named by its label: clearing the name leaves the label, which ZMK shows.
    const src = ROBA.replace('        NUM {\n', '        NUM {\n            label = "NUMBERS";\n');
    const view = {
      ...ROBA_VIEW,
      layers: ROBA_VIEW.layers.map((l, n) => (n === 2 ? { ...l, name: 'NUMBERS' } : l)),
      zmk: { ...ROBA_VIEW.zmk, keymap: { path: PATH, sha256: sha(src) } },
    };
    const s = edits(session(view, PATH, src), { type: 'layerName', layer: 2, name: '' });
    expect(review(s)).toMatchObject({ layers: [], files: [] });
    expect(editedView(view, s).layers[2].name).toBe('NUMBERS');
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

describe('combos on some layers', () => {
  const M40_PATH = 'config/meteorite40.keymap';
  const m40 = () => session(M40_VIEW, M40_PATH, M40);

  it('opens combos with the layers they fire on, as the file has them', () => {
    // meteorite40.keymap: J+K types Home on layer 2 only, where those keys are Left and Up.
    expect(editedView(M40_VIEW, m40()).combos.find((c) => c.name === 'home')).toMatchObject({ layers: [2], keys: ['KC_LEFT', 'KC_UP'] });
    // A view that says Home fires on every layer is not the file's.
    const lying = { ...M40_VIEW, combos: M40_VIEW.combos.map(({ layers: _, ...c }) => c) };
    expect(openZmk(lying, M40, sha(M40))).toEqual({ problem: 'edit.err.zmkUnreadable' });
  });

  it('limits a combo to layers, and lets it fire on every layer again', () => {
    const limited = edits(roba(), { type: 'comboLayers', name: 'tab', layers: [0, 3] });
    onlyChanged(ROBA, fileOf(limited), '            key-positions = <11 12>;\n', '            key-positions = <11 12>;\n            layers = <0 3>;\n');
    expect(editedView(ROBA_VIEW, limited).combos.find((c) => c.name === 'tab')?.layers).toEqual([0, 3]);
    expect(review(limited).combos).toEqual([{ change: 'layers', keys: ['KC_S', 'KC_D'], output: 'KC_TAB', layers: [0, 3] }]);
    expect(review(limited).message).toBe('Make the combo for Tab fire on default_layer and ARROW only');
    const back = edits(limited, { type: 'comboLayers', name: 'tab', layers: null });
    expect(fileOf(back)).toBe(ROBA);
    expect(review(back).combos).toEqual([]);
    const all = edits(m40(), { type: 'comboLayers', name: 'home', layers: [] });
    expect(review(all).combos).toEqual([{ change: 'layers', keys: ['KC_J', 'KC_K'], output: 'KC_HOME', layers: null }]);
    expect(review(all).message).toBe('Make the combo for Home fire on every layer');
  });

  it('adds a combo for the layers chosen', () => {
    const s = edits(m40(), { type: 'comboAdd', positions: [16, 19], output: 'KC_PGUP', layers: [2] });
    expect(currentFiles(s)[M40_PATH]).toContain('key-positions = <16 19>;\n            layers = <2>;\n');
    // Its keys are those of the layer it fires on.
    expect(review(s).combos).toEqual([{ change: 'added', keys: ['KC_LEFT', 'KC_RGHT'], output: 'KC_PGUP', layers: [2] }]);
  });

  it('takes a removed layer out of combos, and removes the combos that fired only on it', () => {
    const s = edits(
      roba(),
      { type: 'layerAdd' },
      { type: 'comboLayers', name: 'tab', layers: [0, 8] },
      { type: 'comboAdd', positions: [1, 2], output: 'KC_ESC', layers: [8] },
      { type: 'layerRemove' },
    );
    expect(fileOf(s)).toContain('            key-positions = <11 12>;\n            layers = <0>;\n');
    expect(fileOf(s)).not.toContain('combo_escape');
    expect(review(s).combos).toEqual([{ change: 'layers', keys: ['KC_S', 'KC_D'], output: 'KC_TAB', layers: [0] }]);
  });
});

describe('layers', () => {
  it('adds a layer, and removing it again gives back the file', () => {
    const added = edits(roba(), { type: 'layerAdd' });
    expect(readLayers(fileOf(added))).toContain('layer_8 {');
    expect(editedView(ROBA_VIEW, added).layers).toHaveLength(9);
    expect(review(added).layers).toEqual([{ change: 'added', layer: 8 }]);
    expect(fileOf(edits(added, { type: 'layerRemove' }))).toBe(ROBA);
    // A new layer that is named lists its name too, as QMK's review does.
    expect(review(edits(added, { type: 'layerName', layer: 8, name: 'Extra' })).layers).toEqual([
      { change: 'added', layer: 8 },
      { change: 'renamed', layer: 8, name: 'Extra' },
    ]);
  });

  it('leaves no empty combos node after adding and removing a combo', () => {
    const src = M40.slice(0, M40.indexOf('    combos {')) + M40.slice(M40.indexOf('    keymap {'));
    const view = { ...M40_VIEW, combos: [], zmk: { ...M40_VIEW.zmk, keymap: { path: 'config/meteorite40.keymap', sha256: sha(src) } } };
    const s = edits(session(view, 'config/meteorite40.keymap', src), { type: 'comboAdd', positions: [0, 1], output: 'KC_TAB' });
    expect(currentFiles(s)['config/meteorite40.keymap']).toContain('combos {');
    const name = editedView(view, s).combos[0].name!;
    const back = edits(s, { type: 'comboRemove', name });
    expect(currentFiles(back)['config/meteorite40.keymap']).toBe(src);
    expect(review(back).files).toEqual([]);
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
