// Writing settings into the config repository's files, changing as little text
// as possible. Fixtures are the real am338 config.h and keyballer.json.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readDefine, readFlag, setBallMm, setBuildValue, setDefine, setFlag, setRule } from './source';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const configH = fixture('am338.config.h');
const keyballerJson = fixture('keyballer.json');

/** The lines that differ between two texts, as [before, after] pairs. */
function changedLines(before: string, after: string): [string, string][] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: [string, string][] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push([a[i], b[i]]);
  return out;
}

describe('config.h defines', () => {
  it('reads a define', () => {
    expect(readDefine(configH, 'KEYBALL_CPI_DEFAULT')).toBe('700');
    expect(readDefine(configH, 'KEYBALL_SCROLL_DIV_DEFAULT')).toBe('4');
    expect(readDefine(configH, 'KEYBALL_REPORTMOUSE_INTERVAL')).toBeUndefined();
  });

  it('changes a define in place and nothing else', () => {
    const after = setDefine(configH, 'KEYBALL_CPI_DEFAULT', '900');
    expect(changedLines(configH, after)).toEqual([
      ['#define KEYBALL_CPI_DEFAULT 700', '#define KEYBALL_CPI_DEFAULT 900'],
    ]);
  });

  it('keeps the text identical when the value is the same', () => {
    expect(setDefine(configH, 'KEYBALL_SCROLL_DIV_DEFAULT', '4')).toBe(configH);
  });

  it('keeps spacing and a trailing comment', () => {
    const text = '#pragma once\n#  define  KEYBALL_CPI_DEFAULT   500   // slow\n';
    expect(setDefine(text, 'KEYBALL_CPI_DEFAULT', '800')).toBe(
      '#pragma once\n#  define  KEYBALL_CPI_DEFAULT   800   // slow\n',
    );
  });

  it('adds a missing define at the end', () => {
    const text = '#pragma once\n\n#define TAPPING_TERM 200\n';
    expect(setDefine(text, 'KEYBALL_CPI_DEFAULT', '800')).toBe(
      '#pragma once\n\n#define TAPPING_TERM 200\n#define KEYBALL_CPI_DEFAULT 800\n',
    );
    expect(setDefine('#pragma once', 'KEYBALL_CPI_DEFAULT', '800')).toBe(
      '#pragma once\n#define KEYBALL_CPI_DEFAULT 800\n',
    );
  });

  it('does not touch a define that is only mentioned in a comment', () => {
    const text = '// KEYBALL_CPI_DEFAULT 500 is the Keyball default\n#define KEYBALL_CPI_DEFAULT 700\n';
    expect(setDefine(text, 'KEYBALL_CPI_DEFAULT', '800')).toBe(
      '// KEYBALL_CPI_DEFAULT 500 is the Keyball default\n#define KEYBALL_CPI_DEFAULT 800\n',
    );
  });
});

describe('keyballer.json ball size', () => {
  it('sets ball_mm on one build and keeps the file as written', () => {
    const after = setBallMm(keyballerJson, 'keyballplus', 34);
    // One line gains a comma and one line is added after it; the rest is as written.
    const before = '      "ball": "right"\n    },\n    {\n      "id": "keyball39"';
    expect(keyballerJson).toContain(before);
    expect(after).toBe(
      keyballerJson.replace(before, '      "ball": "right",\n      "ball_mm": 34\n    },\n    {\n      "id": "keyball39"'),
    );
    expect(JSON.parse(after).builds[0].ball_mm).toBe(34);
    expect(JSON.parse(after).builds[1].ball_mm).toBeUndefined();
  });

  it('keeps the text identical when nothing changes', () => {
    const once = setBallMm(keyballerJson, 'keyballplus', 34);
    expect(setBallMm(once, 'keyballplus', 34)).toBe(once);
  });
});

describe('rules.mk', () => {
  it('changes a rule in place, or adds it at the end', () => {
    const rules = 'OLED_ENABLE = yes\nCOMBO_ENABLE = no\n';
    expect(setRule(rules, 'COMBO_ENABLE', 'yes')).toBe('OLED_ENABLE = yes\nCOMBO_ENABLE = yes\n');
    expect(setRule('OLED_ENABLE = yes\n', 'COMBO_ENABLE', 'yes')).toBe('OLED_ENABLE = yes\nCOMBO_ENABLE = yes\n');
    expect(setRule(rules, 'OLED_ENABLE', 'yes')).toBe(rules);
  });
});

describe('switches in config.h', () => {
  it('finds a define as #ifdef would, adds it once and removes its line', () => {
    expect(readFlag('#define KEYBALLER_LEDS_OFF\n', 'KEYBALLER_LEDS_OFF')).toBe(true);
    expect(readFlag('#  define KEYBALLER_LEDS_OFF 1 // off\n', 'KEYBALLER_LEDS_OFF')).toBe(true);
    expect(readFlag('#define KEYBALLER_LEDS_OFF_X\n// #define KEYBALLER_LEDS_OFF\n', 'KEYBALLER_LEDS_OFF')).toBe(false);
    const on = setFlag('#pragma once', 'RGBLIGHT_EFFECT_TWINKLE', true);
    expect(on).toBe('#pragma once\n#define RGBLIGHT_EFFECT_TWINKLE\n');
    expect(setFlag(on, 'RGBLIGHT_EFFECT_TWINKLE', true)).toBe(on);
    expect(setFlag(on, 'RGBLIGHT_EFFECT_TWINKLE', false)).toBe('#pragma once\n');
  });
});

describe('build fields in keyballer.json', () => {
  it('sets a field of the build itself, not one nested in it or elsewhere', () => {
    const text = '{\n  "note": "builds",\n  "views": { "x": { "id": "keyballplus" } },\n  "builds": [\n    {\n      "id": "keyballplus",\n      "extra": { "leds": false },\n      "leds": false\n    }\n  ]\n}\n';
    const after = setBuildValue(text, 'keyballplus', 'leds', true);
    expect(after).toBe(text.replace('"leds": false\n', '"leds": true\n'));
    // A field written as a string is replaced, not given a second key.
    const odd = '{ "builds": [ { "id": "b", "leds": "yes" } ] }';
    expect(setBuildValue(odd, 'b', 'leds', false)).toBe('{ "builds": [ { "id": "b", "leds": false } ] }');
    // A key that only contains the name is another key.
    const escaped = '{ "builds": [ { "id": "b", "\\"leds": 1 } ] }';
    expect(JSON.parse(setBuildValue(escaped, 'b', 'leds', true))).toEqual({ builds: [{ id: 'b', '"leds': 1, leds: true }] });
  });
});

describe('switches inside comments', () => {
  it('does not count a define in a block comment, and keeps the comment when removing a line', () => {
    expect(readFlag('/* old:\n#define KEYBALLER_LEDS_OFF\n*/\n', 'KEYBALLER_LEDS_OFF')).toBe(false);
    const text = '#define KEYBALLER_LEDS_OFF /* a\n b */\n#define X 1\n';
    const after = setFlag(text, 'KEYBALLER_LEDS_OFF', false);
    expect(readFlag(after, 'KEYBALLER_LEDS_OFF')).toBe(false);
    expect(after).toBe('/* a\n b */\n#define X 1\n');
  });
});

