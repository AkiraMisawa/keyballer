// keyballer.json read and written with its keys in their written order. JSON.parse
// would move number-like keys such as views.ball."3" to the front.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJson, setJson, writeJson } from './json';

const keyballerJson = readFileSync(new URL('./fixtures/keyballer.json', import.meta.url), 'utf8');

describe('order-preserving JSON', () => {
  it('writes the file back exactly as Keyballer and Python write it', () => {
    expect(writeJson(readJson(keyballerJson))).toBe(keyballerJson);
  });

  it('sets a value at a path and changes only that line', () => {
    const after = writeJson(setJson(readJson(keyballerJson), ['views', 'keymaps/am338', 'layers', 1], 'Sym'));
    expect(after).toBe(keyballerJson.replace('        "Symbol",', '        "Sym",'));
  });

  it('keeps a number-like key where it was', () => {
    const after = writeJson(setJson(readJson(keyballerJson), ['views', 'keymaps/am338', 'ball', '2'], 'scroll'));
    expect(after).toBe(
      keyballerJson.replace('"3": "scroll"\n', '"3": "scroll",\n        "2": "scroll"\n'),
    );
  });

  it('removes a key when set to undefined, and creates objects on the way to a new one', () => {
    const doc = readJson('{\n  "a": 1,\n  "b": 2\n}\n');
    expect(writeJson(setJson(doc, ['a'], undefined))).toBe('{\n  "b": 2\n}\n');
    expect(writeJson(setJson(doc, ['c', 'd'], ['x']))).toBe('{\n  "a": 1,\n  "b": 2,\n  "c": {\n    "d": [\n      "x"\n    ]\n  }\n}\n');
  });

  it('writes empty objects and arrays, and Japanese text as is', () => {
    expect(writeJson(readJson('{"a": {}, "b": [], "c": "範囲スクショ"}'))).toBe('{\n  "a": {},\n  "b": [],\n  "c": "範囲スクショ"\n}\n');
  });
});
