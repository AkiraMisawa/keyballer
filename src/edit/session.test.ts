// An edit session: the files read from the config repository, the changes made
// on screen, undo and redo, and what a save would commit. Fixtures are the real
// am338 config.h and keyballer.json.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, currentFiles, ledEffectsValue, ledModeValue, leds, openSession, rebase, redo, review, trackball, undo, type Edit, type Session } from './session';

const fixture = (name: string) =>
  readFileSync(new URL(`../config/fixtures/${name}`, import.meta.url), 'utf8');

const am338 = (): Session =>
  openSession({
    commit: 'base000',
    buildId: 'keyballplus',
    keymapDir: 'keymaps/am338',
    files: {
      'keymaps/am338/config.h': fixture('am338.config.h'),
      'keyballer.json': fixture('keyballer.json'),
    },
  });

describe('trackball settings in a session', () => {
  it('starts from what the files say, with Keyball and Keyball+ defaults for what they leave out', () => {
    expect(trackball(am338())).toEqual({ cpi: 700, divider: 4, ballMm: 34 });
    const bare = openSession({
      commit: 'base000',
      buildId: 'keyballplus',
      keymapDir: 'keymaps/am338',
      files: { 'keymaps/am338/config.h': '#pragma once\n', 'keyballer.json': fixture('keyballer.json') },
    });
    // keyball.h: KEYBALL_CPI_DEFAULT 500, KEYBALL_SCROLL_DIV_DEFAULT 4; Keyball's ball is 34 mm.
    expect(trackball(bare)).toEqual({ cpi: 500, divider: 4, ballMm: 34 });
  });

  it('has nothing to save until something changes', () => {
    expect(review(am338())).toEqual({ changes: [], keys: [], combos: [], layers: [], files: [], message: '' });
  });

  it('shows a change as before and after, the file diff, and a commit message', () => {
    const s = apply(am338(), { type: 'cpi', value: 900 });
    const r = review(s);
    expect(r.changes).toEqual([{ setting: 'cpi', from: 700, to: 900 }]);
    expect(r.files).toEqual([
      {
        path: 'keymaps/am338/config.h',
        diff: [
          '@@ -22,7 +22,7 @@',
          ' ',
          ' #define TAP_CODE_DELAY 5',
          ' ',
          '-#define KEYBALL_CPI_DEFAULT 700',
          '+#define KEYBALL_CPI_DEFAULT 900',
          ' #define KEYBALL_SCROLL_DIV_DEFAULT 4',
          ' ',
          ' // Tap-hold behaviour matching roBa (ZMK): 200ms tapping term, no quick-tap',
        ].join('\n'),
      },
    ]);
    expect(r.message).toBe('Set the cursor speed to 900 CPI');
  });

  it('puts every changed file and setting into one review', () => {
    let s = apply(am338(), { type: 'cpi', value: 900 });
    s = apply(s, { type: 'divider', value: 3 });
    s = apply(s, { type: 'ballMm', value: 25 });
    const r = review(s);
    expect(r.changes).toEqual([
      { setting: 'cpi', from: 700, to: 900 },
      { setting: 'divider', from: 4, to: 3 },
      { setting: 'ballMm', from: 34, to: 25 },
    ]);
    expect(r.files.map((f) => f.path)).toEqual(['keymaps/am338/config.h', 'keyballer.json']);
    expect(r.message).toBe('Set the cursor speed to 900 CPI, the scroll divider to 3 and the ball size of keyballplus to 25 mm');
    expect(r.files[1].diff).toBe(
      ['@@ -18,7 +18,8 @@', '       "keyboard": "keyball/keyballplus",', '       "keymap": "am338",', '       "keymap_dir": "keymaps/am338",',
        '-      "ball": "right"', '+      "ball": "right",', '+      "ball_mm": 25', '     },', '     {', '       "id": "keyball39",'].join('\n'),
    );
  });

  it('drops a change that goes back to the saved value', () => {
    let s = apply(am338(), { type: 'cpi', value: 900 });
    s = apply(s, { type: 'divider', value: 3 });
    s = apply(s, { type: 'cpi', value: 700 });
    expect(review(s).changes).toEqual([{ setting: 'divider', from: 4, to: 3 }]);
    expect(review(s).message).toBe('Set the scroll divider to 3');
  });

  it('undoes and redoes, and a new change clears what could be redone', () => {
    let s = apply(am338(), { type: 'cpi', value: 900 });
    s = apply(s, { type: 'divider', value: 3 });
    s = undo(s);
    expect(trackball(s)).toEqual({ cpi: 900, divider: 4, ballMm: 34 });
    s = undo(s);
    expect(trackball(s).cpi).toBe(700);
    expect(undo(s)).toBe(s); // nothing more to undo
    s = redo(s);
    expect(trackball(s).cpi).toBe(900);
    s = apply(s, { type: 'ballMm', value: 25 });
    expect(redo(s)).toBe(s); // the undone divider change is gone
  });

  it('treats moving one slider several times in a row as one step to undo', () => {
    let s = apply(am338(), { type: 'cpi', value: 800 });
    s = apply(s, { type: 'cpi', value: 900 });
    s = apply(s, { type: 'cpi', value: 1000 });
    expect(trackball(undo(s)).cpi).toBe(700);
  });

  it('re-applies the changes to newer files when the repository moved on', () => {
    const s = apply(am338(), { type: 'cpi', value: 900 });
    const newer = {
      ...s.base,
      commit: 'newer00',
      files: { ...s.base.files, 'keymaps/am338/config.h': s.base.files['keymaps/am338/config.h'].replace('KEYBALL_CPI_DEFAULT 700', 'KEYBALL_CPI_DEFAULT 800') },
    };
    const moved = rebase(s, newer);
    expect(moved.base.commit).toBe('newer00');
    expect(review(moved).changes).toEqual([{ setting: 'cpi', from: 800, to: 900 }]);
  });
});

