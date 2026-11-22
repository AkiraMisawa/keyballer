// The key picker's catalogue: every keycode the picker offers, with the words
// people use for it in English and Japanese; search over it; building tap and
// hold keys QMK accepts; and keys pressed on the computer's keyboard.
// See docs/plans/keymap-editor.md, "Key picker".

import type { MessageKey } from '../i18n/messages';
import { basicLegend, MOD_FUNCTIONS, MOD_TAPS, modMask, shiftedBase, wordedLegend, type Mod } from './keycodes';
import { parseKeycode } from './view';

export type Category =
  | 'letters'
  | 'numbers'
  | 'symbols'
  | 'editing'
  | 'modifiers'
  | 'japanese'
  | 'function'
  | 'layers'
  | 'mouse'
  | 'media'
  | 'keyball'
  | 'special'
  | 'own';

export interface Entry {
  code: string;
  category: Category;
  /** Lower-case words it is found by: its name, what it prints, and what people call it. */
  words: string[];
}

export interface Catalogue {
  entries: Entry[];
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `KC_${c}`);
const NUMBERS = '1234567890'.split('').map((c) => `KC_${c}`);
const SYMBOLS = ['KC_MINS', 'KC_EQL', 'KC_LBRC', 'KC_RBRC', 'KC_BSLS', 'KC_SCLN', 'KC_QUOT', 'KC_GRV', 'KC_COMM', 'KC_DOT', 'KC_SLSH', 'KC_NUBS', 'KC_NUHS'];
const SHIFTED = ['KC_EXLM', 'KC_AT', 'KC_HASH', 'KC_DLR', 'KC_PERC', 'KC_CIRC', 'KC_AMPR', 'KC_ASTR', 'KC_LPRN', 'KC_RPRN', 'KC_UNDS', 'KC_PLUS', 'KC_LCBR', 'KC_RCBR', 'KC_PIPE', 'KC_COLN', 'KC_DQUO', 'KC_TILD', 'KC_LT', 'KC_GT', 'KC_QUES'];
const EDITING = ['KC_ESC', 'KC_TAB', 'KC_SPC', 'KC_ENT', 'KC_BSPC', 'KC_DEL', 'KC_INS', 'KC_HOME', 'KC_END', 'KC_PGUP', 'KC_PGDN', 'KC_LEFT', 'KC_DOWN', 'KC_UP', 'KC_RGHT', 'KC_CAPS', 'KC_APP', 'KC_PSCR', 'KC_SCRL', 'KC_PAUS', 'KC_NUM'];
const MODIFIERS = ['KC_LCTL', 'KC_LSFT', 'KC_LALT', 'KC_LGUI', 'KC_RCTL', 'KC_RSFT', 'KC_RALT', 'KC_RGUI'];
const JAPANESE = ['KC_LNG2', 'KC_LNG1', 'KC_INT4', 'KC_INT5', 'KC_INT2', 'KC_INT1', 'KC_INT3'];
const FUNCTION = Array.from({ length: 24 }, (_, i) => `KC_F${i + 1}`);
const MOUSE = ['KC_BTN1', 'KC_BTN2', 'KC_BTN3', 'KC_BTN4', 'KC_BTN5', 'KC_MS_U', 'KC_MS_D', 'KC_MS_L', 'KC_MS_R', 'KC_WH_U', 'KC_WH_D', 'KC_WH_L', 'KC_WH_R'];
const MEDIA = ['KC_VOLU', 'KC_VOLD', 'KC_MUTE', 'KC_MPLY', 'KC_MNXT', 'KC_MPRV', 'KC_MSTP', 'KC_BRIU', 'KC_BRID'];
const KEYBALL = ['CPI_I100', 'CPI_D100', 'CPI_I1K', 'CPI_D1K', 'SCRL_TO', 'SCRL_MO', 'SCRL_DVI', 'SCRL_DVD', 'SSNP_VRT', 'SSNP_HOR', 'SSNP_FRE', 'KBC_RST', 'KBC_SAVE'];
const SPECIAL = ['KC_TRNS', 'KC_NO', 'QK_BOOT', 'QK_RBT', 'EE_CLR', 'CW_TOGG'];

