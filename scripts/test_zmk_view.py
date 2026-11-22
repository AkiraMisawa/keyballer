"""The ZMK keymap view (docs/plans/zmk.md, phase 3): Keyballer's view file made from the build's
final devicetree. The fixtures are the owner's real zephyr.dts files (roBa right and meteorite40,
built 2026-11-22); expected values come from their .keymap sources (AkiraMisawa/zmk-config-roBa
config/roBa.keymap, AkiraMisawa/zmk-config-meteorite40) and ZMK's physical layout docs
(centi-keyunits, centi-degrees)."""

import unittest
from pathlib import Path

from zmk_view import ViewError, make_view, parse_dts

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "zmk"
ROBA = (FIXTURES / "roba-right.dts").read_text(encoding="utf-8")
M40 = (FIXTURES / "meteorite40.dts").read_text(encoding="utf-8")


class ParseDts(unittest.TestCase):
    def test_reads_nodes_labels_properties_and_references(self):
        root = parse_dts('/dts-v1/;\n/ {\n\tchosen {\n\t\tzmk,physical-layout = &pl;\n\t};\n'
                         '\tpl: layout {\n\t\tcompatible = "zmk,physical-layout";\n\t\t#binding-cells = < 0x1 >;\n'
                         '\t\tkeys = < &k 0x64 0xfffff830 >, < &k 0x1 0x2 >;\n\t\tstatus;\n\t};\n};\n')
        layout = root.child("layout")
        self.assertEqual(layout.labels, ["pl"])
        self.assertEqual(layout.prop("compatible"), ["zmk,physical-layout"])
        self.assertEqual(layout.prop("#binding-cells"), [1])
        self.assertEqual(layout.prop("keys"), ["&k", 0x64, 0xFFFFF830, "&k", 1, 2])
        self.assertEqual(layout.prop("status"), [])
        self.assertEqual(root.child("chosen").prop("zmk,physical-layout"), ["&pl"])


