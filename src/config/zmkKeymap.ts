// Reading and changing a ZMK .keymap file as text: its layers' bindings, its combos and its layer
// names, for the keymap editor (docs/plans/zmk.md, phase 4). Only the devicetree structure is read
// here; what each binding means comes from the build (src/edit/zmk.ts). Comments, strings and
// preprocessor lines are masked first, so that braces and bindings inside them are never taken
// for structure. Every change leaves the rest of the file as it was written.

import { LocalizedError } from '../i18n/core';

/** The file cannot be read the way the editor needs (a macro, an unclosed node...). */
export class ZmkSourceError extends Error {}

interface Prop {
  name: string;
  /** From the property's name to its `;`, inclusive. */
  start: number;
  end: number;
  /** The value after `=`, trimmed; equal to end - 1 for a property without a value. */
  valueStart: number;
  valueEnd: number;
}

interface Node {
  name: string;
  labels: string[];
  /** Where the node's first label or name starts, its `{`, its `}`, and just after its `;`. */
  start: number;
  open: number;
  close: number;
  end: number;
  props: Prop[];
  children: Node[];
}

export interface Binding {
  /** The behaviour referred to, without `&`: `kp`, `lt_to_layer_0`. */
  ref: string;
  start: number;
  end: number;
  text: string;
}

export interface SourceLayer {
  node: string;
  status: string | null;
  bindings: Binding[];
}

export interface SourceCombo {
  node: string;
  positions: number[];
  bindings: Binding[];
  layers: number[] | null;
}

export interface ZmkSource {
  layers: SourceLayer[];
  combos: SourceCombo[];
}

// ---- masking and parsing --------------------------------------------------------------

/**
 * The text with comments and preprocessor lines blanked and string contents replaced, keeping
 * every offset and line break, so that structure can be found in it and values read from the text.
 */
