// The keymap view model: what to draw for one layer of a view file.
// The view file is written by the build (scripts/keyballer_view.py).

import { LocalizedError, translate, type Lang } from '../i18n/core';
import {
  ballModeWord,
  basicLegend,
  isLayerFunction,
  layerActionWord,
  modMask,
  MOD_FUNCTIONS,
  MOD_TAPS,
  modifierKey,
  modsWord,
  NO_ACTION,
  shiftedBase,
  TRANSPARENT,
  withMods,
  wordedLegend,
  type Layout,
  type Mod,
  type Os,
} from './keycodes';

export interface ViewKey {
  index: number;
  matrix: [number, number];
  present: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  rx?: number;
  ry?: number;
}

export interface ViewLayer {
  name: string | null;
  ball: string | null;
  keys: string[];
}

export interface ViewCombo {
  /** The key array's name in keymap.c, when known (edited views). */
  name?: string;
  keys: string[];
  positions: (number | null)[];
  output: string;
  line: number;
}

export interface ViewFile {
  schema: 1;
  layout: string;
  keys: ViewKey[];
  balls: { x: number; y: number; d: number }[];
  layers: ViewLayer[];
  labels: Record<string, { en?: string; ja?: string }>;
  defines: Record<string, string>;
  combos: ViewCombo[];
  code: Record<string, number[]>;
  keyboard?: string;
  keymap?: string;
  /** Where keymap.c is: its path, and the repository and commit it was built from. */
  source?: { path: string; repository?: string; commit?: string };
}

/** How legends are written. It changes the labels only, never the firmware. */
export interface Display {
  lang: Lang;
  os: Os;
  layout: Layout;
}

/** Centre: tap; bottom: hold; top: a second line such as the shifted character. */
export interface Legend {
  tap: string;
  hold?: string;
  top?: string;
}

export type KeyKind = 'normal' | 'modifier' | 'layer' | 'transparent' | 'none' | 'unknown';

export interface DrawnKey {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  rx: number;
  ry: number;
  /** The key's centre on the drawing, after rotation. */
  cx: number;
  cy: number;
  /** The keycode as written in the keymap. */
  keycode: string;
  kind: KeyKind;
  legend: Legend;
  /** The layer a layer key reaches. */
  target?: number;
  /** For a transparent key: what the base layer has there. */
  fallsTo?: Legend;
  /** Held to reach the layer being drawn. */
  held: boolean;
  /** Lines of the keymap source that change what this key does. */
  code?: number[];
}

export interface DrawnBall {
  x: number;
  y: number;
  d: number;
  /** What the ball does on this layer, when the configuration says. */
  mode?: string;
}

export interface DrawnCombo {
  positions: number[];
  output: Legend;
  line: number;
}

export interface DrawnLayer {
  keys: DrawnKey[];
  balls: DrawnBall[];
  combos: DrawnCombo[];
}

/** Checks the shape of a fetched view file; throws a readable error when it is not one. */
export function parseView(value: unknown): ViewFile {
  const v = value as Partial<ViewFile> | null;
  if (!v || v.schema !== 1 || !Array.isArray(v.keys) || !Array.isArray(v.layers) || v.layers.length === 0) {
    throw new LocalizedError('keymap.err.format');
  }
  return {
    ...v,
    balls: v.balls ?? [],
    labels: v.labels ?? {},
    defines: v.defines ?? {},
    combos: v.combos ?? [],
    code: v.code ?? {},
  } as ViewFile;
}

/** A keycode without spaces, as the view file's `code` keys are written. */
const norm = (code: string) => code.replace(/\s+/g, '');

// ---- keycode expressions ------------------------------------------------

interface Expr {
  name: string;
  args: Expr[];
}

/** `LT(3, KC_K)` → { name: 'LT', args: [{ name: '3' }, { name: 'KC_K' }] } */
export function parseKeycode(text: string): Expr {
  let at = 0;
  const s = text.replace(/\s+/g, '');
  const read = (): Expr => {
    const start = at;
    while (at < s.length && s[at] !== '(' && s[at] !== ',' && s[at] !== ')') at++;
    const name = s.slice(start, at);
    const args: Expr[] = [];
    if (s[at] === '(') {
      at++;
      while (at < s.length && s[at] !== ')') {
        args.push(read());
        if (s[at] === ',') at++;
      }
      at++;
    }
    return { name, args };
  };
  return read();
}

// ---- legends --------------------------------------------------------------

interface Context {
  view: ViewFile;
  display: Display;
}

