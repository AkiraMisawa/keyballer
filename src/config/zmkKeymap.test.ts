// Reading and changing a ZMK .keymap file as text. The fixtures are the owner's real files
// (AkiraMisawa/zmk-config-roBa config/roBa.keymap and zmk-config-meteorite40
// config/meteorite40.keymap, 2026-11-22); expected lines are copied by hand from them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addZmkCombo,
  addZmkLayer,
  dtsString,
  ensureInclude,
  freeName,
  readZmkKeymap,
  removeZmkCombo,
  removeZmkLayer,
  setZmkBinding,
  setZmkCombo,
  setZmkLayerName,
  ZmkSourceError,
} from './zmkKeymap';

const roba = readFileSync(new URL('./fixtures/roBa.keymap', import.meta.url), 'utf8');
const m40 = readFileSync(new URL('./fixtures/meteorite40.keymap', import.meta.url), 'utf8');

/** The change replaced exactly this text, once, and nothing else. */
function onlyChanged(before: string, after: string, from: string, to: string) {
  expect(before.split(from).length).toBe(2);
  expect(after).toBe(before.replace(from, to));
}

const ROBA_ROW_1 =
  '&mt LEFT_ALT Q      &kp W             &kp E         &kp R                 &kp T                                                    &kp Y        &kp U  &kp I     &kp O     &kp P';

describe('reading a .keymap file', () => {
  it('finds each layer node with its bindings as written', () => {
    const { layers } = readZmkKeymap(roba);
    expect(layers.map((l) => l.node)).toEqual(['default_layer', 'SYMBOL', 'NUM', 'ARROW', 'MOUSE', 'FUNCTION', 'layer_6', 'layer_7']);
    const base = layers[0].bindings;
    // Rows of 10, 12, 12 and 9 bindings.
    expect(base).toHaveLength(43);
    expect(base.map((b) => b.text).slice(0, 2)).toEqual(['&mt LEFT_ALT Q', '&kp W']);
    expect(base[15].text).toBe('&kp LS(LG(S))');
    expect(base[21]).toMatchObject({ ref: 'lt_to_layer_0', text: '&lt_to_layer_0 5 APOSTROPHE' });
    expect(base[42].text).toBe('&mt RIGHT_CONTROL MINUS');
    expect(layers[1].bindings.slice(15, 17).map((b) => b.ref)).toEqual(['trans', 'none']);
    // The bindings are where the file has them.
    expect(roba.slice(base[1].start, base[1].end)).toBe('&kp W');
  });

  it('reads combos, and leaves out what comments and other properties hold', () => {
    const { combos } = readZmkKeymap(roba);
    expect(combos).toHaveLength(8);
    expect(combos[0]).toMatchObject({ node: 'tab', positions: [11, 12], layers: null });
    expect(combos[0].bindings.map((b) => b.text)).toEqual(['&kp TAB']);
    // meteorite40 limits combos to layers, and comments its key positions (/* D + F */).
    const m = readZmkKeymap(m40);
    expect(m.combos.find((c) => c.node === 'lang1')).toMatchObject({ positions: [12, 13], layers: [0] });
    expect(m.combos.find((c) => c.node === 'home')).toMatchObject({ layers: [2] });
    expect(m.layers.map((l) => l.node)).toEqual(['win_default_layer', 'layer_1', 'layer_2', 'layer_3', 'layer_4']);
    expect(m.layers[0].bindings).toHaveLength(40);
  });

  it('refuses what it cannot place: macros in bindings, path references, two keymaps', () => {
    const wrap = (layer: string) => `/ {\n  keymap {\n    compatible = "zmk,keymap";\n    base {\n      bindings = <${layer}>;\n    };\n  };\n};\n`;
    expect(readZmkKeymap(wrap('&kp A &kp B')).layers[0].bindings).toHaveLength(2);
    expect(() => readZmkKeymap(wrap('MY_KEY &kp A'))).toThrow(ZmkSourceError);
    expect(() => readZmkKeymap(wrap('&{/behaviors/kp} 4'))).toThrow(ZmkSourceError);
    expect(() => readZmkKeymap(wrap('&kp A') + wrap('&kp B'))).toThrow(ZmkSourceError);
    expect(() => readZmkKeymap('/* open')).toThrow(ZmkSourceError);
    // A brace in a comment or a string is not structure.
    expect(readZmkKeymap(`// };\n${wrap('&kp A /* } */')}`).layers[0].bindings.map((b) => b.text)).toEqual(['&kp A']);
  });
});

describe('changing a key', () => {
  it('puts the binding in its place, and the next one on the line keeps its column', () => {
    const after = setZmkBinding(roba, 'default_layer', 1, '&kp LS(TAB)');
    onlyChanged(roba, after, ROBA_ROW_1, ROBA_ROW_1.replace('&kp W             &kp E', '&kp LS(TAB)       &kp E'));
  });

  it('moves the rest of the line only, one space apart, when the binding does not fit', () => {
    const after = setZmkBinding(roba, 'default_layer', 5, '&kp LS(LG(LA(Y)))');
    const row = after.split('\n').find((l) => l.startsWith('&mt LEFT_ALT Q'))!;
    expect(row).toContain('&kp LS(LG(LA(Y))) &kp U &kp I');
    // Each binding that had room keeps its column: &kp O is where it was.
    expect(row.indexOf('&kp O')).toBe(ROBA_ROW_1.indexOf('&kp O'));
    expect(after.split('\n').filter((l, i) => l !== roba.split('\n')[i])).toEqual([row]);
  });

  it('fills a short layer with no action up to the key', () => {
    const src = '/ {\n  keymap {\n    compatible = "zmk,keymap";\n    base {\n      bindings = <&kp A>;\n    };\n  };\n};\n';
    expect(setZmkBinding(src, 'base', 2, '&kp C')).toContain('bindings = <&kp A &none &kp C>;');
  });
});