class RobaView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.view = make_view(ROBA)

    def test_draws_the_physical_layout_in_key_units(self):
        keys = self.view["keys"]
        # Rows of 10, 12, 12 and 9 keys in roBa.keymap.
        self.assertEqual(len(keys), 43)
        # The first key: 1u wide at x 0, y 0.37 (0x25 centi-keyunits).
        self.assertEqual({k: keys[0][k] for k in ("x", "y", "w", "h", "r")}, {"x": 0.0, "y": 0.37, "w": 1.0, "h": 1.0, "r": 0.0})
        # The thumb keys turn: 10 and 20 degrees clockwise, then 20 and 10 counterclockwise.
        self.assertEqual([keys[i]["r"] for i in (38, 39, 40, 41)], [10.0, 20.0, -20.0, -10.0])
        self.assertEqual((keys[39]["rx"], keys[39]["ry"]), (5.5, 3.87))

    def test_names_layers_and_turns_bindings_into_keycodes(self):
        layers = self.view["layers"]
        self.assertEqual(layers[0]["name"], "default_layer")
        self.assertEqual(layers[1]["name"], "SYMBOL")
        base = layers[0]["keys"]
        self.assertEqual(len(base), 43)
        # &mt LEFT_ALT Q, &kp W, &mt LEFT_CONTROL A, &kp LS(LG(S)), &to 6, &lt 5 K
        self.assertEqual(base[0], "LALT_T(KC_Q)")
        self.assertEqual(base[1], "KC_W")
        self.assertEqual(base[10], "LCTL_T(KC_A)")
        self.assertEqual(base[15], "LSFT(LGUI(KC_S))")
        self.assertEqual(base[16], "TO(6)")
        self.assertEqual(base[19], "LT(5,KC_K)")
        # &none, &mkp MB1, &mkp MB2, &mt RIGHT_SHIFT SLASH
        self.assertEqual(base[27], "KC_NO")
        self.assertIn("KC_BTN1", base)
        self.assertIn("KC_BTN2", base)
        self.assertIn("RSFT_T(KC_SLSH)", base)
        self.assertEqual(layers[1]["keys"][15:17], ["KC_TRNS", "KC_NO"])

    def test_names_zmk_behaviours_that_have_no_qmk_keycode(self):
        everything = [k for layer in self.view["layers"] for k in layer["keys"]]
        bt = [k for k in everything if k.startswith("ZMK_BT")]
        # &bt BT_SEL 0 … 4, &bt BT_CLR, &bt BT_CLR_ALL
        self.assertIn("ZMK_BT_SEL_0", bt)
        self.assertEqual(self.view["labels"]["ZMK_BT_SEL_0"], {"en": "BT 1", "ja": "BT 1"})
        self.assertIn("ZMK_BT_CLR_ALL", bt)
        # &bootloader
        self.assertIn("QK_BOOT", everything)

    def test_turns_a_custom_hold_tap_that_holds_a_layer_into_a_layer_tap(self):
        # &lt_to_layer_0 5 APOSTROPHE: hold for layer 5; the tap is a macro (TO_LAYER_0) with the key.
        key = self.view["layers"][0]["keys"][21]
        self.assertEqual(key, "LT(5,ZMK_TO_LAYER_0_70034)")
        self.assertEqual(self.view["labels"]["ZMK_TO_LAYER_0_70034"]["en"], "to layer 0 QUOT")

    def test_lists_combos_with_their_positions_and_output(self):
        combos = self.view["combos"]
        tab = next(c for c in combos if c["positions"] == [11, 12])
        self.assertEqual(tab["output"], "KC_TAB")
        self.assertEqual(tab["keys"], ["KC_S", "KC_D"])
        self.assertEqual(next(c for c in combos if c["positions"] == [12, 13])["output"], "LSFT(KC_TAB)")

    def test_names_each_combo_by_its_node(self):
        # combos { tab { … }; shift_tab { … }; … } in roBa.keymap.
        self.assertEqual([c["name"] for c in self.view["combos"]][:2], ["tab", "shift_tab"])

    def test_records_the_layer_nodes_and_behaviours_for_the_editor(self):
        # The editor matches these against the .keymap source before it changes anything.
        layers = self.view["zmk"]["layers"]
        self.assertEqual([l["node"] for l in layers],
                         ["default_layer", "SYMBOL", "NUM", "ARROW", "MOUSE", "FUNCTION", "layer_6", "layer_7"])
        # &mt LEFT_ALT Q  &kp W … &kp LS(LG(S))  &to 6 … &lt 5 K  &kp L  &lt_to_layer_0 5 APOSTROPHE
        refs = layers[0]["refs"]
        self.assertEqual(len(refs), 43)
        self.assertEqual(refs[:2], ["mt", "kp"])
        self.assertEqual(refs[15:22], ["kp", "to", "kp", "kp", "lt", "kp", "lt_to_layer_0"])
        self.assertEqual(layers[1]["refs"][15:17], ["trans", "none"])


class Meteorite40View(unittest.TestCase):
    def test_reads_a_whole_keyboard(self):
        view = make_view(M40)
        # Rows of 10, 10, 12 and 8 keys in meteorite40.keymap.
        self.assertEqual(len(view["keys"]), 40)
        base = view["layers"][0]
        self.assertEqual(base["name"], "BASE")
        # &mt LSHIFT A, &kp MINUS, &mkp MB1, &lt 4 SLASH
        self.assertEqual([base["keys"][i] for i in (10, 19, 25, 31)], ["LSFT_T(KC_A)", "KC_MINS", "KC_BTN1", "LT(4,KC_SLSH)"])
        # Combos D+F and J+K for layer 0 (LANG1, LANG2); the ones for layer 2 only are left out.
        outputs = {tuple(c["positions"]): c["output"] for c in view["combos"]}
        self.assertEqual((outputs[(12, 13)], outputs[(16, 17)]), ("KC_LNG1", "KC_LNG2"))
        self.assertEqual(len({c["line"] for c in view["combos"]}), len(view["combos"]))
        # Each combo kept is named by its own node, after those left out too.
        self.assertEqual([c["name"] for c in view["combos"]], ["lang1", "lang2", "esc", "tab"])
        self.assertEqual(view["balls"], [])