export function mask(src: string): string {
  const out = src.split('');
  let i = 0;
  let lineStart = true;
  while (i < src.length) {
    const c = src[i];
    if (lineStart && /[ \t]/.test(c)) {
      i++;
      continue;
    }
    if (lineStart && c === '#') {
      // A preprocessor line, with its continuations.
      while (i < src.length && !(src[i] === '\n' && src[i - 1] !== '\\')) {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    lineStart = c === '\n';
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close < 0) throw new ZmkSourceError('an unclosed comment');
      for (let j = i; j < close + 2; j++) if (src[j] !== '\n') out[j] = ' ';
      i = close + 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw new ZmkSourceError('a string across lines');
        out[j] = '_';
        if (src[j] === '\\') out[++j] = '_';
        j++;
      }
      if (j >= src.length) throw new ZmkSourceError('an unclosed string');
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

type Token = { text: string; start: number; end: number };

/** Tokens of masked text: punctuation, `<…>` cell lists, `"…"` strings, `[…]` bytes and words. */
function tokenize(m: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < m.length) {
    const c = m[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if ('{};=:,'.includes(c)) {
      i++;
    } else if (c === '<') {
      // Parentheses may hold shifts such as (1 << 2); only a > outside them closes the list.
      let depth = 0;
      i++;
      while (i < m.length && !(m[i] === '>' && depth === 0)) {
        if (m[i] === '(') depth++;
        else if (m[i] === ')') depth--;
        else if (m[i] === ';' || m[i] === '{' || m[i] === '}') throw new ZmkSourceError('an unclosed cell list');
        i++;
      }
      if (i >= m.length) throw new ZmkSourceError('an unclosed cell list');
      i++;
    } else if (c === '"') {
      i = m.indexOf('"', i + 1) + 1;
    } else if (c === '[') {
      const close = m.indexOf(']', i);
      if (close < 0) throw new ZmkSourceError('an unclosed byte string');
      i = close + 1;
    } else {
      while (i < m.length && !/[\s{};=:,<"[]/.test(m[i])) i++;
    }
    tokens.push({ text: m.slice(start, i), start, end: i });
  }
  return tokens;
}

/** The devicetree's nodes, top-level first; root blocks (`/ {`) and `&label {` blocks included. */
function parse(m: string): Node[] {
  const tokens = tokenize(m);
  let at = 0;
  const expect = (text: string) => {
    if (tokens[at]?.text !== text) throw new ZmkSourceError(`expected ${text}`);
    return tokens[at++];
  };
  const body = (closing: boolean): { props: Prop[]; children: Node[] } => {
    const props: Prop[] = [];
    const children: Node[] = [];
    while (at < tokens.length && !(closing && tokens[at].text === '}')) {
      const first = tokens[at];
      // Directives such as /dts-v1/; and /omit-if-no-ref/ before a node.
      if (/^\/[a-z-]+\/$/.test(first.text)) {
        at++;
        if (tokens[at]?.text === ';') at++;
        else if (first.text.startsWith('/delete-')) {
          while (at < tokens.length && tokens[at].text !== ';') at++;
          at++;
        }
        continue;
      }
      const labels: string[] = [];
      while (tokens[at + 1]?.text === ':') {
        labels.push(tokens[at].text);
        at += 2;
      }
      const name = tokens[at++];
      if (!name || '{};=:,'.includes(name.text)) throw new ZmkSourceError('expected a name');
      const next = tokens[at];
      if (next?.text === '{') {
        at++;
        const inner = body(true);
        const close = expect('}');
        const semi = expect(';');
        children.push({ name: name.text, labels, start: first.start, open: next.start, close: close.start, end: semi.end, ...inner });
      } else if (next?.text === '=') {
        at++;
        const valueStart = tokens[at]?.start ?? next.end;
        while (at < tokens.length && tokens[at].text !== ';') {
          if (tokens[at].text === '{' || tokens[at].text === '}') throw new ZmkSourceError('a brace in a value');
          at++;
        }
        const semi = expect(';');
        props.push({ name: name.text, start: name.start, end: semi.end, valueStart, valueEnd: tokens[at - 2].end });
      } else if (next?.text === ';') {
        at++;
        props.push({ name: name.text, start: name.start, end: next.end, valueStart: next.start, valueEnd: next.start });
      } else {
        throw new ZmkSourceError(`unexpected ${next?.text ?? 'end'} after ${name.text}`);
      }
    }
    return { props, children };
  };
  return body(false).children;
}

function* walk(nodes: Node[]): Generator<Node> {
  for (const n of nodes) {
    yield n;
    yield* walk(n.children);
  }
}

const prop = (node: Node, name: string) => node.props.find((p) => p.name === name);

/** A string property's value, unescaped. */
function stringOf(src: string, p: Prop | undefined): string | null {
  if (!p) return null;
  const value = src.slice(p.valueStart, p.valueEnd);
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}

/** The nodes whose `compatible` is this one. */
function compatible(src: string, nodes: Node[], value: string): Node[] {
  return [...walk(nodes)].filter((n) => stringOf(src, prop(n, 'compatible')) === value);
}

/** The bindings in a property's cell lists: each `&ref` with the parameters after it. */
function bindingsOf(src: string, m: string, p: Prop | undefined): Binding[] {
  if (!p) return [];
  const out: Binding[] = [];
  for (const cells of tokenize(m.slice(p.valueStart, p.valueEnd))) {
    if (cells.text === ',') continue;
    if (!cells.text.startsWith('<')) throw new ZmkSourceError('bindings that are not a cell list');
    // Split at spaces outside parentheses: &kp LS(LG(S)) is a reference and one parameter.
    const base = p.valueStart + cells.start + 1;
    const inner = m.slice(base, p.valueStart + cells.end - 1);
    const words: Token[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i <= inner.length; i++) {
      const c = inner[i] ?? ' ';
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (/\s/.test(c) && depth === 0) {
        if (start >= 0) words.push({ text: inner.slice(start, i), start: base + start, end: base + i });
        start = -1;
      } else if (start < 0) start = i;
    }
    for (const w of words) {
      if (w.text.startsWith('&')) {
        if (!/^&[A-Za-z_][A-Za-z0-9_]*$/.test(w.text)) throw new ZmkSourceError(`a reference Keyballer cannot follow: ${w.text}`);
        out.push({ ref: w.text.slice(1), start: w.start, end: w.end, text: w.text });
      } else {
        const last = out.at(-1);
        // A parameter before any reference is a macro or a number Keyballer cannot place.
        if (!last || last.start < base) throw new ZmkSourceError(`a binding that does not start with a reference: ${w.text}`);
        last.end = w.end;
        last.text = src.slice(last.start, last.end);
      }
    }
  }
  return out;
}

function numbers(src: string, p: Prop | undefined): number[] | null {
  if (!p) return null;
  const value = src.slice(p.valueStart, p.valueEnd);
  const m = /^<\s*((?:(?:0x[0-9a-fA-F]+|\d+)\s*)*)>$/.exec(value);
  if (!m) throw new ZmkSourceError(`numbers Keyballer cannot read: ${value}`);
  return m[1].trim() === '' ? [] : m[1].trim().split(/\s+/).map(Number);
}

interface Parsed {
  src: string;
  m: string;
  nodes: Node[];
  keymap: Node;
  combos: Node | null;
}

function parsed(src: string): Parsed {
  const m = mask(src);
  const nodes = parse(m);
  const keymaps = compatible(src, nodes, 'zmk,keymap');
  if (keymaps.length !== 1) throw new ZmkSourceError(keymaps.length ? 'more than one keymap node' : 'no keymap node');
  const combos = compatible(src, nodes, 'zmk,combos');
  if (combos.length > 1) throw new ZmkSourceError('more than one combos node');
  return { src, m, nodes, keymap: keymaps[0], combos: combos[0] ?? null };
}

/** The layers and combos as the file writes them. Throws ZmkSourceError when it cannot. */
export function readZmkKeymap(src: string): ZmkSource {
  const p = parsed(src);
  return {
    layers: p.keymap.children.map((n) => ({
      node: n.name,
      status: stringOf(src, prop(n, 'status')),
      bindings: bindingsOf(src, p.m, prop(n, 'bindings')),
    })),
    combos: (p.combos?.children ?? []).map((n) => ({
      node: n.name,
      positions: numbers(src, prop(n, 'key-positions')) ?? [],
      bindings: bindingsOf(src, p.m, prop(n, 'bindings')),
      layers: numbers(src, prop(n, 'layers')),
    })),
  };
}

// ---- changes ---------------------------------------------------------------------------

type Splice = { start: number; end: number; text: string };

function apply(src: string, edits: Splice[]): string {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const lineStart = (src: string, at: number) => src.lastIndexOf('\n', at - 1) + 1;
const lineEnd = (src: string, at: number) => {
  const n = src.indexOf('\n', at);
  return n < 0 ? src.length : n;
};
const indentAt = (src: string, at: number) => /^[ \t]*/.exec(src.slice(lineStart(src, at)))![0];

function layerNode(p: Parsed, node: string): Node {
  const n = p.keymap.children.find((c) => c.name === node);
  if (!n) throw new LocalizedError('edit.err.noKey', { layer: node, index: 0 });
  return n;
}

/**
 * Bindings put in their old places, each at its old column when the line has room (columns that
 * line up stay lined up), else one space after the one before. Text between bindings that is not
 * spaces (a comment) keeps the plain replacement.
 */
function relay(src: string, bindings: Binding[], texts: Map<number, string>): Splice[] {
  const edits: Splice[] = [];
  const lines = new Map<number, number[]>();
  bindings.forEach((b, i) => {
    const ls = lineStart(src, b.start);
    lines.set(ls, [...(lines.get(ls) ?? []), i]);
  });
  for (const [ls, members] of lines) {
    if (!members.some((i) => texts.has(i))) continue;
    const first = bindings[members[0]];
    const last = bindings[members[members.length - 1]];
    const gaps = members.slice(1).map((i, k) => src.slice(bindings[members[k]].end, bindings[i].start));
    if (gaps.some((g) => !/^[ \t]+$/.test(g))) {
      for (const i of members) if (texts.has(i)) edits.push({ start: bindings[i].start, end: bindings[i].end, text: texts.get(i)! });
      continue;
    }
    let line = src.slice(ls, first.start);
    members.forEach((i, k) => {
      if (k > 0) line += ' '.repeat(Math.max(1, bindings[i].start - ls - line.length));
      line += texts.get(i) ?? bindings[i].text;
    });
    edits.push({ start: ls, end: last.end, text: line });
  }
  return edits;
}

/** Puts a binding on a layer's key, keeping the next binding's column when there is room. */
export function setZmkBinding(src: string, node: string, index: number, text: string): string {
  const p = parsed(src);
  const n = layerNode(p, node);
  const bindings = bindingsOf(src, p.m, prop(n, 'bindings'));
  if (index < bindings.length) return apply(src, relay(src, bindings, new Map([[index, text]])));
  // A short layer: the keys up to this one get no action, as ZMK leaves them.
  const last = bindings.at(-1);
  const at = last ? last.end : prop(n, 'bindings')!.valueStart + 1;
  const fill = [...Array(index - bindings.length).fill('&none'), text].join(' ');
  return apply(src, [{ start: at, end: at, text: ` ${fill}` }]);
}

/** A layer node's text for a new layer: every key transparent, in the rows and columns of `like`. */
function layerText(src: string, p: Parsed, like: Node, node: string, keys: number): string {
  const indent = indentAt(src, like.start);
  const bindingsProp = prop(like, 'bindings');
  const bindings = bindingsOf(src, p.m, bindingsProp);
  const inner = indentAt(src, bindingsProp?.start ?? like.open);
  // The last layer's rows when it has a binding for every key; one row otherwise.
  const rows =
    bindingsProp && bindings.length === keys
      ? relaidValue(src, bindingsProp, bindings)
      : `<${Array(keys).fill('&trans').join(' ')}>`;
  return `${indent}${node} {\n${inner}bindings = ${rows};\n${indent}};`;
}

/** The bindings value with every binding made `&trans`, keeping its rows and columns. */
function relaidValue(src: string, bindingsProp: Prop, bindings: Binding[]): string {
  const edits = relay(src, bindings, new Map(bindings.map((_, i) => [i, '&trans'])));
  const piece = src.slice(bindingsProp.valueStart, bindingsProp.valueEnd);
  const shifted = edits.map((e) => ({ ...e, start: e.start - bindingsProp.valueStart, end: e.end - bindingsProp.valueStart }));
  // A row that starts before the value (bindings = <&kp A ...) starts at the value instead.
  return apply(
    piece,
    shifted.map((e) => (e.start < 0 ? { ...e, start: 0, text: e.text.slice(-e.start) } : e)),
  );
}

/**
 * Adds a layer node after `after` (the last layer in use, before any reserved ones), with every key
 * transparent in that layer's rows.
 */
export function addZmkLayer(src: string, after: string, node: string, keys: number): string {
  const p = parsed(src);
  const like = layerNode(p, after);
  if (p.keymap.children.some((c) => c.name === node)) throw new ZmkSourceError(`a node named ${node} already`);
  return apply(src, [{ start: like.end, end: like.end, text: `\n\n${layerText(src, p, like, node, keys)}` }]);
}

/** Removes a layer node, with the blank lines and comments between it and the node before. */
export function removeZmkLayer(src: string, node: string): string {
  const p = parsed(src);
  const at = p.keymap.children.findIndex((c) => c.name === node);
  if (at < 1) throw new LocalizedError('edit.err.lastLayer');
  return apply(src, [{ start: p.keymap.children[at - 1].end, end: p.keymap.children[at].end, text: '' }]);
}

/** A devicetree string: quotes and backslashes escaped, line breaks and control characters left out. */
export function dtsString(text: string): string {
  // eslint-disable-next-line no-control-regex
  return `"${text.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** Names a layer with `display-name`, which ZMK reads first; an empty name removes it. */
export function setZmkLayerName(src: string, node: string, name: string): string {
  const p = parsed(src);
  const n = layerNode(p, node);
  const current = prop(n, 'display-name');
  if (current && name === '') {
    return apply(src, [{ start: lineStart(src, current.start), end: lineEnd(src, current.end) + 1, text: '' }]);
  }
  if (current) return apply(src, [{ start: current.valueStart, end: current.valueEnd, text: dtsString(name) }]);
  if (name === '') return src;
  const first = n.props[0];
  const indent = first ? indentAt(src, first.start) : `${indentAt(src, n.start)}    `;
  const at = first ? lineStart(src, first.start) : lineEnd(src, n.open) + 1;
  return apply(src, [{ start: at, end: at, text: `${indent}display-name = ${dtsString(name)};\n` }]);
}

// ---- combos ---------------------------------------------------------------------------------

function comboNode(p: Parsed, node: string): Node {
  const n = p.combos?.children.find((c) => c.name === node);
  if (!n) throw new LocalizedError('edit.err.noCombo', { index: node });
  return n;
}

/** The step a file indents by: a tab, or the spaces between the keymap node and its layers. */
function indentStep(src: string, p: Parsed): string {
  const outer = indentAt(src, p.keymap.start);
  const inner = p.keymap.children[0] ? indentAt(src, p.keymap.children[0].start) : '';
  return inner.startsWith(outer) && inner.length > outer.length ? inner.slice(outer.length) : '    ';
}

const comboBody = (indent: string, step: string, binding: string, positions: number[]) =>
  `${indent}${step}bindings = <${binding}>;\n${indent}${step}key-positions = <${positions.join(' ')}>;\n`;

/** Adds a combo; without a combos node, one goes before the keymap node. */
export function addZmkCombo(src: string, node: string, positions: number[], binding: string): string {
  const p = parsed(src);
  const step = indentStep(src, p);
  if (p.combos) {
    if (p.combos.children.some((c) => c.name === node)) throw new ZmkSourceError(`a combo named ${node} already`);
    const indent = p.combos.children[0] ? indentAt(src, p.combos.children[0].start) : indentAt(src, p.combos.start) + step;
    const text = `\n${indent}${node} {\n${comboBody(indent, step, binding, positions)}${indent}};\n`;
    const at = lineStart(src, p.combos.close);
    return apply(src, [{ start: at, end: at, text: text.slice(src[at - 2] === '\n' || p.combos.children.length === 0 ? 1 : 0) }]);
  }
  const indent = indentAt(src, p.keymap.start);
  const child = indent + step;
  const text =
    `${indent}combos {\n${child}compatible = "zmk,combos";\n\n` +
    `${child}${node} {\n${comboBody(child, step, binding, positions)}${child}};\n${indent}};\n\n`;
  const at = lineStart(src, p.keymap.start);
  return apply(src, [{ start: at, end: at, text }]);
}

/** Changes a combo's keys and output, leaving anything else in it (layers, timeout) as it is. */
export function setZmkCombo(src: string, node: string, positions: number[], binding: string): string {
  const p = parsed(src);
  const n = comboNode(p, node);
  const edits: Splice[] = [];
  const bindings = prop(n, 'bindings');
  const keys = prop(n, 'key-positions');
  if (!bindings || !keys) throw new LocalizedError('edit.err.noCombo', { index: node });
  edits.push({ start: bindings.valueStart, end: bindings.valueEnd, text: `<${binding}>` });
  edits.push({ start: keys.valueStart, end: keys.valueEnd, text: `<${positions.join(' ')}>` });
  return apply(src, edits);
}

/** Removes a combo node, and the blank line before it. */
export function removeZmkCombo(src: string, node: string): string {
  const p = parsed(src);
  const n = comboNode(p, node);
  const start = lineStart(src, n.start);
  const before = src.slice(0, start);
  // From the end of the line before the blank one, or the whole node's lines.
  if (/\n[ \t]*\n$/.test(before)) return apply(src, [{ start: before.replace(/\n[ \t]*\n$/, '').length, end: lineEnd(src, n.end), text: '' }]);
  return apply(src, [{ start, end: Math.min(src.length, lineEnd(src, n.end) + 1), text: '' }]);
}

/** Includes a header after the file's last #include, if it does not include it yet. */
export function ensureInclude(src: string, header: string): string {
  const includes = [...src.matchAll(/^[ \t]*#[ \t]*include[ \t]*[<"]([^>"]+)[>"].*$/gm)];
  if (includes.some((m) => m[1] === header)) return src;
  const last = includes.at(-1);
  const at = last ? last.index! + last[0].length : 0;
  return apply(src, [{ start: at, end: at, text: last ? `\n#include <${header}>` : `#include <${header}>\n\n` }]);
}

/** A node name not used among these, from a base: `combo_tab`, then `combo_tab_2`. */
export function freeName(base: string, taken: string[]): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'node';
  if (!taken.includes(clean)) return clean;
  for (let n = 2; ; n++) if (!taken.includes(`${clean}_${n}`)) return `${clean}_${n}`;
}