/** What people call keys, beyond their names and legends. */
const WORDS: Record<string, string[]> = {
  KC_ESC: ['escape', 'エスケープ'],
  KC_TAB: ['tab', 'タブ'],
  KC_SPC: ['space', 'スペース'],
  KC_ENT: ['enter', 'return', 'エンター', '改行'],
  KC_BSPC: ['backspace', 'バックスペース'],
  KC_DEL: ['delete', '削除'],
  KC_INS: ['insert', '挿入'],
  KC_HOME: ['home'],
  KC_END: ['end'],
  KC_PGUP: ['page up'],
  KC_PGDN: ['page down'],
  KC_LEFT: ['left arrow', 'cursor left', '左'],
  KC_RGHT: ['right arrow', 'cursor right', '右'],
  KC_UP: ['up arrow', 'cursor up', '上'],
  KC_DOWN: ['down arrow', 'cursor down', '下'],
  KC_CAPS: ['caps lock'],
  KC_APP: ['menu', 'application', 'メニュー'],
  KC_PSCR: ['print screen', 'screenshot', 'スクリーンショット'],
  KC_LCTL: ['control', 'ctrl', 'left control', 'コントロール'],
  KC_RCTL: ['control', 'ctrl', 'right control', 'コントロール'],
  KC_LSFT: ['shift', 'left shift', 'シフト'],
  KC_RSFT: ['shift', 'right shift', 'シフト'],
  KC_LALT: ['alt', 'option', 'left alt', 'オプション'],
  KC_RALT: ['alt', 'option', 'right alt', 'altgr', 'オプション'],
  KC_LGUI: ['command', 'cmd', 'windows', 'win', 'super', 'gui', 'コマンド'],
  KC_RGUI: ['command', 'cmd', 'windows', 'win', 'super', 'gui', 'コマンド'],
  KC_MINS: ['minus', 'hyphen', 'マイナス', 'ハイフン'],
  KC_EQL: ['equal', 'equals', 'イコール'],
  KC_LBRC: ['left bracket', 'open bracket', '左角かっこ'],
  KC_RBRC: ['right bracket', 'close bracket', '右角かっこ'],
  KC_BSLS: ['backslash', 'バックスラッシュ'],
  KC_SCLN: ['semicolon', 'セミコロン'],
  KC_QUOT: ['quote', 'apostrophe', 'single quote', 'クォート', 'アポストロフィ'],
  KC_GRV: ['grave', 'backtick', 'バッククォート'],
  KC_COMM: ['comma', 'カンマ', 'コンマ'],
  KC_DOT: ['period', 'dot', 'full stop', 'ピリオド', 'ドット'],
  KC_SLSH: ['slash', 'スラッシュ'],
  KC_EXLM: ['exclamation', 'bang', 'びっくり', '感嘆符'],
  KC_AT: ['at', 'at sign', 'アットマーク'],
  KC_HASH: ['hash', 'number sign', 'pound', 'シャープ', '井桁'],
  KC_DLR: ['dollar', 'ドル'],
  KC_PERC: ['percent', 'パーセント'],
  KC_CIRC: ['caret', 'キャレット'],
  KC_AMPR: ['ampersand', 'and', 'アンパサンド'],
  KC_ASTR: ['asterisk', 'star', 'アスタリスク'],
  KC_LPRN: ['left parenthesis', 'open paren', '左かっこ'],
  KC_RPRN: ['right parenthesis', 'close paren', '右かっこ'],
  KC_UNDS: ['underscore', 'アンダースコア', 'アンダーバー'],
  KC_PLUS: ['plus', 'プラス'],
  KC_LCBR: ['left brace', 'open curly', '左波かっこ'],
  KC_RCBR: ['right brace', 'close curly', '右波かっこ'],
  KC_PIPE: ['pipe', 'vertical bar', 'パイプ', '縦棒'],
  KC_COLN: ['colon', 'コロン'],
  KC_DQUO: ['double quote', 'ダブルクォート'],
  KC_TILD: ['tilde', 'チルダ'],
  KC_LT: ['less than', '小なり'],
  KC_GT: ['greater than', '大なり'],
  KC_QUES: ['question mark', 'question', 'はてな', '疑問符'],
  KC_LNG1: ['kana', 'かな', 'ひらがな'],
  KC_LNG2: ['eisu', '英数'],
  KC_INT4: ['henkan', 'convert', '変換'],
  KC_INT5: ['muhenkan', 'nonconvert', '無変換'],
  KC_INT2: ['katakana', 'hiragana', 'カタカナ'],
  KC_INT1: ['ro', 'ろ'],
  KC_INT3: ['yen', '円', '¥'],
  KC_BTN1: ['left click', 'mouse button 1', '左クリック'],
  KC_BTN2: ['right click', 'mouse button 2', '右クリック'],
  KC_BTN3: ['middle click', 'mouse button 3', '中クリック'],
  KC_BTN4: ['back', 'mouse back', '戻る'],
  KC_BTN5: ['forward', 'mouse forward', '進む'],
  KC_WH_U: ['wheel up', 'scroll up'],
  KC_WH_D: ['wheel down', 'scroll down'],
  KC_VOLU: ['volume up', '音量'],
  KC_VOLD: ['volume down', '音量'],
  KC_MUTE: ['mute', 'ミュート'],
  KC_MPLY: ['play', 'pause', '再生'],
  KC_MNXT: ['next track', '次の曲'],
  KC_MPRV: ['previous track', '前の曲'],
  KC_BRIU: ['brightness up', '明るさ'],
  KC_BRID: ['brightness down', '明るさ'],
  CPI_I100: ['cursor faster', 'cpi up'],
  CPI_D100: ['cursor slower', 'cpi down'],
  SCRL_TO: ['scroll mode', 'スクロール'],
  SCRL_MO: ['scroll while held', 'スクロール'],
  KC_TRNS: ['transparent', '透過'],
  KC_NO: ['none', 'no action', 'nothing', '無効'],
  QK_BOOT: ['bootloader', 'reset', 'ブート'],
  CW_TOGG: ['caps word'],
};

