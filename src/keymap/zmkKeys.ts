// Writing a key as a ZMK binding: the keycodes Keyballer uses on screen (QMK's names, as the
// build's reader scripts/zmk_view.py makes them from ZMK bindings) turned back into .keymap text.
// The names are ZMK's (app/include/dt-bindings/zmk/keys.h); src/keymap/zmkKeys.test.ts checks
// each against that file through the build's reader. See docs/plans/zmk.md, phase 4.

import type { MessageKey } from '../i18n/messages';
import { canonical, MOD_TAPS, NO_ACTION, shiftedBase, TRANSPARENT, type Mod } from './keycodes';
import { parseKeycode } from './view';

/** What the keymap being edited already has, which decides how some keys are written. */
export interface ZmkContext {
  /** Each keycode in the keymap, with its binding as written there (`KC_LALT` → `&kp LEFT_ALT`). */
  known: ReadonlyMap<string, string>;
  /** Mouse buttons (`&mkp`) build only with ZMK's mouse keys on: the keymap already uses them. */
  mouse: boolean;
  /** `&bt` builds only with Bluetooth on: the keymap already uses it. */
  bluetooth: boolean;
}

/** A binding, and the header its names come from when the keymap may not include it yet. */
export type ZmkBinding = { text: string; header?: string } | { refused: MessageKey };

const KEY_NAMES: Record<string, string> = {
  KC_MINS: 'MINUS', KC_EQL: 'EQUAL', KC_LBRC: 'LBKT', KC_RBRC: 'RBKT', KC_BSLS: 'BSLH', KC_NUHS: 'NON_US_HASH',
  KC_SCLN: 'SEMI', KC_QUOT: 'SQT', KC_GRV: 'GRAVE', KC_COMM: 'COMMA', KC_DOT: 'DOT', KC_SLSH: 'SLASH',
  KC_NUBS: 'NON_US_BSLH',
  KC_ESC: 'ESC', KC_TAB: 'TAB', KC_SPC: 'SPACE', KC_ENT: 'RET', KC_BSPC: 'BSPC', KC_DEL: 'DEL', KC_INS: 'INS',
  KC_HOME: 'HOME', KC_END: 'END', KC_PGUP: 'PG_UP', KC_PGDN: 'PG_DN', KC_LEFT: 'LEFT', KC_DOWN: 'DOWN',
  KC_UP: 'UP', KC_RGHT: 'RIGHT', KC_CAPS: 'CAPS', KC_APP: 'K_APP', KC_PSCR: 'PSCRN', KC_SCRL: 'SLCK',
  KC_PAUS: 'PAUSE_BREAK', KC_NUM: 'KP_NUM',
  KC_LCTL: 'LCTRL', KC_LSFT: 'LSHFT', KC_LALT: 'LALT', KC_LGUI: 'LGUI',
  KC_RCTL: 'RCTRL', KC_RSFT: 'RSHFT', KC_RALT: 'RALT', KC_RGUI: 'RGUI',
  KC_LNG1: 'LANG1', KC_LNG2: 'LANG2', KC_INT1: 'INT_RO', KC_INT2: 'INT_KANA', KC_INT3: 'INT_YEN',
  KC_INT4: 'INT_HENKAN', KC_INT5: 'INT_MUHENKAN',
  KC_PSLS: 'KP_SLASH', KC_PAST: 'KP_MULTIPLY', KC_PMNS: 'KP_MINUS', KC_PPLS: 'KP_PLUS', KC_PENT: 'KP_ENTER',
  KC_PDOT: 'KP_DOT', KC_PEQL: 'KP_EQUAL', KC_PCMM: 'KP_COMMA',
  KC_VOLU: 'C_VOL_UP', KC_VOLD: 'C_VOL_DN', KC_MUTE: 'C_MUTE', KC_MPLY: 'C_PP', KC_MNXT: 'C_NEXT',
  KC_MPRV: 'C_PREV', KC_MSTP: 'C_STOP', KC_BRIU: 'C_BRI_UP', KC_BRID: 'C_BRI_DN',
};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KEY_NAMES[`KC_${c}`] = c;
for (let n = 0; n <= 9; n++) {
  KEY_NAMES[`KC_${n}`] = `N${n}`;
  KEY_NAMES[`KC_P${n}`] = `KP_N${n}`;
}
for (let n = 1; n <= 24; n++) KEY_NAMES[`KC_F${n}`] = `F${n}`;

