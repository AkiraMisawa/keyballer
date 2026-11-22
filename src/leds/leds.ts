// LED settings for QMK's RGB Lighting (docs/plans/led-settings.md): the effects, as QMK 0.22.14
// numbers them (quantum/rgblight/rgblight_modes.h, rgblight.c), and an estimate of what LEDs
// cost in firmware size. Pure: no React, no files.

import type { MessageKey } from '../i18n/messages';

export type EffectId =
  | 'static'
  | 'breathing'
  | 'rainbowMood'
  | 'rainbowSwirl'
  | 'snake'
  | 'knight'
  | 'christmas'
  | 'gradient'
  | 'twinkle'
  | 'alternating';

/** What a variant of an effect changes: how fast, which way, how wide the colours spread, or whether they are random. */
export type AxisKind = 'speed' | 'direction' | 'spread' | 'colours';

export interface Effect {
  id: EffectId;
  label: MessageKey;
  /** RGB Lighting's mode name: RGBLIGHT_MODE_<mode>. */
  mode: string;
  /** The define that compiles the effect in; the static colour needs none. */
  define: string | null;
  /** Its variants as a number in these axes, the first the most significant (as rgblight.c reads delta). */
  axes: { kind: AxisKind; size: number }[];
  /** Bytes of its own (see `ledCost`). */
  own: number;
  /** Whether it uses RGB Lighting's animation code, which all animated effects share. */
  animated: boolean;
}

/**
 * The effects. Speeds go from slow to fast: rgblight.c's interval tables start with the longest
 * interval. Own costs are from builds of am338 on Keyball+ measured on Actions (2026-11-22).
 */
export const EFFECTS: readonly Effect[] = [
  { id: 'static', label: 'legend.ledPlain', mode: 'STATIC_LIGHT', define: null, axes: [], own: 0, animated: false },
  { id: 'breathing', label: 'legend.ledBreathing', mode: 'BREATHING', define: 'RGBLIGHT_EFFECT_BREATHING', axes: [{ kind: 'speed', size: 4 }], own: 333, animated: true },
  { id: 'rainbowMood', label: 'legend.ledRainbow', mode: 'RAINBOW_MOOD', define: 'RGBLIGHT_EFFECT_RAINBOW_MOOD', axes: [{ kind: 'speed', size: 3 }], own: 65, animated: true },
  {
    id: 'rainbowSwirl', label: 'legend.ledSwirl', mode: 'RAINBOW_SWIRL', define: 'RGBLIGHT_EFFECT_RAINBOW_SWIRL',
    axes: [{ kind: 'speed', size: 3 }, { kind: 'direction', size: 2 }], own: 117, animated: true,
  },
  {
    id: 'snake', label: 'legend.ledSnake', mode: 'SNAKE', define: 'RGBLIGHT_EFFECT_SNAKE',
    axes: [{ kind: 'speed', size: 3 }, { kind: 'direction', size: 2 }], own: 261, animated: true,
  },
  { id: 'knight', label: 'legend.ledKnight', mode: 'KNIGHT', define: 'RGBLIGHT_EFFECT_KNIGHT', axes: [{ kind: 'speed', size: 3 }], own: 247, animated: true },
  { id: 'christmas', label: 'legend.ledChristmas', mode: 'CHRISTMAS', define: 'RGBLIGHT_EFFECT_CHRISTMAS', axes: [], own: 289, animated: true },
  {
    id: 'gradient', label: 'legend.ledGradient', mode: 'STATIC_GRADIENT', define: 'RGBLIGHT_EFFECT_STATIC_GRADIENT',
    axes: [{ kind: 'spread', size: 5 }, { kind: 'direction', size: 2 }], own: 254, animated: false,
  },
  {
    id: 'twinkle', label: 'legend.ledTwinkle', mode: 'TWINKLE', define: 'RGBLIGHT_EFFECT_TWINKLE',
    axes: [{ kind: 'colours', size: 2 }, { kind: 'speed', size: 3 }], own: 973, animated: true,
  },
  { id: 'alternating', label: 'legend.ledAlternating', mode: 'ALTERNATING', define: 'RGBLIGHT_EFFECT_ALTERNATING', axes: [], own: 49, animated: true },
];

export const effectOf = (id: EffectId): Effect => EFFECTS.find((e) => e.id === id)!;

export interface LedMode {
  effect: EffectId;
  variant: number;
}

export const variantCount = (id: EffectId) => effectOf(id).axes.reduce((n, a) => n * a.size, 1);

/** `RGBLIGHT_MODE_BREATHING + 2`, as RGBLIGHT_DEFAULT_MODE is written. */
export function modeText({ effect, variant }: LedMode): string {
  const name = `RGBLIGHT_MODE_${effectOf(effect).mode}`;
  return variant === 0 ? name : `${name} + ${variant}`;
}

/** The mode config.h sets, or the static colour when it sets none; null when it is written some other way. */
export function readMode(text: string | undefined): LedMode | null {
  if (text === undefined) return { effect: 'static', variant: 0 };
  const m = /^\(?\s*RGBLIGHT_MODE_([A-Z_]+)\s*(?:\+\s*(\d{1,2})\s*)?\)?$/.exec(text.trim());
  const effect = m ? EFFECTS.find((e) => e.mode === m[1]) : undefined;
  if (!m || !effect) return null;
  const variant = Number(m[2] ?? 0);
  return variant < variantCount(effect.id) ? { effect: effect.id, variant } : null;
}

/** A variant as a value on each of the effect's axes. */
export function axesOf(id: EffectId, variant: number): number[] {
  const out: number[] = [];
  let rest = variant;
  for (const axis of [...effectOf(id).axes].reverse()) {
    out.unshift(rest % axis.size);
    rest = Math.floor(rest / axis.size);
  }
  return out;
}

export function variantOf(id: EffectId, values: number[]): number {
  return effectOf(id).axes.reduce((n, axis, i) => n * axis.size + Math.min(Math.max(values[i] ?? 0, 0), axis.size - 1), 0);
}

// ---- firmware size ------------------------------------------------------------------

/** RGB Lighting with the static colour only: 26,282 bytes against 23,838 without LEDs. */
export const LED_COST = 2444;
/** The animation code every animated effect shares (fitted to the build with all nine effects). */
export const ANIMATION_COST = 595;
/**
 * The LED part of keymap.c's stamps block, which builds only with LEDs: Keyball+ measured 26,604
 * bytes with LEDs and the block, against 23,940 without LEDs (23,838 plus the block's 102 bytes
 * that Keyball39 measured).
 */
export const LED_STAMP_COST = 220;

/** What decides the LEDs' share of the firmware. */
export interface LedSize {
  leds: boolean;
  /** The effects compiled in, besides the static colour. */
  effects: EffectId[];
  /** Whether keymap.c has the stamps block. */
  stamp: boolean;
}

/** Bytes the LEDs add to the firmware. */
export function ledCost({ leds, effects, stamp }: LedSize): number {
  if (!leds) return 0;
  const included = EFFECTS.filter((e) => effects.includes(e.id));
  return LED_COST + (stamp ? LED_STAMP_COST : 0) + (included.some((e) => e.animated) ? ANIMATION_COST : 0) + included.reduce((n, e) => n + e.own, 0);
}

/** The firmware size after a change of LED settings, from the latest build's size and settings. */
export const estimateSize = (built: number, was: LedSize, now: LedSize) => built - ledCost(was) + ledCost(now);
