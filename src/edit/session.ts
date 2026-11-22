// An edit session: the files read from the config repository at one commit,
// the changes made on screen (with undo and redo), and what saving would
// commit. Pure: no React, no network. See docs/plans/keymap-editor.md ("Editor
// state") and docs/plans/trackball-settings.md.

import { getJson, readJson, setJson, writeJson, type Json } from '../config/json';
import {
  addCombo,
  addLayer,
  readCombos,
  readKeymap,
  readScrollLayers,
  removeCombo,
  removeLastLayer,
  setCombo,
  setKey,
  setScrollLayers,
} from '../config/keymap';
import { readDefine, setBallMm, setDefine, setRule } from '../config/source';
import type { MessageKey } from '../i18n/messages';
import { readCustomKeycodes } from '../config/keymap';
import { basicLegend } from '../keymap/keycodes';
import type { ViewFile } from '../keymap/view';
import { zmkLabel } from '../keymap/zmkKeys';
import { applyZmkEdit, zmkKeyProblem, type ZmkBase, type ZmkDoc, type ZmkEdit, type ZmkModel } from './zmk';

export interface SessionBase {
  /** The commit the files were read from. */
  commit: string;
  buildId: string;
  keymapDir: string;
  /** File texts by path in the repository. */
  files: Record<string, string>;
  /**
   * A ZMK keymap (docs/plans/zmk.md, phase 4): its file and what it means, or why it cannot be
   * edited. Absent for QMK.
   */
  zmk?: { base: ZmkBase } | { problem: MessageKey };
}

/** The settings a session can change. */
export type Setting = 'cpi' | 'divider' | 'ballMm';

export type BallMode = 'cursor' | 'scroll';

export type Edit =
  | { type: Setting; value: number }
  | { type: 'key'; layer: number; index: number; keycode: string }
  /** A combo by its positions on the board; it names the base layer's keys there. */
  | { type: 'comboAdd'; positions: number[]; output: string }
  /** Combos by name, so a change still finds its combo after the repository moved on. */
  | { type: 'comboSet'; name: string; positions: number[]; output: string }
  | { type: 'comboRemove'; name: string }
  | { type: 'layerAdd' }
  | { type: 'layerRemove' }
  | { type: 'layerName'; layer: number; name: string }
  | { type: 'ballMode'; layer: number; mode: BallMode };

const isSetting = (e: Edit): e is { type: Setting; value: number } =>
  e.type === 'cpi' || e.type === 'divider' || e.type === 'ballMm';

export interface Session {
  base: SessionBase;
  /** Changes in the order made; undo takes the last one off. */
  edits: Edit[];
  /** Changes undone, most recent last; a new change clears them. */
  undone: Edit[];
}

export type Trackball = Record<Setting, number>;

export interface Change {
  setting: Setting;
  from: number;
  to: number;
}

export interface FileChange {
  path: string;
  /** Unified diff with three lines of context. */
  diff: string;
}

export interface KeyChange {
  layer: number;
  index: number;
  from: string;
  to: string;
}

export type ComboChange =
  | { change: 'added' | 'removed'; keys: string[]; output: string }
  | { change: 'changed'; keys: string[]; output: string; was: string };

export type LayerChange =
  | { change: 'added' | 'removed'; layer: number }
  | { change: 'renamed'; layer: number; name: string }
  | { change: 'ball'; layer: number; mode: BallMode };

export interface Review {
  /** Trackball settings. */
  changes: Change[];
  keys: KeyChange[];
  combos: ComboChange[];
  layers: LayerChange[];
  files: FileChange[];
  /** A draft commit message; empty when there is nothing to save. */
  message: string;
}

// keyball.h's defaults, and the ball Keyball ships with.
const KEYBALL_CPI_DEFAULT = 500;
const KEYBALL_SCROLL_DIV_DEFAULT = 4;
const KEYBALL_BALL_MM = 34;

const CPI = 'KEYBALL_CPI_DEFAULT';
const DIVIDER = 'KEYBALL_SCROLL_DIV_DEFAULT';
const CONFIG_JSON = 'keyballer.json';

