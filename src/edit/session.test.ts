// An edit session: the files read from the config repository, the changes made
// on screen, undo and redo, and what a save would commit. Fixtures are the real
// am338 config.h and keyballer.json.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, openSession, rebase, redo, review, trackball, undo, type Session } from './session';

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
    expect(review(am338())).toEqual({ changes: [], files: [], message: '' });
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