/** A layer's configured name, or L<n>. */
export function layerName(view: ViewFile, n: number, lang: Lang): string {
  return view.layers[n]?.name ?? translate(lang, 'legend.layer', { n });
}

/** A layer argument: a number, or an enum name that QMK keeps as written (`_SYM` → SYM). */
function layerArg(ctx: Context, arg: Expr): { target?: number; name: string } {
  const n = Number(arg.name);
  return Number.isInteger(n)
    ? { target: n, name: layerName(ctx.view, n, ctx.display.lang) }
    : { name: arg.name.replace(/^_+/, '') };
}

interface Described {
  kind: KeyKind;
  legend: Legend;
  target?: number;
  /** The layer this key reaches while held. */
  holds?: number;
}

/** Modifiers stacked by functions such as S(), C() and LCA(), and the key inside them. */
function collectMods(expr: Expr): { mods: Mod[]; base: Expr } {
  const mods: Mod[] = [];
  let base = expr;
  while (MOD_FUNCTIONS[base.name] && base.args.length === 1) {
    mods.push(...MOD_FUNCTIONS[base.name]);
    base = base.args[0];
  }
  return { mods, base };
}

function describe(expr: Expr, ctx: Context, depth = 0): Described {
  const { name, args } = expr;
  const { os, layout } = ctx.display;

  if (TRANSPARENT.has(name)) return { kind: 'transparent', legend: { tap: '▽' } };
  if (NO_ACTION.has(name)) return { kind: 'none', legend: { tap: '—' } };

  // A name the configuration gives a label (custom keycodes such as SCRSHOT_AREA).
  const label = ctx.view.labels[name];
  if (label && args.length === 0) {
    const lang = ctx.display.lang;
    return { kind: 'normal', legend: { tap: label[lang] ?? label.en ?? label.ja ?? name } };
  }

  const worded = wordedLegend(name, ctx.display.lang);
  if (worded && args.length === 0) return { kind: 'normal', legend: worded };

  // An alias the keymap #defines (TH_EISU → LALT_T(KC_LNG2)).
  const alias = ctx.view.defines[name];
  if (alias && args.length === 0 && depth < 8) return describe(parseKeycode(alias), ctx, depth + 1);

  const mod = modifierKey(name);
  if (mod) return { kind: 'modifier', legend: { tap: modsWord([mod], os) } };

  const basic = basicLegend(name, layout);
  if (basic !== undefined) return { kind: 'normal', legend: { tap: basic } };

  const shifts = shiftedBase(name);
  if (shifts) {
    const ch = basicLegend(shifts, layout, true);
    return { kind: 'normal', legend: { tap: ch ?? withMods(['shift'], basicLegend(shifts, layout) ?? name, os) } };
  }

  if (MOD_FUNCTIONS[name] && args.length === 1) {
    const { mods, base } = collectMods(expr);
    let rest = mods;
    let key = describe(base, ctx, depth + 1).legend.tap;
    if (mods.includes('shift')) {
      const ch = basicLegend(base.name, layout, true);
      if (ch !== undefined) {
        key = ch;
        rest = mods.filter((m) => m !== 'shift');
      }
    }
    return { kind: 'normal', legend: { tap: withMods(rest, key, os) } };
  }

  if (MOD_TAPS[name] && args.length === 1) {
    const tap = describe(args[0], ctx, depth + 1).legend.tap;
    return { kind: 'normal', legend: { tap, hold: modsWord(MOD_TAPS[name], os) } };
  }

  if (name === 'LT' && args.length === 2) {
    const { target, name: layer } = layerArg(ctx, args[0]);
    return {
      kind: 'layer',
      ...(target === undefined ? {} : { target, holds: target }),
      legend: { tap: describe(args[1], ctx, depth + 1).legend.tap, hold: layer },
    };
  }

  if (isLayerFunction(name) && args.length === 1) {
    const { target, name: layer } = layerArg(ctx, args[0]);
    const top = layerActionWord(name, ctx.display.lang);
    const held = name === 'MO' || name === 'TT';
    return {
      kind: 'layer',
      ...(target === undefined ? {} : { target }),
      ...(held && target !== undefined ? { holds: target } : {}),
      legend: top ? { tap: layer, top } : { tap: layer },
    };
  }

  if (name === 'OSM' && args.length === 1) {
    const mods = modMask(args[0].name);
    return {
      kind: 'modifier',
      legend: { tap: modsWord(mods, os), top: translate(ctx.display.lang, 'legend.oneShot') },
    };
  }

  return { kind: 'unknown', legend: { tap: name } };
}

