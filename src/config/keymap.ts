// keymap.c's data parts, read and edited as text: the layer arrays in
// keymaps[]. Every edit changes as little text as possible, so hand-written
// code, comments and alignment around it stay as they were. See
// docs/plans/keymap-editor.md, "The keymap source module".

import { LocalizedError } from '../i18n/core';
import { readDefine, setDefine } from './source';

export interface Keymap {
  /** The layout macro the layers use, such as LAYOUT_universal. */
  layout: string;
  /** Each layer's keys as written in the file, in layout order. */
  layers: string[][];
}

/** One argument of a LAYOUT_x(...) call. */
interface Arg {
  text: string;
  /** Where the text starts and ends. */
  start: number;
  end: number;
  /** Where the separator after it is: a comma, or the closing parenthesis for the last key. */
  separator: number;
  lastInLayer: boolean;
}

interface Layer {
  layout: string;
  args: Arg[];
  /** Where the entry `[n] = LAYOUT_x(...)` starts, and its parentheses. */
  start: number;
  open: number;
  close: number;
  /** Just after the entry: after the comma that follows it, if there is one. */
  end: number;
}

/** Comments and string literals replaced by spaces, keeping every offset and newline. */
function blankCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    let end = i;
    if (two === '//') {
      end = src.indexOf('\n', i);
      if (end < 0) end = src.length;
    } else if (two === '/*') {
      end = src.indexOf('*/', i + 2);
      end = end < 0 ? src.length : end + 2;
    } else if (src[i] === '"' || src[i] === "'") {
      const quote = src[i];
      end = i + 1;
      while (end < src.length && src[end] !== quote && src[end] !== '\n') end += src[end] === '\\' ? 2 : 1;
      end = Math.min(src.length, end + 1);
    }
    if (end > i) {
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += src[i++];
    }
  }
  return out;
}

