// QMK keycode names → what a keycap prints. Used by the keymap view model.
// Names that are the same in every language (Esc, Tab, 英数) live here; words
// that change with the language live in src/i18n/messages.ts as legend.*.

import { translate, type Lang } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';

/** The keyboard layout the OS is set to: it decides which character a key position types. */
export type Layout = 'us' | 'jis' | 'uk';
export const LAYOUTS: Layout[] = ['us', 'jis', 'uk'];
export type Os = 'mac' | 'windows';
export const OSES: Os[] = ['mac', 'windows'];
export type Mod = 'ctrl' | 'alt' | 'shift' | 'gui';

/**
 * Keys whose character depends on the OS keyboard layout: [unshifted, shifted]. UK is Windows'
 * United Kingdom layout (macOS calls it British – PC). Windows reads the US backslash (HID 0x31)
 * and the ISO hash key (HID 0x32) as the same key.
 */
const CHARACTER_KEYS: Record<string, Record<Layout, [string, string | null]>> = {
  KC_1: { us: ['1', '!'], jis: ['1', '!'], uk: ['1', '!'] },
  KC_2: { us: ['2', '@'], jis: ['2', '"'], uk: ['2', '"'] },
  KC_3: { us: ['3', '#'], jis: ['3', '#'], uk: ['3', '£'] },
  KC_4: { us: ['4', '$'], jis: ['4', '$'], uk: ['4', '$'] },
  KC_5: { us: ['5', '%'], jis: ['5', '%'], uk: ['5', '%'] },
  KC_6: { us: ['6', '^'], jis: ['6', '&'], uk: ['6', '^'] },
  KC_7: { us: ['7', '&'], jis: ['7', "'"], uk: ['7', '&'] },
  KC_8: { us: ['8', '*'], jis: ['8', '('], uk: ['8', '*'] },
  KC_9: { us: ['9', '('], jis: ['9', ')'], uk: ['9', '('] },
  KC_0: { us: ['0', ')'], jis: ['0', null], uk: ['0', ')'] },
  KC_MINS: { us: ['-', '_'], jis: ['-', '='], uk: ['-', '_'] },
  KC_EQL: { us: ['=', '+'], jis: ['^', '~'], uk: ['=', '+'] },
  KC_LBRC: { us: ['[', '{'], jis: ['@', '`'], uk: ['[', '{'] },
  KC_RBRC: { us: [']', '}'], jis: ['[', '{'], uk: [']', '}'] },
  KC_BSLS: { us: ['\\', '|'], jis: [']', '}'], uk: ['#', '~'] },
  KC_NUHS: { us: ['\\', '|'], jis: [']', '}'], uk: ['#', '~'] },
  KC_SCLN: { us: [';', ':'], jis: [';', '+'], uk: [';', ':'] },
  KC_QUOT: { us: ["'", '"'], jis: [':', '*'], uk: ["'", '@'] },
  KC_GRV: { us: ['`', '~'], jis: ['半/全', null], uk: ['`', '¬'] },
  KC_COMM: { us: [',', '<'], jis: [',', '<'], uk: [',', '<'] },
  KC_DOT: { us: ['.', '>'], jis: ['.', '>'], uk: ['.', '>'] },
  KC_SLSH: { us: ['/', '?'], jis: ['/', '?'], uk: ['/', '?'] },
  KC_NUBS: { us: ['\\', '|'], jis: ['\\', '|'], uk: ['\\', '|'] },
};

