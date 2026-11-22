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
    view = make_view(ROBA)

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
        self.assertTrue(key.startswith("LT(5,"), key)

    def test_lists_combos_with_their_positions_and_output(self):
        combos = self.view["combos"]
        tab = next(c for c in combos if c["positions"] == [11, 12])
        self.assertEqual(tab["output"], "KC_TAB")
        self.assertEqual(tab["keys"], ["KC_S", "KC_D"])
        self.assertEqual(next(c for c in combos if c["positions"] == [12, 13])["output"], "LSFT(KC_TAB)")


class Meteorite40View(unittest.TestCase):
    def test_reads_a_whole_keyboard(self):
        view = make_view(M40)
        self.assertGreater(len(view["keys"]), 30)
        self.assertEqual(len(view["layers"][0]["keys"]), len(view["keys"]))
        self.assertEqual(view["balls"], [])


class Refusals(unittest.TestCase):
    def test_says_why_when_there_is_no_keymap_or_layout(self):
        with self.assertRaises(ViewError):
            make_view("/dts-v1/;\n/ {\n};\n")


if __name__ == "__main__":
    unittest.main()