describe('layers', () => {
  it('adds a transparent layer after the last one in use, in its rows and columns', () => {
    // layer_7 is all &trans already, so the new layer's bindings read exactly like it.
    const after = addZmkLayer(roba, 'layer_7', 'layer_8', 43);
    const layer7 = roba.slice(roba.indexOf('        layer_7 {'), roba.lastIndexOf('        };') + '        };'.length);
    expect(after).toBe(roba.replace(layer7, `${layer7}\n\n${layer7.replace('layer_7 {', 'layer_8 {')}`));
    expect(readZmkKeymap(after).layers[8].bindings.every((b) => b.text === '&trans')).toBe(true);
  });

  it('copies only the rows when the last layer has other properties', () => {
    const after = addZmkLayer(m40, 'layer_4', 'layer_5', 40);
    const added = after.slice(after.indexOf('        layer_5 {'));
    expect(added.startsWith('        layer_5 {\n            bindings = <\n                &trans       &trans  &trans  &trans  &trans')).toBe(true);
    expect(added).not.toContain('display-name');
    expect(added).not.toContain('sensor-bindings');
    expect(readZmkKeymap(after).layers[5].bindings).toHaveLength(40);
  });

  it('removes the last layer with the space before it', () => {
    const layer7 = roba.slice(roba.indexOf('\n\n        layer_7 {'), roba.lastIndexOf('        };') + '        };'.length);
    expect(removeZmkLayer(roba, 'layer_7')).toBe(roba.replace(layer7, ''));
  });

  it('names a layer by its display-name, adding one when the layer has none', () => {
    onlyChanged(m40, setZmkLayerName(m40, 'layer_1', 'SYM'), 'display-name = "SYMBOLS";', 'display-name = "SYM";');
    onlyChanged(
      roba,
      setZmkLayerName(roba, 'NUM', '数字 "N"'),
      '        NUM {\n            bindings = <',
      '        NUM {\n            display-name = "数字 \\"N\\"";\n            bindings = <',
    );
    expect(setZmkLayerName(m40, 'layer_1', '')).toBe(m40.replace('            display-name = "SYMBOLS";\n', ''));
  });

  it('writes names as devicetree strings', () => {
    expect(dtsString('a\\b"c\nd')).toBe('"a\\\\b\\"cd"');
  });
});

describe('combos', () => {
  it('changes a combo’s keys and output only', () => {
    const after = setZmkCombo(roba, 'tab', [11, 13], '&kp ESC');
    onlyChanged(
      roba,
      after,
      'tab {\n            bindings = <&kp TAB>;\n            key-positions = <11 12>;',
      'tab {\n            bindings = <&kp ESC>;\n            key-positions = <11 13>;',
    );
  });

  it('adds a combo at the end of the combos node, laid out like the others', () => {
    const after = addZmkCombo(roba, 'combo_esc', [1, 2], '&kp ESC');
    onlyChanged(
      roba,
      after,
      '            key-positions = <13 33>;\n        };\n    };',
      '            key-positions = <13 33>;\n        };\n\n        combo_esc {\n            bindings = <&kp ESC>;\n            key-positions = <1 2>;\n        };\n    };',
    );
  });

  it('makes a combos node before the keymap when there is none', () => {
    const src = '/ {\n    keymap {\n        compatible = "zmk,keymap";\n        base {\n            bindings = <&kp A &kp B>;\n        };\n    };\n};\n';
    expect(addZmkCombo(src, 'combo_tab', [0, 1], '&kp TAB')).toBe(
      '/ {\n    combos {\n        compatible = "zmk,combos";\n\n        combo_tab {\n            bindings = <&kp TAB>;\n            key-positions = <0 1>;\n        };\n    };\n\n' +
        '    keymap {\n        compatible = "zmk,keymap";\n        base {\n            bindings = <&kp A &kp B>;\n        };\n    };\n};\n',
    );
  });

  it('removes a combo with the blank line before it', () => {
    onlyChanged(
      roba,
      removeZmkCombo(roba, 'period2'),
      '\n\n        period2 {\n            bindings = <&kp PERIOD>;\n            key-positions = <13 32>;\n        };',
      '',
    );
  });
});

describe('headers and names', () => {
  it('includes a header after the last #include, once', () => {
    expect(ensureInclude(roba, 'dt-bindings/zmk/bt.h')).toBe(roba);
    onlyChanged(
      roba,
      ensureInclude(roba, 'dt-bindings/zmk/outputs.h'),
      '#include <dt-bindings/zmk/pointing.h>\n',
      '#include <dt-bindings/zmk/pointing.h>\n#include <dt-bindings/zmk/outputs.h>\n',
    );
  });

  it('finds a free node name', () => {
    expect(freeName('combo_tab', ['tab'])).toBe('combo_tab');
    expect(freeName('combo LS(TAB)', ['combo_ls_tab'])).toBe('combo_ls_tab_2');
  });
});
