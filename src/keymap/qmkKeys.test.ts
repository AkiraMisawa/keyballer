// The QMK keycodes Keyballer writes exist in the QMK version builds pin. (The tables it reads
// keymaps with may know names of other QMK versions too, such as LCS from later ones.) The table qmk-keys.json
// lists every keycode name and keycode function QMK's headers define, and Keyball's own keycodes,
// at the versions it names; scripts/qmk_keys.py writes it. Before moving builds to another QMK
// version, write the table for that version: what the picker offers and no longer exists fails here.

import { describe, expect, it } from 'vitest';
import table from './qmk-keys.json';
import { compose, makeCatalogue, type TapHold } from './catalogue';
import type { Mod } from './keycodes';
import { parseKeycode } from './view';

type Expr = ReturnType<typeof parseKeycode>;

const names = new Set([...table.names, ...table.keyball_names]);
const functions = new Set(table.functions);

/** The names in a keycode that QMK does not define: functions, and the names given to them. */
function missing(code: string): string[] {
  const out: string[] = [];
  const walk = (e: Expr) => {
    if (e.args.length > 0) {
      if (!functions.has(e.name)) out.push(`${e.name}()`);
      e.args.forEach(walk);
      return;
    }
    for (const part of e.name.split('|').map((p: string) => p.trim())) {
      if (!/^\d+$/.test(part) && !names.has(part)) out.push(part);
    }
  };
  walk(parseKeycode(code));
  return out;
}

const subsets = <T,>(items: T[]): T[][] => items.reduce<T[][]>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]);
const MODS: Mod[] = ['ctrl', 'shift', 'alt', 'gui'];

describe(`QMK ${table.qmk} with Keyball ${table.keyball.slice(0, 7)}`, () => {
  it('has every key the picker offers', () => {
    const catalogue = makeCatalogue({ layers: ['Base', 'Symbol'], custom: [], labels: {} });
    const unknown = catalogue.entries.filter((e) => e.category !== 'own').flatMap((e) => missing(e.code).map((name) => `${e.code}: ${name}`));
    expect(unknown).toEqual([]);
  });

  it('has every key the picker builds: modifiers, mod-taps and layer-taps', () => {
    const built: TapHold[] = [
      ...subsets(MODS).map((withMods) => ({ tap: 'KC_A', withMods })),
      ...subsets(MODS).flatMap((mods) => [{ tap: 'KC_A', hold: { mods } }, { tap: 'KC_A', hold: { mods, right: true } }]),
      { tap: 'KC_SPC', hold: { layer: 3 } },
    ];
    const codes = built.map((k) => compose(k)).flatMap((r) => ('keycode' in r ? [r.keycode] : []));
    expect(codes.length).toBeGreaterThan(40);
    expect(codes.flatMap(missing)).toEqual([]);
  });
});