/** Long and alternative names QMK accepts. */
const ALIASES: Record<string, string> = {
  KC_MINUS: 'KC_MINS', KC_EQUAL: 'KC_EQL', KC_LEFT_BRACKET: 'KC_LBRC', KC_RIGHT_BRACKET: 'KC_RBRC',
  KC_BACKSLASH: 'KC_BSLS', KC_NONUS_HASH: 'KC_NUHS', KC_SEMICOLON: 'KC_SCLN', KC_QUOTE: 'KC_QUOT',
  KC_GRAVE: 'KC_GRV', KC_COMMA: 'KC_COMM', KC_SLASH: 'KC_SLSH', KC_NONUS_BACKSLASH: 'KC_NUBS',
  KC_ENTER: 'KC_ENT', KC_ESCAPE: 'KC_ESC', KC_BACKSPACE: 'KC_BSPC', KC_SPACE: 'KC_SPC',
  KC_DELETE: 'KC_DEL', KC_INSERT: 'KC_INS', KC_PAGE_UP: 'KC_PGUP', KC_PAGE_DOWN: 'KC_PGDN',
  KC_RIGHT: 'KC_RGHT', KC_CAPS_LOCK: 'KC_CAPS', KC_APPLICATION: 'KC_APP', KC_PRINT_SCREEN: 'KC_PSCR',
  KC_LEFT_CTRL: 'KC_LCTL', KC_RIGHT_CTRL: 'KC_RCTL', KC_LEFT_SHIFT: 'KC_LSFT', KC_RIGHT_SHIFT: 'KC_RSFT',
  KC_LEFT_ALT: 'KC_LALT', KC_RIGHT_ALT: 'KC_RALT', KC_LEFT_GUI: 'KC_LGUI', KC_RIGHT_GUI: 'KC_RGUI',
  KC_LOPT: 'KC_LALT', KC_ROPT: 'KC_RALT', KC_ALGR: 'KC_RALT', KC_LCMD: 'KC_LGUI', KC_RCMD: 'KC_RGUI',
  KC_LWIN: 'KC_LGUI', KC_RWIN: 'KC_RGUI', KC_LANGUAGE_1: 'KC_LNG1', KC_LANGUAGE_2: 'KC_LNG2',
  KC_INTERNATIONAL_1: 'KC_INT1', KC_INTERNATIONAL_2: 'KC_INT2', KC_INTERNATIONAL_3: 'KC_INT3',
  KC_INTERNATIONAL_4: 'KC_INT4', KC_INTERNATIONAL_5: 'KC_INT5',
  KC_KP_0: 'KC_P0', KC_KP_1: 'KC_P1', KC_KP_2: 'KC_P2', KC_KP_3: 'KC_P3', KC_KP_4: 'KC_P4',
  KC_KP_5: 'KC_P5', KC_KP_6: 'KC_P6', KC_KP_7: 'KC_P7', KC_KP_8: 'KC_P8', KC_KP_9: 'KC_P9',
  KC_KP_DOT: 'KC_PDOT', KC_KP_SLASH: 'KC_PSLS', KC_KP_ASTERISK: 'KC_PAST', KC_KP_MINUS: 'KC_PMNS',
  KC_KP_PLUS: 'KC_PPLS', KC_KP_ENTER: 'KC_PENT', KC_KP_EQUAL: 'KC_PEQL',
  KC_MS_BTN1: 'KC_BTN1', KC_MS_BTN2: 'KC_BTN2', KC_MS_BTN3: 'KC_BTN3', KC_MS_BTN4: 'KC_BTN4',
  KC_MS_BTN5: 'KC_BTN5', MS_BTN1: 'KC_BTN1', MS_BTN2: 'KC_BTN2', MS_BTN3: 'KC_BTN3',
  MS_BTN4: 'KC_BTN4', MS_BTN5: 'KC_BTN5', KC_MS_UP: 'KC_MS_U', KC_MS_DOWN: 'KC_MS_D',
  KC_MS_LEFT: 'KC_MS_L', KC_MS_RIGHT: 'KC_MS_R', KC_MS_WH_UP: 'KC_WH_U', KC_MS_WH_DOWN: 'KC_WH_D',
  KC_MS_WH_LEFT: 'KC_WH_L', KC_MS_WH_RIGHT: 'KC_WH_R', MS_WHLU: 'KC_WH_U', MS_WHLD: 'KC_WH_D',
  MS_WHLL: 'KC_WH_L', MS_WHLR: 'KC_WH_R', QK_BOOTLOADER: 'QK_BOOT', RESET: 'QK_BOOT',
  QK_CLEAR_EEPROM: 'EE_CLR', QK_REBOOT: 'QK_RBT', CAPS_WORD: 'CW_TOGG',
};

/** Shifted-character names, as the key they shift. */
const SHIFTED: Record<string, string> = {
  KC_TILD: 'KC_GRV', KC_TILDE: 'KC_GRV', KC_EXLM: 'KC_1', KC_EXCLAIM: 'KC_1', KC_AT: 'KC_2',
  KC_HASH: 'KC_3', KC_DLR: 'KC_4', KC_DOLLAR: 'KC_4', KC_PERC: 'KC_5', KC_PERCENT: 'KC_5',
  KC_CIRC: 'KC_6', KC_CIRCUMFLEX: 'KC_6', KC_AMPR: 'KC_7', KC_AMPERSAND: 'KC_7', KC_ASTR: 'KC_8',
  KC_ASTERISK: 'KC_8', KC_LPRN: 'KC_9', KC_LEFT_PAREN: 'KC_9', KC_RPRN: 'KC_0', KC_RIGHT_PAREN: 'KC_0',
  KC_UNDS: 'KC_MINS', KC_UNDERSCORE: 'KC_MINS', KC_PLUS: 'KC_EQL', KC_LCBR: 'KC_LBRC',
  KC_LEFT_CURLY_BRACE: 'KC_LBRC', KC_RCBR: 'KC_RBRC', KC_RIGHT_CURLY_BRACE: 'KC_RBRC',
  KC_PIPE: 'KC_BSLS', KC_COLN: 'KC_SCLN', KC_COLON: 'KC_SCLN', KC_DQUO: 'KC_QUOT', KC_DQT: 'KC_QUOT',
  KC_DOUBLE_QUOTE: 'KC_QUOT', KC_LT: 'KC_COMM', KC_LABK: 'KC_COMM', KC_LEFT_ANGLE_BRACKET: 'KC_COMM',
  KC_GT: 'KC_DOT', KC_RABK: 'KC_DOT', KC_RIGHT_ANGLE_BRACKET: 'KC_DOT', KC_QUES: 'KC_SLSH',
  KC_QUESTION: 'KC_SLSH',
};