const configPath = (base: SessionBase) => `${base.keymapDir}/config.h`;
const keymapPath = (base: SessionBase) => `${base.keymapDir}/keymap.c`;

/** The session's keymap.c as it now stands, if the keymap has one. */
export const keymapFileOf = (session: Session): string | undefined => currentFiles(session)[keymapPath(session.base)];

/** The ZMK keymap's starting point, when the session has one that can be edited. */
const zmkBaseOf = (base: SessionBase): ZmkBase | undefined => (base.zmk && 'base' in base.zmk ? base.zmk.base : undefined);
const rulesPath = (base: SessionBase) => `${base.keymapDir}/rules.mk`;

export function openSession(base: SessionBase): Session {
  return { base, edits: [], undone: [] };
}

/** Whether two edits change the same thing, so the later one replaces the earlier. */
function sameTarget(a: Edit, b: Edit): boolean {
  if (a.type !== b.type) return false;
  if (isSetting(a)) return true;
  if (a.type === 'key' && b.type === 'key') return a.layer === b.layer && a.index === b.index;
  if ((a.type === 'layerName' || a.type === 'ballMode') && a.type === b.type) return a.layer === (b as typeof a).layer;
  return false;
}

/**
 * Adds a change. Changing the same thing again right away (a slider drag, a key retyped)
 * replaces it, so it is one undo step.
 */
export function apply(session: Session, edit: Edit): Session {
  const last = session.edits.at(-1);
  const edits = last && sameTarget(last, edit) ? [...session.edits.slice(0, -1), edit] : [...session.edits, edit];
  return { ...session, edits, undone: [] };
}

export function undo(session: Session): Session {
  const last = session.edits.at(-1);
  if (!last) return session;
  return { ...session, edits: session.edits.slice(0, -1), undone: [...session.undone, last] };
}

export function redo(session: Session): Session {
  const next = session.undone.at(-1);
  if (!next) return session;
  return { ...session, edits: [...session.edits, next], undone: session.undone.slice(0, -1) };
}

export const canUndo = (session: Session) => session.edits.length > 0;
export const canRedo = (session: Session) => session.undone.length > 0;