/** ZMK's names for shifted characters, by the key they shift (`EXCL` is `LS(N1)`). */
const SHIFTED_NAMES: Record<string, string> = {
  KC_1: 'EXCL', KC_2: 'AT', KC_3: 'HASH', KC_4: 'DLLR', KC_5: 'PRCNT', KC_6: 'CARET', KC_7: 'AMPS', KC_8: 'STAR',
  KC_9: 'LPAR', KC_0: 'RPAR', KC_MINS: 'UNDER', KC_EQL: 'PLUS', KC_LBRC: 'LBRC', KC_RBRC: 'RBRC', KC_BSLS: 'PIPE',
  KC_SCLN: 'COLON', KC_QUOT: 'DQT', KC_GRV: 'TILDE', KC_COMM: 'LT', KC_DOT: 'GT', KC_SLSH: 'QMARK',
};

/** QMK's modifier functions as ZMK's (`LSFT(…)` → `LS(…)`), outermost first. */
const MOD_FUNCTION_NAMES: Record<string, string[]> = {
  S: ['LS'], LSFT: ['LS'], RSFT: ['RS'], C: ['LC'], LCTL: ['LC'], RCTL: ['RC'],
  A: ['LA'], LALT: ['LA'], LOPT: ['LA'], RALT: ['RA'], ROPT: ['RA'], ALGR: ['RA'],
  G: ['LG'], LGUI: ['LG'], LCMD: ['LG'], LWIN: ['LG'], RGUI: ['RG'], RCMD: ['RG'], RWIN: ['RG'],
  LCA: ['LC', 'LA'], LSG: ['LS', 'LG'], SGUI: ['LS', 'LG'], SCMD: ['LS', 'LG'], SWIN: ['LS', 'LG'],
  LAG: ['LA', 'LG'], RAG: ['RA', 'RG'], C_S: ['LC', 'LS'], LCS: ['LC', 'LS'], RCS: ['RC', 'RS'],
  LSA: ['LS', 'LA'], RSA: ['RS', 'RA'], LCG: ['LC', 'LG'], RCG: ['RC', 'RG'], LCAG: ['LC', 'LA', 'LG'],
  MEH: ['LC', 'LS', 'LA'], HYPR: ['LC', 'LS', 'LA', 'LG'],
};

/** The modifier key ZMK holds or makes sticky, by side and modifier. */
const MOD_KEY: Record<'L' | 'R', Record<Mod, string>> = {
  L: { ctrl: 'LCTRL', shift: 'LSHFT', alt: 'LALT', gui: 'LGUI' },
  R: { ctrl: 'RCTRL', shift: 'RSHFT', alt: 'RALT', gui: 'RGUI' },
};
const MOD_BITS: Record<string, [side: 'L' | 'R', mod: Mod]> = {
  MOD_LCTL: ['L', 'ctrl'], MOD_LSFT: ['L', 'shift'], MOD_LALT: ['L', 'alt'], MOD_LGUI: ['L', 'gui'],
  MOD_RCTL: ['R', 'ctrl'], MOD_RSFT: ['R', 'shift'], MOD_RALT: ['R', 'alt'], MOD_RGUI: ['R', 'gui'],
};

const LAYER_BEHAVIOURS: Record<string, string> = { MO: '&mo', TG: '&tog', TO: '&to', OSL: '&sl' };
const PLAIN: Record<string, string> = { QK_BOOT: '&bootloader', QK_RBT: '&sys_reset', CW_TOGG: '&caps_word', QK_REP: '&key_repeat' };
const BT_COMMANDS = new Set(['CLR', 'NXT', 'PRV', 'CLR_ALL']);
const OUTPUTS = new Set(['TOG', 'USB', 'BLE']);
// ZMK numbers layers from 0 in a 32-bit layer state.
const MAX_LAYER = 31;

const BT_HEADER = 'dt-bindings/zmk/bt.h';
const OUTPUTS_HEADER = 'dt-bindings/zmk/outputs.h';
const POINTING_HEADER = 'dt-bindings/zmk/pointing.h';

type Expr = ReturnType<typeof parseKeycode>;

/** A key as `&kp` takes it (`LS(LG(S))`), or null when ZMK has no name for it. */
function keyOf(expr: Expr): string | null {
  const name = canonical(expr.name);
  if (expr.args.length === 0) {
    const base = shiftedBase(name);
    return base ? (SHIFTED_NAMES[base] ?? null) : (KEY_NAMES[name] ?? null);
  }
  const fns = MOD_FUNCTION_NAMES[expr.name];
  if (!fns || expr.args.length !== 1) return null;
  // A shifted character keeps ZMK's own name for it: LSFT(KC_1) is EXCL.
  const inner = expr.args[0];
  if (fns.length === 1 && fns[0] === 'LS' && inner.args.length === 0 && SHIFTED_NAMES[canonical(inner.name)]) {
    return SHIFTED_NAMES[canonical(inner.name)];
  }
  const key = keyOf(inner);
  return key && fns.reduceRight((text, fn) => `${fn}(${text})`, key);
}

const layerOf = (expr: Expr | undefined): number | null => {
  if (!expr || expr.args.length > 0 || !/^\d{1,2}$/.test(expr.name)) return null;
  const n = Number(expr.name);
  return n <= MAX_LAYER ? n : null;
};