/** Keys printed the same in every language and layout. */
const NAMED: Record<string, string> = {
  KC_ENT: 'Enter', KC_ESC: 'Esc', KC_BSPC: 'Bksp', KC_TAB: 'Tab', KC_SPC: 'Space', KC_DEL: 'Del',
  KC_INS: 'Ins', KC_HOME: 'Home', KC_END: 'End', KC_PGUP: 'PgUp', KC_PGDN: 'PgDn',
  KC_LEFT: '←', KC_RGHT: '→', KC_UP: '↑', KC_DOWN: '↓', KC_CAPS: 'Caps', KC_APP: 'Menu',
  KC_PSCR: 'PrtSc', KC_SCRL: 'ScrLk', KC_PAUS: 'Pause', KC_NUM: 'NumLk',
  KC_VOLU: 'Vol+', KC_VOLD: 'Vol−', KC_MUTE: 'Mute', KC_MPLY: 'Play', KC_MNXT: 'Next', KC_MPRV: 'Prev',
  KC_MSTP: 'Stop', KC_BRIU: 'Bright+', KC_BRID: 'Bright−',
  KC_LNG1: 'かな', KC_LNG2: '英数', KC_INT1: 'ろ', KC_INT2: 'カタカナ', KC_INT3: '¥', KC_INT4: '変換',
  KC_INT5: '無変換',
  KC_P0: '0', KC_P1: '1', KC_P2: '2', KC_P3: '3', KC_P4: '4', KC_P5: '5', KC_P6: '6', KC_P7: '7',
  KC_P8: '8', KC_P9: '9', KC_PDOT: '.', KC_PSLS: '/', KC_PAST: '*', KC_PMNS: '-', KC_PPLS: '+',
  KC_PENT: 'Enter', KC_PEQL: '=',
};

const MODIFIER_KEYS: Record<string, Mod> = {
  KC_LCTL: 'ctrl', KC_RCTL: 'ctrl', KC_LSFT: 'shift', KC_RSFT: 'shift',
  KC_LALT: 'alt', KC_RALT: 'alt', KC_LGUI: 'gui', KC_RGUI: 'gui',
};

/** Functions that add modifiers to a key: `S(KC_TAB)`, `LCA(KC_DEL)`. */
export const MOD_FUNCTIONS: Record<string, Mod[]> = {
  S: ['shift'], LSFT: ['shift'], RSFT: ['shift'],
  C: ['ctrl'], LCTL: ['ctrl'], RCTL: ['ctrl'],
  A: ['alt'], LALT: ['alt'], RALT: ['alt'], LOPT: ['alt'], ROPT: ['alt'], ALGR: ['alt'],
  G: ['gui'], LGUI: ['gui'], RGUI: ['gui'], LCMD: ['gui'], RCMD: ['gui'], LWIN: ['gui'], RWIN: ['gui'],
  LCA: ['ctrl', 'alt'], LSG: ['shift', 'gui'], SGUI: ['shift', 'gui'], SCMD: ['shift', 'gui'],
  SWIN: ['shift', 'gui'], LAG: ['alt', 'gui'], RAG: ['alt', 'gui'], C_S: ['ctrl', 'shift'],
  LCS: ['ctrl', 'shift'], RCS: ['ctrl', 'shift'], LSA: ['shift', 'alt'], RSA: ['shift', 'alt'],
  LCG: ['ctrl', 'gui'], RCG: ['ctrl', 'gui'], LCAG: ['ctrl', 'alt', 'gui'], MEH: ['ctrl', 'shift', 'alt'],
  HYPR: ['ctrl', 'shift', 'alt', 'gui'],
};