/** QMK's layer functions, which take a layer number. */
export const LAYER_FUNCTIONS = ['MO', 'TG', 'TO', 'TT', 'OSL', 'DF'];

/** One-shot modifiers, with what people call them. */
const ONE_SHOT: Record<string, string[]> = {
  'OSM(MOD_LCTL)': ['one-shot ctrl', 'one-shot control', 'ワンショット ctrl'],
  'OSM(MOD_LSFT)': ['one-shot shift', 'ワンショット shift', 'ワンショット シフト'],
  'OSM(MOD_LALT)': ['one-shot alt', 'one-shot option', 'ワンショット alt'],
  'OSM(MOD_LGUI)': ['one-shot gui', 'one-shot command', 'one-shot windows', 'ワンショット コマンド'],
};

interface CatalogueInput {
  /** Layer names (or null), for the layer keys. */
  layers: (string | null)[];
  /** The keymap's own keycodes (its custom_keycodes enum). */
  custom: string[];
  /** The keymap's #define aliases, such as TH_EISU. */
  defines?: Record<string, string>;
  labels: Record<string, { en?: string; ja?: string }>;
}

const lower = (words: (string | undefined)[]) => [...new Set(words.filter((w): w is string => !!w).map((w) => w.toLowerCase()))];

function wordsFor(code: string): string[] {
  const shifted = shiftedBase(code);
  const legend = shifted ? basicLegend(shifted, 'us', true) : basicLegend(code, 'us');
  return lower([
    code,
    code.replace(/^(KC|QK)_/, ''),
    legend,
    wordedLegend(code, 'en')?.tap,
    wordedLegend(code, 'ja')?.tap,
    ...(WORDS[code] ?? []),
  ]);
}

export function makeCatalogue({ layers, custom, defines = {}, labels }: CatalogueInput): Catalogue {
  const group = (codes: string[], category: Category): Entry[] => codes.map((code) => ({ code, category, words: wordsFor(code) }));
  const layerEntries: Entry[] = layers.flatMap((name, n) =>
    LAYER_FUNCTIONS.map((fn) => ({
      code: `${fn}(${n})`,
      category: 'layers' as const,
      words: lower([`${fn}(${n})`, `${fn} ${n}`, `layer ${n}`, name ?? undefined]),
    })),
  );
  const own: Entry[] = [
    ...custom.map((code) => ({ code, category: 'own' as const, words: lower([code, labels[code]?.en, labels[code]?.ja]) })),
    ...Object.keys(defines).map((code) => ({ code, category: 'own' as const, words: lower([code, labels[code]?.en, labels[code]?.ja]) })),
  ];
  const oneShot: Entry[] = Object.entries(ONE_SHOT).map(([code, words]) => ({ code, category: 'modifiers', words: lower([code, ...words]) }));
  return {
    entries: [
      ...group(LETTERS, 'letters'),
      ...group(NUMBERS, 'numbers'),
      ...group([...SYMBOLS, ...SHIFTED], 'symbols'),
      ...group(EDITING, 'editing'),
      ...group(MODIFIERS, 'modifiers'),
      ...oneShot,
      ...group(JAPANESE, 'japanese'),
      ...group(FUNCTION, 'function'),
      ...layerEntries,
      ...group(MOUSE, 'mouse'),
      ...group(MEDIA, 'media'),
      ...group(KEYBALL, 'keyball'),
      ...group(SPECIAL, 'special'),
      ...own,
    ],
  };
}