/** A mod-tap's held modifier, when it holds exactly one: `LALT_T` → LALT, `MT(MOD_RSFT, …)` → RSHFT. */
function heldModifier(expr: Expr): string | null {
  if (expr.name === 'MT' && expr.args.length === 2) {
    const bits = expr.args[0].name.split('|');
    const bit = bits.length === 1 ? MOD_BITS[bits[0]] : undefined;
    return bit ? MOD_KEY[bit[0]][bit[1]] : null;
  }
  const mods = MOD_TAPS[expr.name];
  if (!mods || mods.length !== 1 || expr.args.length !== 1) return null;
  const side = /^(R|ALGR_T)/.test(expr.name) ? 'R' : 'L';
  return MOD_KEY[side][mods[0]];
}

/** The binding that does what a keycode does, or why Keyballer cannot write one. */
export function zmkBinding(keycode: string, context: ZmkContext): ZmkBinding {
  const code = keycode.replace(/\s+/g, '');
  const known = context.known.get(code);
  if (known) return { text: known };
  const expr = parseKeycode(code);
  const name = canonical(expr.name);

  if (expr.args.length === 0) {
    if (TRANSPARENT.has(name)) return { text: '&trans' };
    if (NO_ACTION.has(name)) return { text: '&none' };
    if (PLAIN[name]) return { text: PLAIN[name] };
    const button = /^KC_BTN([1-5])$/.exec(name);
    if (button) return context.mouse ? { text: `&mkp MB${button[1]}`, header: POINTING_HEADER } : { refused: 'picker.err.zmkFeature' };
    const bt = /^ZMK_BT_(?:(SEL|DISC)_(\d)|([A-Z_]+))$/.exec(name);
    if (bt && (bt[1] || BT_COMMANDS.has(bt[3]))) {
      if (!context.bluetooth) return { refused: 'picker.err.zmkFeature' };
      return { text: bt[1] ? `&bt BT_${bt[1]} ${bt[2]}` : `&bt BT_${bt[3]}`, header: BT_HEADER };
    }
    const out = /^ZMK_OUT_([A-Z]+)$/.exec(name);
    if (out && OUTPUTS.has(out[1])) return { text: `&out OUT_${out[1]}`, header: OUTPUTS_HEADER };
  }

  if (LAYER_BEHAVIOURS[expr.name] && expr.args.length === 1) {
    const layer = layerOf(expr.args[0]);
    return layer === null ? { refused: 'picker.err.notInZmk' } : { text: `${LAYER_BEHAVIOURS[expr.name]} ${layer}` };
  }
  if (expr.name === 'OSM' && expr.args.length === 1) {
    const bits = expr.args[0].name.split('|');
    const bit = bits.length === 1 ? MOD_BITS[bits[0]] : undefined;
    return bit ? { text: `&sk ${MOD_KEY[bit[0]][bit[1]]}` } : { refused: 'picker.err.notInZmk' };
  }
  if (expr.name === 'LT' && expr.args.length === 2) {
    const layer = layerOf(expr.args[0]);
    const tap = keyOf(expr.args[1]);
    return layer !== null && tap ? { text: `&lt ${layer} ${tap}` } : { refused: 'picker.err.notInZmk' };
  }
  if (expr.name === 'MT' || MOD_TAPS[expr.name]) {
    const held = heldModifier(expr);
    const tap = keyOf(expr.args[expr.args.length - 1] ?? { name: '', args: [] });
    return held && tap ? { text: `&mt ${held} ${tap}` } : { refused: 'picker.err.notInZmk' };
  }
  const key = keyOf(expr);
  return key ? { text: `&kp ${key}` } : { refused: 'picker.err.notInZmk' };
}

/**
 * How the keymap screen labels a key of Keyballer's own for a ZMK behaviour, as the build's reader
 * does (scripts/zmk_view.py), for keys the build has not labelled because the keymap had none.
 */
export function zmkLabel(code: string): { en: string; ja: string } | undefined {
  const words: Record<string, string> = { CLR: 'BT clear', NXT: 'BT next', PRV: 'BT prev', CLR_ALL: 'BT clear all' };
  const outputs: Record<string, string> = { TOG: 'USB/BT', USB: 'USB', BLE: 'BT' };
  const bt = /^ZMK_BT_(?:(SEL|DISC)_(\d)|([A-Z_]+))$/.exec(code);
  const out = /^ZMK_OUT_([A-Z]+)$/.exec(code);
  let word: string | undefined;
  if (bt?.[1]) word = bt[1] === 'SEL' ? `BT ${Number(bt[2]) + 1}` : `BT disconnect ${Number(bt[2]) + 1}`;
  else if (bt) word = words[bt[3]];
  else if (out) word = outputs[out[1]];
  return word ? { en: word, ja: word } : undefined;
}