/** Mod-tap functions: the modifier held, the key tapped. */
export const MOD_TAPS: Record<string, Mod[]> = {
  LCTL_T: ['ctrl'], CTL_T: ['ctrl'], RCTL_T: ['ctrl'],
  LSFT_T: ['shift'], SFT_T: ['shift'], RSFT_T: ['shift'],
  LALT_T: ['alt'], ALT_T: ['alt'], RALT_T: ['alt'], LOPT_T: ['alt'], OPT_T: ['alt'], ROPT_T: ['alt'],
  ALGR_T: ['alt'],
  LGUI_T: ['gui'], GUI_T: ['gui'], RGUI_T: ['gui'], LCMD_T: ['gui'], CMD_T: ['gui'], RCMD_T: ['gui'],
  LWIN_T: ['gui'], WIN_T: ['gui'], RWIN_T: ['gui'],
  LCA_T: ['ctrl', 'alt'], LSG_T: ['shift', 'gui'], SGUI_T: ['shift', 'gui'], LAG_T: ['alt', 'gui'],
  RAG_T: ['alt', 'gui'], C_S_T: ['ctrl', 'shift'], LCAG_T: ['ctrl', 'alt', 'gui'],
  MEH_T: ['ctrl', 'shift', 'alt'], HYPR_T: ['ctrl', 'shift', 'alt', 'gui'], ALL_T: ['ctrl', 'shift', 'alt', 'gui'],
};

/** `MOD_LCTL|MOD_LALT` (an OSM argument) → ['ctrl', 'alt']. */
export function modMask(text: string): Mod[] {
  const bits: Record<string, Mod[]> = {
    MOD_LCTL: ['ctrl'], MOD_RCTL: ['ctrl'], MOD_LSFT: ['shift'], MOD_RSFT: ['shift'],
    MOD_LALT: ['alt'], MOD_RALT: ['alt'], MOD_LGUI: ['gui'], MOD_RGUI: ['gui'],
    MOD_MEH: ['ctrl', 'shift', 'alt'], MOD_HYPR: ['ctrl', 'shift', 'alt', 'gui'],
  };
  return text.split('|').flatMap((part) => bits[part] ?? []);
}

// Each OS's own way of writing modifiers: Mac keycaps and menus use symbols in Apple's order;
// Windows writes names joined by "+", with the Windows key first (Win+Shift+S, Ctrl+Alt+Del).
const MAC_SYMBOL: Record<Mod, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', gui: '⌘' };
const WINDOWS_NAME: Record<Mod, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', gui: 'Win' };
const ORDER: Record<Os, Mod[]> = {
  mac: ['ctrl', 'alt', 'shift', 'gui'],
  windows: ['gui', 'ctrl', 'alt', 'shift'],
};

function ordered(mods: Mod[], os: Os): string[] {
  return ORDER[os].filter((m) => mods.includes(m)).map((m) => (os === 'mac' ? MAC_SYMBOL[m] : WINDOWS_NAME[m]));
}

/** Modifiers on their own: "⌃⌥" on Mac, "Ctrl+Alt" on Windows. */
export function modsWord(mods: Mod[], os: Os): string {
  return ordered(mods, os).join(os === 'mac' ? '' : '+');
}

/** A key with modifiers, as each OS writes a shortcut: "⌃⌥Del" or "Ctrl+Alt+Del". */
export function withMods(mods: Mod[], key: string, os: Os): string {
  if (mods.length === 0) return key;
  return os === 'mac' ? modsWord(mods, os) + key : [...ordered(mods, os), key].join('+');
}

/** Mac modifier symbols, spelled out for screen readers. */
export const SPOKEN_SYMBOLS: Record<string, string> = { '⌃': 'Control ', '⌥': 'Option ', '⇧': 'Shift ', '⌘': 'Command ' };

export const TRANSPARENT = new Set(['KC_TRNS', 'KC_TRANSPARENT', '_______']);
export const NO_ACTION = new Set(['KC_NO', 'XXXXXXX']);

export const canonical = (name: string) => ALIASES[name] ?? name;

export function modifierKey(name: string): Mod | undefined {
  return MODIFIER_KEYS[canonical(name)];
}

/** The key a shifted-character name shifts (KC_AT → KC_2), if it is one. */
export function shiftedBase(name: string): string | undefined {
  return SHIFTED[canonical(name)];
}

/** What a basic key prints, with or without shift; undefined when it is not a basic key. */
export function basicLegend(name: string, layout: Layout, shifted = false): string | undefined {
  const key = canonical(name);
  const letter = /^KC_([A-Z])$/.exec(key);
  if (letter) return letter[1];
  const fn = /^KC_F([1-9]|1[0-9]|2[0-4])$/.exec(key);
  if (fn) return `F${fn[1]}`;
  const chars = CHARACTER_KEYS[key];
  if (chars) {
    const [plain, upper] = chars[layout];
    return shifted ? (upper ?? undefined) : plain;
  }
  return shifted ? undefined : NAMED[key];
}

