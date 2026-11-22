// Editing a ZMK keymap (docs/plans/zmk.md, phase 4). What each key means comes from the build's
// view, which session.ts only trusts for the .keymap file it was built from: the file must have
// the SHA-256 the build recorded, and the same layers, behaviours and combos. Changes are made to
// a model of the keys and, in the same step, to the file's text (src/config/zmkKeymap.ts). Pure:
// no React, no network.

import {
  addZmkCombo,
  addZmkLayer,
  ensureInclude,
  freeName,
  readZmkKeymap,
  removeZmkCombo,
  removeZmkLayer,
  setZmkBinding,
  setZmkCombo,
  setZmkComboLayers,
  setZmkLayerName,
  ZmkSourceError,
  type ZmkSource,
} from '../config/zmkKeymap';
import type { MessageKey } from '../i18n/messages';
import { isPlainPath } from '../lib/manifest';
import type { ViewFile } from '../keymap/view';
import { zmkBinding, type ZmkContext } from '../keymap/zmkKeys';

export interface ZmkLayer {
  node: string;
  name: string | null;
  keys: string[];
}

export interface ZmkCombo {
  name: string;
  positions: number[];
  output: string;
  /** The layers it fires on, or null for every layer. */
  layers: number[] | null;
}

/** The keys as Keyballer shows them: QMK's names, as the build's view has them. */
export interface ZmkModel {
  layers: ZmkLayer[];
  combos: ZmkCombo[];
}

export interface ZmkBase {
  /** The .keymap file, as its path in the config repository. */
  path: string;
  /** What the file at the session's commit means. */
  model: ZmkModel;
}

/** The edits session.ts passes on: the keymap ones (trackball settings have no ZMK file). */
export type ZmkEdit =
  | { type: 'key'; layer: number; index: number; keycode: string }
  | { type: 'comboAdd'; positions: number[]; output: string; layers?: number[] | null }
  | { type: 'comboSet'; name: string; positions: number[]; output: string }
  | { type: 'comboLayers'; name: string; layers: number[] | null }
  | { type: 'comboRemove'; name: string }
  | { type: 'layerAdd' }
  | { type: 'layerRemove' }
  | { type: 'layerName'; layer: number; name: string };

/** The .keymap file the build recorded, when its path is one Keyballer reads. */
export function zmkKeymapOf(view: ViewFile): { path: string; sha256: string } | null {
  const keymap = view.zmk?.keymap;
  if (!keymap || typeof keymap.path !== 'string' || typeof keymap.sha256 !== 'string') return null;
  // The path goes into GitHub API URLs with the token, as manifest paths do.
  const plain = isPlainPath(keymap.path) && keymap.path.endsWith('.keymap');
  return plain && /^[0-9a-f]{64}$/.test(keymap.sha256) ? { path: keymap.path, sha256: keymap.sha256 } : null;
}

const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** A combo's layers as the model keeps them: null for every layer, as ZMK reads none. */
const layersOf = (layers: number[] | null | undefined) => (layers?.length ? [...layers] : null);

// ZMK keeps layers in a 32-bit state; no keyboard Keyballer knows has more than a few hundred keys.
const MAX_LAYERS = 32;
const MAX_KEYS = 512;

/**
 * Whether the view's sizes fit its board: every layer has a key for each key of the layout and no
 * more bindings than keys. The view comes from the firmware branch, so its sizes are not trusted.
 */
function fits(view: ViewFile, layers: { refs: string[] }[]): boolean {
  const keys = view.keys.length;
  return (
    keys > 0 &&
    keys <= MAX_KEYS &&
    layers.length <= MAX_LAYERS &&
    view.layers.every((l) => l.keys.length === keys) &&
    layers.every((l) => l.refs.length <= keys)
  );
}

/**
 * The editor's starting point for a ZMK build, or why there is none: the view must name the file,
 * the file on main must be the one built (`sha256` is the file's, worked out by the caller), and
 * its structure must be the build's.
 */