/** The index of the bracket that closes the one at `open`. */
function closing(s: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch in pairs) stack.push(pairs[ch]);
    else if (ch === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The arguments between the parentheses at `open` and `close`, split at top-level commas. */
function argsOf(s: string, src: string, open: number, close: number): Arg[] {
  const args: Arg[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i <= close; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if ((ch === ')' || ch === ']' || ch === '}') && i !== close) depth--;
    else if ((ch === ',' && depth === 0) || i === close) {
      const part = s.slice(from, i);
      const lead = part.length - part.trimStart().length;
      const text = part.trim();
      if (text !== '') {
        const start = from + lead;
        args.push({ text: src.slice(start, start + text.length), start, end: start + text.length, separator: i, lastInLayer: i === close });
      }
      from = i + 1;
    }
  }
  return args;
}

/** `keymaps[][MATRIX_ROWS][MATRIX_COLS] = {`. */
const KEYMAPS_ARRAY = /keymaps\s*\[\s*\]\s*\[[^\]]*\]\s*\[[^\]]*\]\s*=\s*\{/;

function layersOf(src: string): Layer[] {
  const s = blankCommentsAndStrings(src);
  const array = KEYMAPS_ARRAY.exec(s);
  if (!array) throw new LocalizedError('edit.err.noKeymaps');
  const open = array.index + array[0].length - 1;
  const close = closing(s, open);
  if (close < 0) throw new LocalizedError('edit.err.noKeymaps');
  const layers: Layer[] = [];
  const entry = /\[\s*\w+\s*\]\s*=\s*(LAYOUT\w*)\s*\(/g;
  entry.lastIndex = open;
  for (let m = entry.exec(s); m && m.index < close; m = entry.exec(s)) {
    const paren = m.index + m[0].length - 1;
    const end = closing(s, paren);
    if (end < 0) throw new LocalizedError('edit.err.noKeymaps');
    const comma = /^\s*,/.exec(s.slice(end + 1));
    layers.push({
      layout: m[1],
      args: argsOf(s, src, paren, end),
      start: m.index,
      open: paren,
      close: end,
      end: comma ? end + 1 + comma[0].length : end + 1,
    });
    entry.lastIndex = end;
  }
  if (layers.length === 0) throw new LocalizedError('edit.err.noKeymaps');
  return layers;
}

export function readKeymap(src: string): Keymap {
  const layers = layersOf(src);
  return { layout: layers[0].layout, layers: layers.map((l) => l.args.map((a) => a.text)) };
}

/**
 * Sets one key. The new text takes the old one's place; when a comma follows, the spaces before it
 * are adjusted so that the comma stays in its column, keeping at least as much space as there was
 * (one space, or none when the key touched its comma). A key that does not fit moves the rest of
 * its line only.
 */
export function setKey(src: string, layer: number, index: number, keycode: string): string {
  const args = layersOf(src)[layer]?.args;
  const arg = args?.[index];
  if (!args || !arg) throw new LocalizedError('edit.err.noKey', { layer, index });
  if (arg.text === keycode) return src;
  return splice(src, [keyEdit(src, arg, keycode, args[index + 1])]);
}

/**
 * The text edit that puts a keycode in an argument's place, keeping the next column where it was.
 * Columns padded before the comma (`KC_A    ,`) give or take spaces there; columns padded after
 * it (`KC_A,    KC_B`) do so after the comma. At least the spaces that were there stay (one, or
 * none); a key that does not fit moves the rest of its line only. Anything other than spaces
 * between the key and its comma (a comment) is left as it is.
 */
function keyEdit(src: string, arg: Arg, keycode: string, next?: Arg): { start: number; end: number; text: string } {
  const trail = src.slice(arg.end, arg.separator);
  if (arg.lastInLayer || !/^[ \t]*$/.test(trail)) return { start: arg.start, end: arg.end, text: keycode };
  const delta = keycode.length - arg.text.length;
  const lead = next ? src.slice(arg.separator + 1, next.start) : null;
  if (next && lead !== null && trail.length <= 1 && /^[ \t]{2,}$/.test(lead)) {
    const pad = Math.max(1, lead.length - delta);
    return { start: arg.start, end: next.start, text: `${keycode}${trail},${' '.repeat(pad)}` };
  }
  const pad = Math.max(trail.length > 0 ? 1 : 0, trail.length - delta);
  return { start: arg.start, end: arg.separator, text: keycode + ' '.repeat(pad) };
}

const TRANSPARENT = '_______';

/** Adds a layer after the last one: every key transparent, in the last layer's rows and columns. */
export function addLayer(src: string): string {
  const layers = layersOf(src);
  const last = layers[layers.length - 1];
  const indent = src.slice(lineStartAt(src, last.start), last.start);
  // The last layer's body with every key made transparent, the way setKey would.
  const edits = last.args.map((a, i) => keyEdit(src, a, TRANSPARENT, last.args[i + 1]));
  const body = splice(src.slice(0, last.close), edits).slice(last.open + 1);
  const hadComma = src.slice(last.close + 1, last.end).includes(',');
  const entry = `${hadComma ? '' : ','}\n\n${indent}[${layers.length}] = ${last.layout}(${body})${hadComma ? ',' : ''}`;
  return src.slice(0, last.end) + entry + src.slice(last.end);
}

/** Removes the last layer, with the blank lines and comments between it and the layer before. */
export function removeLastLayer(src: string): string {
  const layers = layersOf(src);
  if (layers.length < 2) throw new LocalizedError('edit.err.lastLayer');
  const before = layers[layers.length - 2];
  const last = layers[layers.length - 1];
  return src.slice(0, before.end) + src.slice(last.end);
}

// ---- the trackball's scroll layers -----------------------------------------------

const SCROLL_LAYERS = 'KEYBALLER_SCROLL_LAYERS';

/** The layers where the ball scrolls, from `#define KEYBALLER_SCROLL_LAYERS`; null without it. */
export function readScrollLayers(src: string): number[] | null {
  const value = readDefine(blankCommentsAndStrings(src), SCROLL_LAYERS);
  if (value === undefined) return null;
  // Layers written as names (1 << _MOUSE) cannot be read here, so they are left to the code.
  if (/[A-Za-z_]/.test(value.replace(/\d+U?L?/g, ''))) return null;
  return [...value.matchAll(/1U?L?\s*<<\s*(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
}

export function setScrollLayers(src: string, layers: number[]): string {
  const now = readScrollLayers(src);
  const sorted = [...new Set(layers)].sort((a, b) => a - b);
  if (now && now.join() === sorted.join()) return src;
  const bits = sorted.map((n) => `(1 << ${n})`);
  const value = bits.length === 0 ? '0' : bits.length === 1 ? bits[0] : `(${bits.join(' | ')})`;
  return setDefine(src, SCROLL_LAYERS, value);
}

// ---- combos ------------------------------------------------------------------------

export interface Combo {
  /** The name of the key array, such as combo_comma. */
  name: string;
  /** The base-layer keycodes pressed together. */
  keys: string[];
  output: string;
}

interface ComboArray {
  name: string;
  keys: string[];
  /** The line holding the array, newline included. */
  lineStart: number;
  lineEnd: number;
  /** The braces of its initializer. */
  open: number;
  close: number;
}

interface ComboEntry {
  name: string;
  output: string;
  outputStart: number;
  outputEnd: number;
  /** The `COMBO(...)` call itself. */
  start: number;
  end: number;
  lineStart: number;
  lineEnd: number;
  indent: string;
}

interface ComboSection {
  arrays: ComboArray[];
  entries: ComboEntry[];
  /** Where the key_combos[] declaration starts and its initializer's closing brace is, if there is one. */
  listStart: number | null;
  listClose: number | null;
}

const lineStartAt = (s: string, i: number) => s.lastIndexOf('\n', i - 1) + 1;
function lineEndAt(s: string, i: number): number {
  const n = s.indexOf('\n', i);
  return n < 0 ? s.length : n + 1;
}

function combosOf(src: string): ComboSection {
  const s = blankCommentsAndStrings(src);
  const arrays: ComboArray[] = [];
  const arrayRe = /const\s+uint16_t\s+PROGMEM\s+(\w+)\s*\[\s*\]\s*=\s*\{/g;
  for (let m = arrayRe.exec(s); m; m = arrayRe.exec(s)) {
    const open = m.index + m[0].length - 1;
    const close = closing(s, open);
    if (close < 0) continue;
    const keys = argsOf(s, src, open, close)
      .map((a) => a.text)
      .filter((k) => k !== 'COMBO_END');
    arrays.push({ name: m[1], keys, lineStart: lineStartAt(s, m.index), lineEnd: lineEndAt(s, close), open, close });
  }
  const list = /combo_t\s+key_combos\s*\[[^\]]*\]\s*=\s*\{/.exec(s);
  const entries: ComboEntry[] = [];
  let listClose: number | null = null;
  const listStart = list ? lineStartAt(s, list.index) : null;
  if (list) {
    const open = list.index + list[0].length - 1;
    listClose = closing(s, open);
    const entryRe = /\bCOMBO\s*\(/g;
    entryRe.lastIndex = open;
    for (let m = entryRe.exec(s); m && listClose !== null && m.index < listClose; m = entryRe.exec(s)) {
      const paren = m.index + m[0].length - 1;
      const close = closing(s, paren);
      const args = argsOf(s, src, paren, close);
      if (args.length !== 2) continue;
      const lineStart = lineStartAt(s, m.index);
      entries.push({
        name: args[0].text,
        output: args[1].text,
        outputStart: args[1].start,
        outputEnd: args[1].end,
        start: m.index,
        end: close + 1,
        lineStart,
        lineEnd: lineEndAt(s, paren),
        indent: /^[ \t]*/.exec(s.slice(lineStart))![0],
      });
    }
  }
  return { arrays, entries, listStart, listClose };
}

/** The combos of key_combos[], in order, with the keys of their arrays. */
export function readCombos(src: string): Combo[] {
  const { arrays, entries } = combosOf(src);
  return entries.map((e) => ({ name: e.name, keys: arrays.find((a) => a.name === e.name)?.keys ?? [], output: e.output }));
}

/** Text edits applied from the end, so earlier offsets stay valid. */
function splice(src: string, edits: { start: number; end: number; text: string }[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), src);
}

const arrayBody = (keys: string[]) => `{${[...keys, 'COMBO_END'].join(', ')}}`;

/** Changes a combo's keys and output in place; its name stays. */
export function setCombo(src: string, index: number, combo: { keys: string[]; output: string }): string {
  const { arrays, entries } = combosOf(src);
  const entry = entries[index];
  const array = entry && arrays.find((a) => a.name === entry.name);
  if (!entry || !array) throw new LocalizedError('edit.err.noCombo', { index });
  return splice(src, [
    { start: array.open, end: array.close + 1, text: arrayBody(combo.keys) },
    { start: entry.outputStart, end: entry.outputEnd, text: combo.output },
  ]);
}

/** Adds a combo after the last one; the first combo of a keymap gets its own block after keymaps[]. */
export function addCombo(src: string, combo: { keys: string[]; output: string }): string {
  const { arrays, entries, listStart, listClose } = combosOf(src);
  const taken = new Set(arrays.map((a) => a.name));
  let n = entries.length + 1;
  while (taken.has(`combo_${n}`)) n++;
  const name = `combo_${n}`;
  const arrayLine = `const uint16_t PROGMEM ${name}[] = ${arrayBody(combo.keys)};\n`;

  if (listClose === null) {
    // After keymaps[] (and the clang-format line that may close it).
    const s = blankCommentsAndStrings(src);
    const keymaps = KEYMAPS_ARRAY.exec(s);
    if (!keymaps) throw new LocalizedError('edit.err.noKeymaps');
    let at = lineEndAt(src, closing(s, keymaps.index + keymaps[0].length - 1));
    if (/^\/\/ clang-format on[^\n]*\n/.test(src.slice(at))) at = lineEndAt(src, at);
    const block = `\n#ifdef COMBO_ENABLE\n${arrayLine}\ncombo_t key_combos[] = {\n    COMBO(${name}, ${combo.output}),\n};\n#endif\n`;
    return src.slice(0, at) + block + src.slice(at);
  }

  // The new array goes after the last one, or before key_combos[] when there is none yet.
  const lastArray = arrays.filter((a) => entries.some((e) => e.name === a.name)).at(-1);
  const arrayAt = lastArray ? lastArray.lineEnd : (listStart ?? 0);
  const lastEntry = entries.at(-1);
  const entryLine = `${lastEntry?.indent ?? '    '}COMBO(${name}, ${combo.output}),\n`;
  // The new entry goes after the last one; in an empty list, before its closing brace.
  const closeLine = lineStartAt(src, listClose);
  const entry = lastEntry
    ? { start: lastEntry.lineEnd, end: lastEntry.lineEnd, text: entryLine }
    : closeLine > (listStart ?? 0)
      ? { start: closeLine, end: closeLine, text: entryLine }
      : { start: listClose, end: listClose, text: `\n${entryLine}` };
  return splice(src, [{ start: arrayAt, end: arrayAt, text: arrayLine }, entry]);
}

/** Removes a combo: its entry in key_combos[], and its key array when nothing else uses it. */
export function removeCombo(src: string, index: number): string {
  const { arrays, entries } = combosOf(src);
  const entry = entries[index];
  if (!entry) throw new LocalizedError('edit.err.noCombo', { index });
  // A line holding only this entry goes; otherwise only the entry and the comma after it.
  const line = src.slice(entry.lineStart, entry.lineEnd);
  const alone = line.trim().replace(/,$/, '') === src.slice(entry.start, entry.end);
  const after = /^\s*,\s*/.exec(src.slice(entry.end));
  const edits = alone
    ? [{ start: entry.lineStart, end: entry.lineEnd, text: '' }]
    : [{ start: entry.start, end: entry.end + (after ? after[0].length : 0), text: '' }];
  const array = arrays.find((a) => a.name === entry.name);
  const shared = entries.filter((e) => e.name === entry.name).length > 1;
  if (array && !shared) edits.push({ start: array.lineStart, end: array.lineEnd, text: '' });
  return splice(src, edits);
}

/** The keymap's own keycodes: the names in `enum custom_keycodes { ... }`. */
export function readCustomKeycodes(src: string): string[] {
  const s = blankCommentsAndStrings(src);
  const m = /enum\s+custom_keycodes\s*\{/.exec(s);
  if (!m) return [];
  const open = m.index + m[0].length - 1;
  const close = closing(s, open);
  if (close < 0) return [];
  return s
    .slice(open + 1, close)
    .split(',')
    .map((entry) => /^\s*([A-Za-z_]\w*)/.exec(entry)?.[1])
    .filter((name): name is string => !!name);
}