// ---- words that change with the language (src/i18n/messages.ts) ----------

/** A legend part: a message to translate, or text that reads the same in every language. */
type Part = MessageKey | { text: string };

const WORDED: Record<string, { tap: Part; top?: Part }> = {
  KC_BTN1: { tap: 'legend.lClick' },
  KC_BTN2: { tap: 'legend.rClick' },
  KC_BTN3: { tap: 'legend.mClick' },
  KC_BTN4: { tap: 'legend.back' },
  KC_BTN5: { tap: 'legend.forward' },
  KC_MS_U: { tap: 'legend.mouseUp' },
  KC_MS_D: { tap: 'legend.mouseDown' },
  KC_MS_L: { tap: 'legend.mouseLeft' },
  KC_MS_R: { tap: 'legend.mouseRight' },
  KC_WH_U: { tap: 'legend.wheelUp' },
  KC_WH_D: { tap: 'legend.wheelDown' },
  KC_WH_L: { tap: 'legend.wheelLeft' },
  KC_WH_R: { tap: 'legend.wheelRight' },
  // Keyball (Yowkees/keyball qmk_firmware/keyboards/keyball/lib/keyball/keyball.h)
  CPI_I100: { tap: { text: 'CPI' }, top: { text: '+100' } },
  CPI_D100: { tap: { text: 'CPI' }, top: { text: '−100' } },
  CPI_I1K: { tap: { text: 'CPI' }, top: { text: '+1000' } },
  CPI_D1K: { tap: { text: 'CPI' }, top: { text: '−1000' } },
  SCRL_TO: { tap: 'legend.scroll', top: 'legend.toggle' },
  SCRL_MO: { tap: 'legend.scroll', top: 'legend.whileHeld' },
  SCRL_DVI: { tap: 'legend.scroll', top: 'legend.slower' },
  SCRL_DVD: { tap: 'legend.scroll', top: 'legend.faster' },
  SSNP_VRT: { tap: 'legend.snap', top: 'legend.vertical' },
  SSNP_HOR: { tap: 'legend.snap', top: 'legend.horizontal' },
  SSNP_FRE: { tap: 'legend.snap', top: 'legend.free' },
  AML_TO: { tap: { text: 'AML' }, top: 'legend.toggle' },
  AML_I50: { tap: { text: 'AML' }, top: { text: '+50ms' } },
  AML_D50: { tap: { text: 'AML' }, top: { text: '−50ms' } },
  KBC_RST: { tap: 'legend.reset', top: { text: 'Keyball' } },
  KBC_SAVE: { tap: 'legend.save', top: { text: 'Keyball' } },
  // QMK
  QK_BOOT: { tap: 'legend.boot' },
  EE_CLR: { tap: 'legend.clear', top: { text: 'EEPROM' } },
  QK_RBT: { tap: 'legend.reboot' },
  CW_TOGG: { tap: { text: 'Caps word' } },
};

const say = (part: Part, lang: Lang) => (typeof part === 'string' ? translate(lang, part) : part.text);

/** A legend whose words depend on the display language, or undefined when the key has none. */
export function wordedLegend(name: string, lang: Lang): { tap: string; top?: string } | undefined {
  const entry = WORDED[canonical(name)];
  if (!entry) return undefined;
  return entry.top === undefined
    ? { tap: say(entry.tap, lang) }
    : { tap: say(entry.tap, lang), top: say(entry.top, lang) };
}

/** What each layer function does, for the top line; MO needs no word. */
const LAYER_ACTIONS: Record<string, MessageKey | null> = {
  MO: null,
  TG: 'legend.toggle',
  TO: 'legend.goTo',
  TT: 'legend.tapToggle',
  OSL: 'legend.oneShot',
  DF: 'legend.default',
};

export const isLayerFunction = (name: string) => name in LAYER_ACTIONS;

export function layerActionWord(name: string, lang: Lang): string | undefined {
  const key = LAYER_ACTIONS[name];
  return key ? translate(lang, key) : undefined;
}

/** What the trackball does on a layer: the configured word, translated when it is a known one. */
export function ballModeWord(mode: string, lang: Lang): string {
  const known: Record<string, MessageKey> = { cursor: 'legend.cursor', scroll: 'legend.scroll' };
  const key = known[mode.toLowerCase()];
  return key ? translate(lang, key) : mode;
}