/**
 * Entries for a query, best first: a name typed in full (with or without KC_), then a word or
 * legend typed in full, then names and words that start with it, then words that contain every
 * typed word. Within a tier, catalogue order. Words of both languages are always searched.
 */
export function search(catalogue: Catalogue, query: string): Entry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const parts = q.split(/\s+/);
  const tier = (e: Entry): number => {
    const [code, bare] = e.words;
    if (code === q || bare === q) return 0;
    if (e.words.includes(q)) return 1;
    if (e.words.some((w) => w.startsWith(q))) return 2;
    if (parts.every((p) => e.words.some((w) => w.includes(p)))) return 3;
    return -1;
  };
  return catalogue.entries
    .map((entry, index) => ({ entry, index, tier: tier(entry) }))
    .filter((r) => r.tier >= 0)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((r) => r.entry);
}

// ---- tap and hold ------------------------------------------------------------------

export type Hold = { mods: Mod[]; right?: boolean } | { layer: number };

export interface TapHold {
  tap: string;
  /** Modifiers sent with the tap, as in C(KC_W). */
  withMods?: Mod[];
  hold?: Hold;
}

/** Keycodes QMK accepts as the tap of a mod-tap or layer-tap (basic keycodes). */
const BASIC = new Set([...LETTERS, ...NUMBERS, ...SYMBOLS, ...EDITING, ...MODIFIERS, ...JAPANESE, ...FUNCTION, ...MEDIA]);

const MOD_TAP_NAME: Record<Mod, string> = { ctrl: 'CTL_T', shift: 'SFT_T', alt: 'ALT_T', gui: 'GUI_T' };
const MOD_BIT: Record<Mod, string> = { ctrl: 'CTL', shift: 'SFT', alt: 'ALT', gui: 'GUI' };
const MOD_FUNCTION: Record<Mod, string> = { ctrl: 'C', shift: 'S', alt: 'A', gui: 'G' };
const MOD_ORDER: Mod[] = ['ctrl', 'shift', 'alt', 'gui'];
const RIGHT_MOD_TAPS = new Set(['RCTL_T', 'RSFT_T', 'RALT_T', 'RGUI_T', 'RCMD_T', 'RWIN_T', 'ROPT_T', 'ALGR_T']);

/** The keycode for a tap and hold, or why QMK cannot build it. */
export function compose({ tap, withMods, hold }: TapHold): { keycode: string } | { refused: MessageKey } {
  const mods = MOD_ORDER.filter((m) => withMods?.includes(m));
  if (!hold) {
    return { keycode: mods.reduceRight((inner, m) => `${MOD_FUNCTION[m]}(${inner})`, tap) };
  }
  // A hold key taps a basic keycode only: no modifiers with it, no shifted symbols, no custom keys.
  if (mods.length > 0 || !BASIC.has(tap)) return { refused: 'picker.err.notBasic' };
  if ('layer' in hold) {
    if (hold.layer > 15) return { refused: 'picker.err.layerTooHigh' };
    return { keycode: `LT(${hold.layer}, ${tap})` };
  }
  const held = MOD_ORDER.filter((m) => hold.mods.includes(m));
  const side = hold.right ? 'R' : 'L';
  if (held.length === 0) return { keycode: tap };
  if (held.length === 1) return { keycode: `${side}${MOD_TAP_NAME[held[0]]}(${tap})` };
  return { keycode: `MT(${held.map((m) => `MOD_${side}${MOD_BIT[m]}`).join(' | ')}, ${tap})` };
}