export function openZmk(view: ViewFile, src: string | undefined, sha256: string): { base: ZmkBase } | { problem: MessageKey } {
  const keymap = zmkKeymapOf(view);
  const layers = view.zmk?.layers;
  if (!keymap || !Array.isArray(layers)) return { problem: 'edit.err.zmkNoSource' };
  if (src === undefined || sha256 !== keymap.sha256) return { problem: 'edit.err.zmkChanged' };
  let source: ZmkSource;
  try {
    source = readZmkKeymap(src);
  } catch (e) {
    if (e instanceof ZmkSourceError) return { problem: 'edit.err.zmkUnreadable' };
    throw e;
  }
  const matches =
    source.layers.length === layers.length &&
    layers.length >= view.layers.length &&
    source.layers.every(
      (l, n) => l.node === layers[n].node && (l.status ?? 'okay') === (layers[n].status ?? 'okay') && same(l.bindings.map((b) => b.ref), layers[n].refs),
    ) &&
    view.combos.every((c) => {
      const s = source.combos.find((sc) => sc.node === c.name);
      const layers = c.layers ?? [];
      return !!s && same(s.positions, c.positions) && Array.isArray(layers) && same(s.layers ?? [], layers);
    });
  if (!matches || !fits(view, layers)) return { problem: 'edit.err.zmkUnreadable' };
  return {
    base: {
      path: keymap.path,
      model: {
        layers: view.layers.map((l, n) => ({ node: layers[n].node, name: l.name, keys: [...l.keys] })),
        combos: view.combos.map((c) => ({ name: c.name!, positions: c.positions as number[], output: c.output, layers: layersOf(c.layers) })),
      },
    },
  };
}

export interface ZmkDoc {
  model: ZmkModel;
  src: string;
}

/** How keys are written in this file now: each keycode's binding as written, and what it uses. */
export function zmkContext(doc: ZmkDoc): ZmkContext {
  const source = readZmkKeymap(doc.src);
  const known = new Map<string, string>();
  const add = (code: string | undefined, text: string | undefined) => {
    if (code && text && !known.has(code.replace(/\s+/g, ''))) known.set(code.replace(/\s+/g, ''), text);
  };
  doc.model.layers.forEach((layer, n) => source.layers[n]?.bindings.forEach((b, i) => add(layer.keys[i], b.text)));
  for (const c of doc.model.combos) add(c.output, source.combos.find((s) => s.node === c.name)?.bindings[0]?.text);
  const codes = [...doc.model.layers.flatMap((l) => l.keys), ...doc.model.combos.map((c) => c.output)];
  return {
    known,
    mouse: codes.some((k) => /^KC_BTN[1-5]$/.test(k)),
    bluetooth: codes.some((k) => k.startsWith('ZMK_BT_')),
  };
}

/** The binding for a keycode in this file, or why there is none. */
export function zmkKeyProblem(doc: ZmkDoc, keycode: string): MessageKey | undefined {
  const out = zmkBinding(keycode, zmkContext(doc));
  return 'refused' in out ? out.refused : undefined;
}

const POINTING = 'dt-bindings/zmk/pointing.h';

function write(doc: ZmkDoc, keycode: string): { src: string; text: string } {
  const out = zmkBinding(keycode, zmkContext(doc));
  if ('refused' in out) throw new ZmkSourceError(out.refused);
  // Older ZMK has the mouse button names in mouse.h, which includes pointing.h where it exists.
  const included = out.header === POINTING && /#[ \t]*include[ \t]*<dt-bindings\/zmk\/mouse\.h>/.test(doc.src);
  return { src: out.header && !included ? ensureInclude(doc.src, out.header) : doc.src, text: out.text };
}

/**
 * The change, checked: the file must still read, with every layer of the model where it was and
 * exactly the model's combos, at their positions and on their layers, or the change is not made
 * (the session skips it). So a change can never leave a broken file, or one whose combos are not
 * the ones the review lists.
 */
function checked(doc: ZmkDoc): ZmkDoc {
  const source = readZmkKeymap(doc.src);
  const nodes = source.layers.map((l) => l.node);
  if (!doc.model.layers.every((l, n) => nodes[n] === l.node)) throw new ZmkSourceError('the layers moved');
  const combos = source.combos;
  const sameCombos =
    combos.length === doc.model.combos.length &&
    doc.model.combos.every((c, i) => {
      const s = combos[i];
      return s.node === c.name && s.bindings.length === 1 && same(s.positions, c.positions) && same(s.layers ?? [], c.layers ?? []);
    });
  if (!sameCombos) throw new ZmkSourceError('the combos are not the model’s');
  return doc;
}

/** A node name from what a combo types: `&kp LS(TAB)` → combo_ls_tab. */
const comboBase = (binding: string) => `combo_${binding.replace(/^&(kp\s+)?/, '')}`;