/** The legend one keycode gets on this view's keycaps (for the key picker). */
export function legendOf(view: ViewFile, keycode: string, display: Display): Legend {
  return describe(parseKeycode(keycode), { view, display }).legend;
}

// ---- drawing ---------------------------------------------------------------

/** A point turned by r degrees (clockwise on screen) about (rx, ry), as KLE rotates keys. */
export function rotate(x: number, y: number, r: number, rx: number, ry: number): [number, number] {
  if (!r) return [x, y];
  const a = (r * Math.PI) / 180;
  const dx = x - rx;
  const dy = y - ry;
  return [rx + dx * Math.cos(a) - dy * Math.sin(a), ry + dx * Math.sin(a) + dy * Math.cos(a)];
}

/**
 * How a layer is reached: the layers under it while it is on (lowest first) and the keys held on
 * them, as positions in the view's key list. A layer no key holds sits on the base layer alone.
 */
function reach(described: Described[][], layer: number): { under: number[]; held: Set<number> } {
  for (let from = 0; from < layer; from++) {
    const keys = described[from]
      .map((d, index) => (d.holds === layer ? index : -1))
      .filter((index) => index >= 0);
    if (keys.length === 0) continue;
    const below = from === 0 ? { under: [], held: new Set<number>() } : reach(described, from);
    return { under: [...below.under, from], held: new Set([...below.held, ...keys]) };
  }
  return { under: layer === 0 ? [] : [0], held: new Set() };
}

export function drawLayer(view: ViewFile, layer: number, display: Display): DrawnLayer {
  const ctx: Context = { view, display };
  const described = view.layers
    .slice(0, layer + 1)
    .map((l) => view.keys.map((k) => describe(parseKeycode(l.keys[k.index] ?? 'KC_NO'), ctx)));
  const { under, held } = reach(described, layer);
  const codes = view.layers[layer]?.keys ?? [];
  const keys: DrawnKey[] = [];
  for (const [at, k] of view.keys.entries()) {
    if (!k.present) continue;
    const keycode = codes[k.index] ?? 'KC_NO';
    const d = described[layer][at];
    // A transparent key does what the highest layer under it does there.
    const below = d.kind === 'transparent'
      ? [...under].reverse().map((l) => described[l][at]).find((x) => x.kind !== 'transparent')
      : undefined;
    const fallsTo = below?.legend;
    const code = view.code[norm(keycode)];
    const [x, y, w, h, r, rx, ry] = [k.x ?? 0, k.y ?? 0, k.w ?? 1, k.h ?? 1, k.r ?? 0, k.rx ?? 0, k.ry ?? 0];
    const [cx, cy] = rotate(x + w / 2, y + h / 2, r, rx, ry);
    keys.push({
      index: k.index,
      x,
      y,
      w,
      h,
      r,
      rx,
      ry,
      cx,
      cy,
      keycode,
      kind: d.kind,
      legend: d.legend,
      held: held.has(at),
      ...(d.target === undefined ? {} : { target: d.target }),
      ...(fallsTo ? { fallsTo } : {}),
      ...(code ? { code } : {}),
    });
  }

  const mode = view.layers[layer]?.ball;
  const balls = view.balls.map((b) => (mode ? { ...b, mode: ballModeWord(mode, display.lang) } : { ...b }));

  // Combos fire from the base layer's keys (COMBO_ONLY_FROM_LAYER 0), so they are drawn there.
  const combos: DrawnCombo[] = [];
  if (layer === 0) {
    for (const c of view.combos) {
      if (c.positions.some((p) => p === null)) continue;
      combos.push({
        positions: c.positions as number[],
        output: describe(parseKeycode(c.output), ctx).legend,
        line: c.line,
      });
    }
  }
  return { keys, balls, combos };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * The key an arrow press moves to: the nearest key at least half a unit away in
 * that direction, preferring keys straight ahead (sideways distance counts double).
 */
export function nextKey(drawn: DrawnLayer, from: number, direction: Direction): number | null {
  const start = drawn.keys.find((k) => k.index === from);
  if (!start) return null;
  let best: number | null = null;
  let bestScore = Infinity;
  for (const k of drawn.keys) {
    if (k.index === from) continue;
    const dx = k.cx - start.cx;
    const dy = k.cy - start.cy;
    const ahead = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const aside = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (ahead < 0.5) continue;
    const score = ahead + 2 * aside;
    if (score < bestScore) {
      bestScore = score;
      best = k.index;
    }
  }
  return best;
}