function readNumber(text: string | undefined, fallback: number): number {
  const n = Number.parseInt(text ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function buildOf(base: SessionBase, files: Record<string, string>): { ball_mm?: number } | undefined {
  const json = JSON.parse(files[CONFIG_JSON]) as { builds: { id: string; ball_mm?: number }[] };
  return json.builds.find((b) => b.id === base.buildId);
}

/** Where each setting lives, how it is read and written, and how a commit message says it changed. */
const SETTINGS: Record<
  Setting,
  {
    read: (base: SessionBase, files: Record<string, string>) => number;
    write: (base: SessionBase, files: Record<string, string>, value: number) => void;
    clause: (to: number, buildId: string) => string;
  }
> = {
  cpi: {
    read: (b, f) => readNumber(readDefine(f[configPath(b)] ?? '', CPI), KEYBALL_CPI_DEFAULT),
    write: (b, f, v) => void (f[configPath(b)] = setDefine(f[configPath(b)] ?? '', CPI, String(v))),
    clause: (to) => `the cursor speed to ${to} CPI`,
  },
  divider: {
    read: (b, f) => readNumber(readDefine(f[configPath(b)] ?? '', DIVIDER), KEYBALL_SCROLL_DIV_DEFAULT),
    write: (b, f, v) => void (f[configPath(b)] = setDefine(f[configPath(b)] ?? '', DIVIDER, String(v))),
    clause: (to) => `the scroll divider to ${to}`,
  },
  ballMm: {
    read: (b, f) => buildOf(b, f)?.ball_mm ?? KEYBALL_BALL_MM,
    write: (b, f, v) => void (f[CONFIG_JSON] = setBallMm(f[CONFIG_JSON], b.buildId, v)),
    clause: (to, buildId) => `the ball size of ${buildId} to ${to} mm`,
  },
};

export const SETTING_ORDER = Object.keys(SETTINGS) as Setting[];

function settingsOf(base: SessionBase, files: Record<string, string>): Trackball {
  return Object.fromEntries(SETTING_ORDER.map((k) => [k, SETTINGS[k].read(base, files)])) as Trackball;
}

/** The settings as they are in the files read from the repository. */
export function savedTrackball(session: Session): Trackball {
  return settingsOf(session.base, session.base.files);
}

/** The settings as the session stands now. */
export function trackball(session: Session): Trackball {
  const now = savedTrackball(session);
  for (const e of session.edits) if (isSetting(e)) now[e.type] = e.value;
  return now;
}

const TRANSPARENT_OR_NONE = new Set(['_______', 'KC_TRNS', 'KC_TRANSPARENT', 'KC_NO', 'XXXXXXX']);

/**
 * Why a keymap cannot be edited here, if it cannot: keymap.c is missing or its keymaps[] cannot be
 * read, or it uses another layout than the build drawn on screen.
 */
export function keymapProblem(session: Session, layout: string): MessageKey | undefined {
  if (session.base.zmk) return 'problem' in session.base.zmk ? session.base.zmk.problem : undefined;
  const src = session.base.files[keymapPath(session.base)];
  if (src === undefined) return 'edit.err.noKeymaps';
  try {
    return readKeymap(src).layout === layout ? undefined : 'edit.err.layoutMismatch';
  } catch {
    return 'edit.err.noKeymaps';
  }
}

/**
 * Why a key cannot get this keycode, if it cannot: on the base layer, a combo that uses the key
 * follows it, so the new key must still be the only one of its kind there.
 */
export function keyProblem(session: Session, layer: number, index: number, keycode: string): MessageKey | undefined {
  // A ZMK combo is a set of positions, so only the binding matters.
  if (session.base.zmk) return zmkDoc(session) ? zmkKeyProblem(zmkDoc(session)!, keycode) : undefined;
  if (layer !== 0) return undefined;
  const src = keymapFileOf(session);
  if (!src) return undefined;
  const base = readKeymap(src).layers[0];
  const old = base[index];
  if (old === keycode || base.indexOf(old) !== index) return undefined;
  const combos = readCombos(src).filter((c) => c.keys.includes(old));
  if (combos.length === 0) return undefined;
  const others = base.filter((_, i) => i !== index);
  const breaks =
    TRANSPARENT_OR_NONE.has(keycode) || others.includes(keycode) || combos.some((c) => c.keys.includes(keycode));
  return breaks ? 'picker.err.comboWouldBreak' : undefined;
}

/** Why the keys at these positions cannot make a combo, if they cannot. */
export function comboProblem(session: Session, positions: number[]): MessageKey | undefined {
  if (positions.length < 2) return 'picker.err.comboTooFew';
  if (session.base.zmk) return undefined;
  const keymap = keymapFileOf(session);
  const base = keymap ? readKeymap(keymap).layers[0] : [];
  const keys = positions.map((p) => base[p]);
  // Combos name keycodes, so each key must be the only one of its kind on the base layer.
  const unique = keys.every((k) => k !== undefined && !TRANSPARENT_OR_NONE.has(k) && base.filter((b) => b === k).length === 1);
  return unique ? undefined : 'picker.err.comboNotUnique';
}

/** Why a combo cannot type this, if it cannot: a ZMK keymap must have a binding for it. */
export function comboOutputProblem(session: Session, keycode: string): MessageKey | undefined {
  const doc = zmkDoc(session);
  return doc ? zmkKeyProblem(doc, keycode) : undefined;
}

/**
 * The keymap's own keys for the key picker: keymap.c's custom keycodes, or, for ZMK, the keys
 * with no QMK keycode that the keymap uses (macros, custom behaviours), and output and Bluetooth keys.
 */
export function ownKeycodes(session: Session): string[] {
  const doc = zmkDoc(session);
  if (!doc) {
    const src = keymapFileOf(session);
    return src ? readCustomKeycodes(src) : [];
  }
  const used = [...doc.model.layers.flatMap((l) => l.keys), ...doc.model.combos.map((c) => c.output)].filter((k) => k.includes('ZMK_'));
  const bluetooth = used.some((k) => k.startsWith('ZMK_BT_'))
    ? [...[0, 1, 2, 3, 4].map((n) => `ZMK_BT_SEL_${n}`), 'ZMK_BT_NXT', 'ZMK_BT_PRV', 'ZMK_BT_CLR', 'ZMK_BT_CLR_ALL']
    : [];
  return [...new Set([...used, ...bluetooth, 'ZMK_OUT_TOG', 'ZMK_OUT_USB', 'ZMK_OUT_BLE'])];
}

/** Whether the ball's mode per layer can be changed: keymap.c names its scroll layers in KEYBALLER_SCROLL_LAYERS. */
export function ballModeEditable(session: Session): boolean {
  const src = session.base.files[keymapPath(session.base)];
  return src !== undefined && readScrollLayers(src) !== null;
}

/** views[keymap folder] in keyballer.json: layer names and ball modes. */
const viewPath = (base: SessionBase) => ['views', base.keymapDir];

function editJson(files: Record<string, string>, change: (doc: Json) => Json) {
  const before = files[CONFIG_JSON];
  const after = writeJson(change(readJson(before)));
  // Unchanged content keeps its text, even if it was written differently.
  if (writeJson(readJson(before)) !== after) files[CONFIG_JSON] = after;
}

/** Applies one keymap edit to the files. */
function applyKeymapEdit(base: SessionBase, files: Record<string, string>, e: Edit) {
  const path = keymapPath(base);
  const src = files[path];
  if (src === undefined) return;
  const baseLayer = () => readKeymap(files[path]).layers[0];
  switch (e.type) {
    case 'key': {
      if (e.layer === 0) {
        // Combos name base-layer keys; they follow the key at their position.
        const old = baseLayer()[e.index];
        readCombos(files[path]).forEach((c, i) => {
          if (c.keys.includes(old) && baseLayer().indexOf(old) === e.index) {
            files[path] = setCombo(files[path], i, { keys: c.keys.map((k) => (k === old ? e.keycode : k)), output: c.output });
          }
        });
      }
      files[path] = setKey(files[path], e.layer, e.index, e.keycode);
      return;
    }
    case 'comboAdd': {
      const first = readCombos(files[path]).length === 0;
      files[path] = addCombo(files[path], { keys: e.positions.map((p) => baseLayer()[p]), output: e.output });
      if (first) {
        files[rulesPath(base)] = setRule(files[rulesPath(base)] ?? '', 'COMBO_ENABLE', 'yes');
        files[configPath(base)] = setDefine(files[configPath(base)] ?? '', 'COMBO_ONLY_FROM_LAYER', '0');
      }
      return;
    }
    case 'comboSet': {
      const at = readCombos(files[path]).findIndex((c) => c.name === e.name);
      if (at >= 0) files[path] = setCombo(files[path], at, { keys: e.positions.map((p) => baseLayer()[p]), output: e.output });
      return;
    }
    case 'comboRemove': {
      const at = readCombos(files[path]).findIndex((c) => c.name === e.name);
      if (at >= 0) files[path] = removeCombo(files[path], at);
      return;
    }
    case 'layerAdd':
      files[path] = addLayer(files[path]);
      return;
    case 'layerRemove': {
      const removed = readKeymap(files[path]).layers.length - 1;
      files[path] = removeLastLayer(files[path]);
      const scroll = readScrollLayers(files[path]);
      if (scroll?.includes(removed)) files[path] = setScrollLayers(files[path], scroll.filter((l) => l !== removed));
      editJson(files, (doc) => {
        const names = getJson(doc, [...viewPath(base), 'layers']);
        let next = Array.isArray(names) && names.length > removed ? setJson(doc, [...viewPath(base), 'layers'], names.slice(0, removed)) : doc;
        if (getJson(next, [...viewPath(base), 'ball', String(removed)]) !== undefined) {
          next = setJson(next, [...viewPath(base), 'ball', String(removed)], undefined);
        }
        return next;
      });
      return;
    }
    case 'layerName':
      editJson(files, (doc) => {
        const names = getJson(doc, [...viewPath(base), 'layers']);
        const list: Json[] = Array.isArray(names) ? [...names] : [];
        while (list.length < e.layer) list.push(null);
        list[e.layer] = e.name;
        return setJson(doc, [...viewPath(base), 'layers'], list);
      });
      return;
    case 'ballMode': {
      // The label alone would make the screen and the firmware disagree.
      const scroll = readScrollLayers(files[path]);
      if (scroll === null) return;
      files[path] = setScrollLayers(files[path], e.mode === 'scroll' ? [...scroll, e.layer] : scroll.filter((l) => l !== e.layer));
      editJson(files, (doc) => {
        const fallback = getJson(doc, [...viewPath(base), 'ball', 'default']);
        return setJson(doc, [...viewPath(base), 'ball', String(e.layer)], e.mode === fallback ? undefined : e.mode);
      });
      return;
    }
  }
}

const filesCache = new WeakMap<Session, Record<string, string>>();

/**
 * The files as they would be saved: settings that differ from the saved ones, then each keymap
 * edit in order. An edit that no longer applies (its combo is gone after the repository moved
 * on) is skipped. Worked out once per session state.
 */
export function currentFiles(session: Session): Record<string, string> {
  const cached = filesCache.get(session);
  if (cached) return cached;
  const zmk = zmkBaseOf(session.base);
  if (zmk) {
    const files = { ...session.base.files, [zmk.path]: zmkDoc(session)!.src };
    filesCache.set(session, files);
    return files;
  }
  const saved = savedTrackball(session);
  const now = trackball(session);
  const files = { ...session.base.files };
  for (const k of SETTING_ORDER) if (now[k] !== saved[k]) SETTINGS[k].write(session.base, files, now[k]);
  for (const e of session.edits) {
    if (isSetting(e)) continue;
    const before = { ...files };
    try {
      applyKeymapEdit(session.base, files, e);
    } catch {
      Object.assign(files, before);
    }
  }
  filesCache.set(session, files);
  return files;
}

const docCache = new WeakMap<Session, ZmkDoc>();

/**
 * A ZMK session's keymap as it now stands: the model and the file with each change made in order.
 * A change that no longer applies (its combo is gone after the repository moved on) is skipped.
 */
function zmkDoc(session: Session): ZmkDoc | undefined {
  const base = zmkBaseOf(session.base);
  if (!base) return undefined;
  const cached = docCache.get(session);
  if (cached) return cached;
  let doc: ZmkDoc = { model: base.model, src: session.base.files[base.path] };
  for (const e of session.edits) {
    if (isSetting(e) || e.type === 'ballMode') continue;
    try {
      doc = applyZmkEdit(doc, e as ZmkEdit);
    } catch {
      // Skipped, as currentFiles skips a QMK change that no longer applies.
    }
  }
  docCache.set(session, doc);
  return doc;
}

/** The starting point after saving: the saved files, and for ZMK what they now mean. */
export function savedBase(session: Session, commit: string): SessionBase {
  const files = currentFiles(session);
  const zmk = zmkBaseOf(session.base);
  const doc = zmkDoc(session);
  return { ...session.base, commit, files, ...(zmk && doc ? { zmk: { base: { path: zmk.path, model: doc.model } } } : {}) };
}

/** The same changes on newer files: for when the repository moved on before saving. */
export function rebase(session: Session, base: SessionBase): Session {
  return { base, edits: session.edits, undone: [] };
}

/** A layer's ball mode in keyballer.json's views[...].ball: its own entry, or the default. */
function ballModeOf(ball: Json | undefined, n: number): string | null {
  const mode = ball instanceof Map ? (ball.get(String(n)) ?? ball.get('default')) : undefined;
  return typeof mode === 'string' ? mode : null;
}

const englishList = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

/** A keycode as a commit message says it: what the key prints on a US layout, or as written. */
const said = (code: string) => basicLegend(code, 'us') ?? code.replace(/^KC_/, '');

function layerNames(base: SessionBase, files: Record<string, string>): (string | null)[] {
  const names = getJson(readJson(files[CONFIG_JSON]), [...viewPath(base), 'layers']);
  return Array.isArray(names) ? names.map((n) => (typeof n === 'string' ? n : null)) : [];
}

interface Changes {
  settings: Change[];
  keys: KeyChange[];
  combos: ComboChange[];
  layers: LayerChange[];
}

function draftMessage(c: Changes, base: SessionBase, names: (string | null)[]): string {
  const layerName = (n: number) => names[n] ?? `layer ${n}`;
  const clauses: string[] = [];
  if (c.settings.length > 0) {
    clauses.push(`set ${englishList(c.settings.map((s) => SETTINGS[s.setting].clause(s.to, base.buildId)))}`);
  }
  if (c.keys.length === 1) {
    const [k] = c.keys;
    clauses.push(`change ${said(k.from)} to ${said(k.to)} on ${layerName(k.layer)}`);
  } else if (c.keys.length > 1) {
    const layers = [...new Set(c.keys.map((k) => k.layer))].sort((a, b) => a - b);
    clauses.push(`change ${c.keys.length} keys on ${englishList(layers.map(layerName))}`);
  }
  for (const combo of c.combos) {
    if (combo.change === 'changed' && combo.was === combo.output) clauses.push(`change the keys of the combo for ${said(combo.output)}`);
    else if (combo.change === 'changed') clauses.push(`make the combo for ${said(combo.was)} type ${said(combo.output)}`);
    else if (combo.change === 'added') clauses.push(`add a combo for ${said(combo.output)}`);
    else clauses.push(`remove the combo for ${said(combo.output)}`);
  }
  for (const l of c.layers) {
    if (l.change === 'renamed') clauses.push(`name layer ${l.layer} ${l.name}`);
    else if (l.change === 'ball') clauses.push(`make the ball ${l.mode} on ${layerName(l.layer)}`);
    else clauses.push(`${l.change === 'added' ? 'add' : 'remove'} layer ${l.layer}`);
  }
  const text = englishList(clauses);
  return text && text[0].toUpperCase() + text.slice(1);
}

function keymapChanges(base: SessionBase, before: Record<string, string>, after: Record<string, string>) {
  try {
    return readKeymapChanges(base, before, after);
  } catch {
    // A keymap.c that cannot be read has no key changes to list (keymapProblem says why).
    return { keys: [], combos: [], layers: [] };
  }
}

function readKeymapChanges(base: SessionBase, before: Record<string, string>, after: Record<string, string>) {
  const path = keymapPath(base);
  if (before[path] === undefined || after[path] === undefined) return { keys: [], combos: [], layers: [] };
  const was = readKeymap(before[path]);
  const now = readKeymap(after[path]);
  const keys: KeyChange[] = [];
  for (let layer = 0; layer < Math.min(was.layers.length, now.layers.length); layer++) {
    now.layers[layer].forEach((to, index) => {
      const from = was.layers[layer][index];
      if (from !== to) keys.push({ layer, index, from, to });
    });
  }
  // Combos are compared by their positions on the base layer: one that follows its key is the same combo.
  const positions = (keys: string[], layer: string[]) => keys.map((k) => layer.indexOf(k)).join();
  const wasCombos = readCombos(before[path]);
  const nowCombos = readCombos(after[path]);
  const combos: ComboChange[] = [];
  for (const c of nowCombos) {
    const old = wasCombos.find((w) => w.name === c.name);
    if (!old) combos.push({ change: 'added', keys: c.keys, output: c.output });
    else if (old.output !== c.output || positions(old.keys, was.layers[0]) !== positions(c.keys, now.layers[0])) {
      combos.push({ change: 'changed', keys: c.keys, output: c.output, was: old.output });
    }
  }
  for (const w of wasCombos) if (!nowCombos.some((c) => c.name === w.name)) combos.push({ change: 'removed', keys: w.keys, output: w.output });
  const layers: LayerChange[] = [];
  for (let n = was.layers.length; n < now.layers.length; n++) layers.push({ change: 'added', layer: n });
  for (let n = now.layers.length; n < was.layers.length; n++) layers.push({ change: 'removed', layer: n });
  return { keys, combos, layers };
}

export function review(session: Session): Review {
  const zmk = zmkBaseOf(session.base);
  if (zmk) return zmkReview(session, zmk);
  const { base } = session;
  const saved = savedTrackball(session);
  const now = trackball(session);
  const changes = SETTING_ORDER.filter((k) => now[k] !== saved[k]).map((k) => ({ setting: k, from: saved[k], to: now[k] }));
  const after = currentFiles(session);
  const { keys, combos, layers } = keymapChanges(base, base.files, after);
  const wasNames = layerNames(base, base.files);
  const nowNames = layerNames(base, after);
  let layerCount = nowNames.length;
  try {
    if (after[keymapPath(base)]) layerCount = readKeymap(after[keymapPath(base)]).layers.length;
  } catch {
    // Unreadable keymap.c: keymapProblem says why.
  }
  for (let n = 0; n < Math.min(layerCount, Math.max(nowNames.length, wasNames.length)); n++) {
    const name = nowNames[n];
    if (name && name !== wasNames[n]) layers.push({ change: 'renamed', layer: n, name });
  }
  const ballWas = getJson(readJson(base.files[CONFIG_JSON]), [...viewPath(base), 'ball']);
  const ballNow = getJson(readJson(after[CONFIG_JSON]), [...viewPath(base), 'ball']);
  const touched = [...new Set(session.edits.flatMap((e) => (e.type === 'ballMode' ? [e.layer] : [])))].sort((a, b) => a - b);
  for (const n of touched) {
    const mode = ballModeOf(ballNow, n);
    if (mode !== ballModeOf(ballWas, n) && (mode === 'cursor' || mode === 'scroll')) layers.push({ change: 'ball', layer: n, mode });
  }
  const files = Object.keys(after)
    .filter((path) => after[path] !== base.files[path])
    .map((path) => ({ path, diff: unifiedDiff(base.files[path] ?? '', after[path]) }));
  const message = draftMessage({ settings: changes, keys, combos, layers }, base, nowNames);
  return { changes, keys, combos, layers, files, message };
}

/** What a ZMK session changes: the model before and after, and the .keymap file's diff. */
function zmkReview(session: Session, zmk: ZmkBase): Review {
  const was = zmk.model;
  const now = zmkDoc(session)!.model;
  const keys: KeyChange[] = [];
  for (let layer = 0; layer < Math.min(was.layers.length, now.layers.length); layer++) {
    now.layers[layer].keys.forEach((to, index) => {
      const from = was.layers[layer].keys[index];
      if (from !== to) keys.push({ layer, index, from, to });
    });
  }
  const keysAt = (model: ZmkModel, positions: number[]) => positions.map((p) => model.layers[0]?.keys[p] ?? 'KC_NO');
  const combos: ComboChange[] = [];
  for (const c of now.combos) {
    const old = was.combos.find((w) => w.name === c.name);
    if (!old) combos.push({ change: 'added', keys: keysAt(now, c.positions), output: c.output });
    else if (old.output !== c.output || old.positions.join() !== c.positions.join()) {
      combos.push({ change: 'changed', keys: keysAt(now, c.positions), output: c.output, was: old.output });
    }
  }
  for (const w of was.combos) if (!now.combos.some((c) => c.name === w.name)) combos.push({ change: 'removed', keys: keysAt(was, w.positions), output: w.output });
  const layers: LayerChange[] = [];
  for (let n = was.layers.length; n < now.layers.length; n++) layers.push({ change: 'added', layer: n });
  for (let n = now.layers.length; n < was.layers.length; n++) layers.push({ change: 'removed', layer: n });
  for (let n = 0; n < Math.min(was.layers.length, now.layers.length); n++) {
    const name = now.layers[n].name;
    if (name && name !== was.layers[n].name) layers.push({ change: 'renamed', layer: n, name });
  }
  const before = session.base.files[zmk.path];
  const after = zmkDoc(session)!.src;
  const files = after === before ? [] : [{ path: zmk.path, diff: unifiedDiff(before, after) }];
  const names = now.layers.map((l) => l.name);
  const message = draftMessage({ settings: [], keys, combos, layers }, session.base, names);
  return { changes: [], keys, combos, layers, files, message };
}

/**
 * The built view with the session's keymap over it: the keys, layers, names, ball modes and combos
 * as they now stand; the board's shape, aliases and code notes stay those of the build.
 */
export function editedView(view: ViewFile, session: Session | null): ViewFile {
  if (!session) return view;
  if (session.base.zmk) {
    const doc = zmkDoc(session);
    if (!doc) return view;
    const codes = [...doc.model.layers.flatMap((l) => l.keys), ...doc.model.combos.map((c) => c.output)];
    const labels = { ...view.labels };
    for (const code of codes) {
      const label = labels[code] ? undefined : zmkLabel(code);
      if (label) labels[code] = label;
    }
    return {
      ...view,
      labels,
      layers: doc.model.layers.map((l) => ({ name: l.name, ball: null, keys: l.keys })),
      combos: doc.model.combos.map((c, i) => ({
        name: c.name,
        keys: c.positions.map((p) => doc.model.layers[0]?.keys[p] ?? 'KC_NO'),
        positions: c.positions,
        output: c.output,
        line: view.combos.find((v) => v.name === c.name)?.line ?? view.combos.length + i + 1,
      })),
    };
  }
  const files = currentFiles(session);
  const src = files[keymapPath(session.base)];
  if (src === undefined || keymapProblem(session, view.layout)) return view;
  const { layers } = readKeymap(src);
  const json = readJson(files[CONFIG_JSON]);
  const names = layerNames(session.base, files);
  const ball = getJson(json, [...viewPath(session.base), 'ball']);
  const modeOf = (n: number) => ballModeOf(ball, n) ?? view.layers[n]?.ball ?? null;
  const combos = readCombos(src).map((c) => {
    const positions = c.keys.map((k) => {
      const at = layers[0].indexOf(k);
      return at < 0 ? null : at;
    });
    const same = view.combos.find((v) => v.output === c.output && v.positions.join() === positions.join());
    return { ...(same ?? { keys: c.keys, positions, output: c.output, line: 0 }), name: c.name };
  });
  return {
    ...view,
    layers: layers.map((keys, n) => ({ name: names[n] ?? view.layers[n]?.name ?? null, ball: modeOf(n), keys })),
    combos,
  };
}

// ---- line diff ------------------------------------------------------------------

/** A unified diff of two texts, three lines of context, without file headers. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = before.split('\n');
  const b = after.split('\n');
  // Longest common subsequence table, from the end.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  type Line = { op: ' ' | '-' | '+'; text: string; ai: number; bi: number };
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    // Removed lines come before the lines that replace them.
    if (i < a.length && j < b.length && a[i] === b[j]) lines.push({ op: ' ', text: a[i++], ai: i, bi: ++j });
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) lines.push({ op: '-', text: a[i++], ai: i, bi: j });
    else lines.push({ op: '+', text: b[j++], ai: i, bi: j });
  }
  // Group changed lines with their context into hunks.
  const out: string[] = [];
  let k = 0;
  while (k < lines.length) {
    if (lines[k].op === ' ') {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    while (end < lines.length) {
      if (lines[end].op !== ' ') {
        end++;
        continue;
      }
      let run = end;
      while (run < lines.length && lines[run].op === ' ') run++;
      if (run === lines.length || run - end > context * 2) {
        end = Math.min(lines.length, end + context);
        break;
      }
      end = run;
    }
    const hunk = lines.slice(start, end);
    const oldStart = hunk.find((l) => l.op !== '+')?.ai ?? 0;
    const newStart = hunk.find((l) => l.op !== '-')?.bi ?? 0;
    const oldLines = hunk.filter((l) => l.op !== '+').length;
    const newLines = hunk.filter((l) => l.op !== '-').length;
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...hunk.map((l) => `${l.op}${l.text}`));
    k = end;
  }
  return out.join('\n');
}