/** A key split into its tap, modifiers and hold, for the picker to start from. */
export function decompose(keycode: string): TapHold {
  const { name, args } = parseKeycode(keycode);
  if (name === 'LT' && args.length === 2 && Number.isInteger(Number(args[0].name))) {
    return { tap: args[1].name, hold: { layer: Number(args[0].name) } };
  }
  if (name === 'MT' && args.length === 2) {
    const right = args[0].name.split('|').every((bit) => bit.startsWith('MOD_R'));
    return { tap: args[1].name, hold: { mods: modMask(args[0].name), ...(right ? { right } : {}) } };
  }
  if (MOD_TAPS[name] && args.length === 1) {
    return { tap: args[0].name, hold: { mods: [...MOD_TAPS[name]], ...(RIGHT_MOD_TAPS.has(name) ? { right: true } : {}) } };
  }
  // Keys sent with modifiers: C(KC_W), LCA(KC_DEL), C(S(KC_A)).
  const mods: Mod[] = [];
  let inner = { name, args };
  while (MOD_FUNCTIONS[inner.name] && inner.args.length === 1) {
    mods.push(...MOD_FUNCTIONS[inner.name]);
    inner = inner.args[0];
  }
  if (mods.length > 0 && inner.args.length === 0) return { tap: inner.name, withMods: MOD_ORDER.filter((m) => mods.includes(m)) };
  return { tap: keycode };
}

/** Why a keycode typed by hand cannot go on a key: not one keycode, or a hold key QMK refuses. */
export function checkKeycode(text: string): MessageKey | undefined {
  const code = text.trim();
  if (!/^[A-Za-z_][\w]*(\(.*\))?$/.test(code)) return 'picker.err.notOneKey';
  let depth = 0;
  for (const ch of code) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return 'picker.err.notOneKey';
    if (depth < 0) return 'picker.err.notOneKey';
  }
  if (depth !== 0 || !/^[\w(), |]*$/.test(code)) return 'picker.err.notOneKey';
  const parts = decompose(code);
  if (!parts.hold) return undefined;
  const result = compose(parts);
  return 'refused' in result ? result.refused : undefined;
}

// ---- keys pressed on the computer --------------------------------------------------

const CODES: Record<string, string> = {
  Minus: 'KC_MINS', Equal: 'KC_EQL', BracketLeft: 'KC_LBRC', BracketRight: 'KC_RBRC', Backslash: 'KC_BSLS',
  Semicolon: 'KC_SCLN', Quote: 'KC_QUOT', Backquote: 'KC_GRV', Comma: 'KC_COMM', Period: 'KC_DOT', Slash: 'KC_SLSH',
  IntlBackslash: 'KC_NUBS', Space: 'KC_SPC', Enter: 'KC_ENT', Escape: 'KC_ESC', Backspace: 'KC_BSPC', Tab: 'KC_TAB',
  Delete: 'KC_DEL', Insert: 'KC_INS', Home: 'KC_HOME', End: 'KC_END', PageUp: 'KC_PGUP', PageDown: 'KC_PGDN',
  ArrowLeft: 'KC_LEFT', ArrowRight: 'KC_RGHT', ArrowUp: 'KC_UP', ArrowDown: 'KC_DOWN', CapsLock: 'KC_CAPS',
  ContextMenu: 'KC_APP', PrintScreen: 'KC_PSCR', ScrollLock: 'KC_SCRL', Pause: 'KC_PAUS',
  ShiftLeft: 'KC_LSFT', ShiftRight: 'KC_RSFT', ControlLeft: 'KC_LCTL', ControlRight: 'KC_RCTL',
  AltLeft: 'KC_LALT', AltRight: 'KC_RALT', MetaLeft: 'KC_LGUI', MetaRight: 'KC_RGUI',
  Lang1: 'KC_LNG1', Lang2: 'KC_LNG2', KanaMode: 'KC_INT2', Convert: 'KC_INT4', NonConvert: 'KC_INT5',
  IntlRo: 'KC_INT1', IntlYen: 'KC_INT3',
};

/** The keycode at a KeyboardEvent.code's position on a US keyboard, or null for keys QMK has no code for. */
export function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return `KC_${letter[1]}`;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return `KC_${digit[1]}`;
  const fn = /^F(\d{1,2})$/.exec(code);
  if (fn && Number(fn[1]) >= 1 && Number(fn[1]) <= 24) return `KC_F${fn[1]}`;
  return CODES[code] ?? null;
}