def tiny(layers, extra=""):
    """A devicetree with two keys, the behaviours ZMK defines in the same shape, and these layers."""
    return """/dts-v1/;
/ {
\tchosen {
\t\tzmk,physical-layout = &pl;
\t};
\tbehaviors {
\t\tkp: key_press { compatible = "zmk,behavior-key-press"; #binding-cells = < 0x1 >; };
\t\tmo: momentary_layer { compatible = "zmk,behavior-momentary-layer"; #binding-cells = < 0x1 >; };
\t\tsk: sticky_key { compatible = "zmk,behavior-sticky-key"; #binding-cells = < 0x1 >; bindings = < &kp >; };
\t\tsl: sticky_layer { compatible = "zmk,behavior-sticky-key"; #binding-cells = < 0x1 >; bindings = < &mo >; };
\t\tbt: bluetooth { compatible = "zmk,behavior-bluetooth"; #binding-cells = < 0x2 >; };
\t\tout: outputs { compatible = "zmk,behavior-outputs"; #binding-cells = < 0x1 >; };
\t};
\tkpa: key_physical_attrs { compatible = "zmk,key-physical-attrs"; };
\tpl: layout {
\t\tcompatible = "zmk,physical-layout";
\t\tkeys = < &kpa 0x64 0x64 0x0 0x0 0x0 0x0 0x0 >, < &kpa 0x64 0x64 0x64 0x0 0x0 0x0 0x0 >;
\t};
\tkeymap {
\t\tcompatible = "zmk,keymap";
%s
\t};
%s
};
""" % (layers, extra)


class Synthetic(unittest.TestCase):
    def test_keeps_text_in_any_script(self):
        view = make_view(tiny('\t\tbase { display-name = "記号"; bindings = < &kp 0x70004 &kp 0x70005 >; };'))
        self.assertEqual(view["layers"][0]["name"], "記号")

    def test_fills_a_short_layer_and_leaves_out_unused_layers_at_the_end(self):
        view = make_view(tiny('\t\tbase { bindings = < &kp 0x70004 >; };\n'
                              '\t\textra { status = "reserved"; bindings = < &kp 0x70004 &kp 0x70004 >; };'))
        self.assertEqual(view["layers"][0]["keys"], ["KC_A", "KC_NO"])
        self.assertEqual(len(view["layers"]), 1)
        # The source has one binding there, not two; the reserved layer is recorded for the editor.
        self.assertEqual(view["zmk"]["layers"], [{"node": "base", "status": "okay", "refs": ["kp"]},
                                                 {"node": "extra", "status": "reserved", "refs": ["kp", "kp"]}])

    def test_reads_sticky_keys_outputs_and_bluetooth(self):
        # &sk LSHIFT, &sl 2 / &out OUT_USB (1), &bt BT_NXT (1)
        view = make_view(tiny('\t\ta { bindings = < &sk 0x700e1 &sl 0x2 >; };\n\t\tb { bindings = < &out 0x1 &bt 0x1 0x0 >; };'))
        self.assertEqual(view["layers"][0]["keys"], ["OSM(MOD_LSFT)", "OSL(2)"])
        self.assertEqual(view["layers"][1]["keys"], ["ZMK_OUT_USB", "ZMK_BT_NXT"])
        self.assertEqual(view["labels"]["ZMK_BT_NXT"]["en"], "BT next")

    def test_takes_only_numbers_as_parameters(self):
        with self.assertRaises(ViewError):
            make_view(tiny('\t\tbase { bindings = < &mo >, "1),LT(2,KC_A", < &kp 0x70004 >; };'))


class Refusals(unittest.TestCase):
    def test_says_why_when_there_is_no_keymap_or_layout(self):
        with self.assertRaisesRegex(ViewError, "no keymap"):
            make_view("/dts-v1/;\n/ {\n};\n")
        with self.assertRaisesRegex(ViewError, "3 bindings for 2 keys"):
            make_view(tiny('\t\tbase { bindings = < &kp 0x70004 &kp 0x70004 &kp 0x70004 >; };'))


if __name__ == "__main__":
    unittest.main()