/** One change to the model and the file; throws when it cannot be made (session.ts skips it). */
export function applyZmkEdit(doc: ZmkDoc, e: ZmkEdit): ZmkDoc {
  return checked(change(doc, e));
}

function change(doc: ZmkDoc, e: ZmkEdit): ZmkDoc {
  const layers = doc.model.layers.map((l) => ({ ...l, keys: [...l.keys] }));
  const combos = doc.model.combos.map((c) => ({ ...c }));
  switch (e.type) {
    case 'key': {
      const layer = layers[e.layer];
      if (!layer || e.index >= layer.keys.length) throw new ZmkSourceError('no such key');
      const { src, text } = write(doc, e.keycode);
      // The same binding by another name (KC_EXLM where the file has &kp EXCLAMATION) is no change.
      const current = readZmkKeymap(doc.src).layers[e.layer]?.bindings[e.index]?.text;
      if (current === text) return doc;
      layer.keys[e.index] = e.keycode;
      return { model: { layers, combos }, src: setZmkBinding(src, layer.node, e.index, text) };
    }
    case 'comboAdd': {
      const { src, text } = write(doc, e.output);
      const name = freeName(comboBase(text), readZmkKeymap(src).combos.map((c) => c.node));
      const only = layersOf(e.layers);
      combos.push({ name, positions: e.positions, output: e.output, layers: only });
      return { model: { layers, combos }, src: addZmkCombo(src, name, e.positions, text, only) };
    }
    case 'comboSet': {
      const combo = combos.find((c) => c.name === e.name);
      if (!combo) throw new ZmkSourceError('no such combo');
      const { src, text } = write(doc, e.output);
      Object.assign(combo, { positions: e.positions, output: e.output });
      return { model: { layers, combos }, src: setZmkCombo(src, e.name, e.positions, text) };
    }
    case 'comboLayers': {
      const combo = combos.find((c) => c.name === e.name);
      if (!combo) throw new ZmkSourceError('no such combo');
      combo.layers = layersOf(e.layers);
      return { model: { layers, combos }, src: setZmkComboLayers(doc.src, e.name, combo.layers) };
    }
    case 'comboRemove':
      return { model: { layers, combos: combos.filter((c) => c.name !== e.name) }, src: removeZmkCombo(doc.src, e.name) };
    case 'layerAdd': {
      const last = layers[layers.length - 1];
      const node = freeName(`layer_${layers.length}`, readZmkKeymap(doc.src).layers.map((l) => l.node));
      const at = layers.length;
      layers.push({ node, name: node, keys: last.keys.map(() => 'KC_TRNS') });
      let src = addZmkLayer(doc.src, last.node, node, last.keys.length);
      // The new layer goes before any unused layer nodes, whose numbers go up by one; combos that
      // name them follow.
      for (const c of combos) {
        if (!c.layers?.some((l) => l >= at)) continue;
        c.layers = c.layers.map((l) => (l >= at ? l + 1 : l));
        src = setZmkComboLayers(src, c.name, c.layers);
      }
      return { model: { layers, combos }, src };
    }
    case 'layerRemove': {
      if (layers.length < 2) throw new ZmkSourceError('the last layer');
      const last = layers.pop()!;
      let src = removeZmkLayer(doc.src, last.node);
      // Combos fire on the layers they name: the removed one goes from them, and a combo that
      // fired only on it goes too, as without layers it would fire on every layer. Unused layer
      // nodes after it move down by one, and so do combos that name them.
      const removed = layers.length;
      const kept: ZmkCombo[] = [];
      for (const c of combos) {
        if (!c.layers?.some((l) => l >= removed)) kept.push(c);
        else if (c.layers.every((l) => l === removed)) src = removeZmkCombo(src, c.name);
        else {
          c.layers = c.layers.filter((l) => l !== removed).map((l) => (l > removed ? l - 1 : l));
          src = setZmkComboLayers(src, c.name, c.layers);
          kept.push(c);
        }
      }
      return { model: { layers, combos: kept }, src };
    }
    case 'layerName': {
      const layer = layers[e.layer];
      if (!layer) throw new ZmkSourceError('no such layer');
      const src = setZmkLayerName(doc.src, layer.node, e.name);
      // Without a display-name, ZMK names a layer by its label, then by its node.
      layer.name = e.name || readZmkKeymap(src).layers[e.layer]?.label || layer.node;
      return { model: { layers, combos }, src };
    }
  }
}
