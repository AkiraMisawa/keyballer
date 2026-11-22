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
  | { type: 'comboAdd'; positions: number[]; output: string }
  | { type: 'comboSet'; name: string; positions: number[]; output: string }
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
      return !!s && same(s.positions, c.positions);
    });
  if (!matches) return { problem: 'edit.err.zmkUnreadable' };
  return {
    base: {
      path: keymap.path,
      model: {
        layers: view.layers.map((l, n) => ({ node: layers[n].node, name: l.name, keys: [...l.keys] })),
        combos: view.combos.map((c) => ({ name: c.name!, positions: c.positions as number[], output: c.output })),
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

function write(doc: ZmkDoc, keycode: string): { src: string; text: string } {
  const out = zmkBinding(keycode, zmkContext(doc));
  if ('refused' in out) throw new ZmkSourceError(out.refused);
  return { src: out.header ? ensureInclude(doc.src, out.header) : doc.src, text: out.text };
}

/** A node name from what a combo types: `&kp LS(TAB)` → combo_ls_tab. */
const comboBase = (binding: string) => `combo_${binding.replace(/^&(kp\s+)?/, '')}`;

/** One change to the model and the file; throws when it cannot be made (session.ts skips it). */
export function applyZmkEdit(doc: ZmkDoc, e: ZmkEdit): ZmkDoc {
  const layers = doc.model.layers.map((l) => ({ ...l, keys: [...l.keys] }));
  const combos = doc.model.combos.map((c) => ({ ...c }));
  switch (e.type) {
    case 'key': {
      const layer = layers[e.layer];
      if (!layer || e.index >= layer.keys.length) throw new ZmkSourceError('no such key');
      const { src, text } = write(doc, e.keycode);
      layer.keys[e.index] = e.keycode;
      return { model: { layers, combos }, src: setZmkBinding(src, layer.node, e.index, text) };
    }
    case 'comboAdd': {
      const { src, text } = write(doc, e.output);
      const name = freeName(comboBase(text), readZmkKeymap(src).combos.map((c) => c.node));
      combos.push({ name, positions: e.positions, output: e.output });
      return { model: { layers, combos }, src: addZmkCombo(src, name, e.positions, text) };
    }
    case 'comboSet': {
      const combo = combos.find((c) => c.name === e.name);
      if (!combo) throw new ZmkSourceError('no such combo');
      const { src, text } = write(doc, e.output);
      Object.assign(combo, { positions: e.positions, output: e.output });
      return { model: { layers, combos }, src: setZmkCombo(src, e.name, e.positions, text) };
    }
    case 'comboRemove':
      return { model: { layers, combos: combos.filter((c) => c.name !== e.name) }, src: removeZmkCombo(doc.src, e.name) };
    case 'layerAdd': {
      const last = layers[layers.length - 1];
      const node = freeName(`layer_${layers.length}`, readZmkKeymap(doc.src).layers.map((l) => l.node));
      layers.push({ node, name: node, keys: last.keys.map(() => 'KC_TRNS') });
      return { model: { layers, combos }, src: addZmkLayer(doc.src, last.node, node, last.keys.length) };
    }
    case 'layerRemove': {
      if (layers.length < 2) throw new ZmkSourceError('the last layer');
      const last = layers.pop()!;
      return { model: { layers, combos }, src: removeZmkLayer(doc.src, last.node) };
    }
    case 'layerName': {
      const layer = layers[e.layer];
      if (!layer) throw new ZmkSourceError('no such layer');
      layer.name = e.name || layer.node;
      return { model: { layers, combos }, src: setZmkLayerName(doc.src, layer.node, e.name) };
    }
  }
}