describe('LED settings in a session (docs/plans/led-settings.md)', () => {
  const withRules = (rules = fixture('am338.rules.mk'), config = fixture('am338.config.h')): Session =>
    openSession({
      commit: 'base000',
      buildId: 'keyballplus',
      keymapDir: 'keymaps/am338',
      files: { 'keymaps/am338/config.h': config, 'keymaps/am338/rules.mk': rules, 'keyballer.json': fixture('keyballer.json') },
    });
  const configOf = (s: Session) => currentFiles(s)['keymaps/am338/config.h'];

  it('starts from what the files say, with QMK’s defaults and Keyball’s brightness limit for the rest', () => {
    // am338's rules.mk has RGBLIGHT_ENABLE = no and keyballer.json no "leds".
    expect(leds(withRules())).toEqual({
      fitted: false, mode: { effect: 'static', variant: 0 }, hue: 0, sat: 255, val: 150, startOn: true, effects: [], limit: 150,
    });
    expect(leds(withRules('RGBLIGHT_ENABLE = yes\n')).fitted).toBe(true);
    const set = withRules(undefined, `${fixture('am338.config.h')}#define RGBLIGHT_DEFAULT_MODE RGBLIGHT_MODE_TWINKLE + 4\n#define RGBLIGHT_EFFECT_TWINKLE\n#define RGBLIGHT_DEFAULT_VAL 90\n#define KEYBALLER_LEDS_OFF\n`);
    expect(leds(set)).toMatchObject({ mode: { effect: 'twinkle', variant: 4 }, val: 90, startOn: false, effects: ['twinkle'] });
    // A mode written another way is shown as unknown, not guessed.
    expect(leds(withRules(undefined, '#define RGBLIGHT_DEFAULT_MODE 3\n')).mode).toBeNull();
  });

  it('says per build whether the board has LEDs, in keyballer.json', () => {
    const s = apply(withRules(), { type: 'leds', value: 1 });
    expect(leds(s).fitted).toBe(true);
    const json = JSON.parse(currentFiles(s)['keyballer.json']) as { builds: { id: string; leds?: boolean }[] };
    expect(json.builds.map((b) => [b.id, b.leds])).toEqual([['keyballplus', true], ['keyball39', undefined]]);
    expect(review(s).changes).toEqual([{ setting: 'leds', from: 0, to: 1 }]);
    expect(review(s).message).toBe('Set keyballplus to build with LEDs');
  });

  it('writes the effect, colour and start-up to config.h, with the effect compiled in', () => {
    const s = [
      { type: 'ledMode', value: ledModeValue({ effect: 'breathing', variant: 2 }) },
      { type: 'ledHue', value: 170 },
      { type: 'ledStartOn', value: 0 },
    ].reduce((x, e) => apply(x, e as Edit), withRules());
    const after = configOf(s);
    expect(after.endsWith(
      '#define RGBLIGHT_DEFAULT_MODE RGBLIGHT_MODE_BREATHING + 2\n#define RGBLIGHT_DEFAULT_HUE 170\n#define KEYBALLER_LEDS_OFF\n#define RGBLIGHT_EFFECT_BREATHING\n',
    )).toBe(true);
    expect(leds(s)).toMatchObject({ mode: { effect: 'breathing', variant: 2 }, hue: 170, startOn: false, effects: ['breathing'] });
    expect(review(s).message).toBe('Set the LED effect to breathing, the LED hue to 170, the LEDs to start off and the LED effects to breathing');
  });

  it('takes settings out again, leaving config.h as it was', () => {
    const s = [
      { type: 'ledEffects', value: ledEffectsValue(['twinkle', 'gradient']) },
      { type: 'ledStartOn', value: 0 },
      { type: 'ledStartOn', value: 1 },
    ].reduce((x, e) => apply(x, e as Edit), withRules());
    expect(configOf(s)).toContain('#define RGBLIGHT_EFFECT_STATIC_GRADIENT\n#define RGBLIGHT_EFFECT_TWINKLE\n');
    expect(configOf(apply(s, { type: 'ledEffects', value: 0 }))).toBe(fixture('am338.config.h'));
  });

  it('keeps the start-up effect compiled in', () => {
    const s = [
      { type: 'ledMode', value: ledModeValue({ effect: 'snake', variant: 1 }) },
      { type: 'ledEffects', value: ledEffectsValue(['twinkle']) },
    ].reduce((x, e) => apply(x, e as Edit), withRules());
    expect(leds(s).effects).toEqual(['snake', 'twinkle']);
  });
});
