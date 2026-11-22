"""Tests for the view file the build writes next to each firmware.

Fixtures are the real am338 keymap on Keyball+ (see fixtures/am338/README.md).
Expected positions were worked out by hand from via.json, following KLE's
rules: each key starts where the last one ended, rows advance y by 1, and a
row that sets rx/ry restarts from that rotation origin.

Run: python3 -m unittest discover -s scripts -p 'test_*.py'
"""

import json
import unittest
from pathlib import Path

from keyballer_view import ViewError, make_view

FIXTURES = Path(__file__).parent / "fixtures" / "am338"


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def am338_view(**overrides):
    args = dict(
        c2json=load("c2json.json"),
        info=load("info.json"),
        via=load("via.json"),
        keymap_c=(FIXTURES / "keymap.c").read_text(encoding="utf-8"),
        config={},
        ball="right",
    )
    args.update(overrides)
    return make_view(**args)


def key(view, index):
    return next(k for k in view["keys"] if k["index"] == index)


class GeometryTest(unittest.TestCase):
    def test_q_sits_top_left_where_via_json_puts_matrix_0_0(self):
        q = key(am338_view(), 0)
        self.assertEqual(q["matrix"], [0, 0])
        self.assertAlmostEqual(q["x"], 0)
        self.assertAlmostEqual(q["y"], 0.6)
        self.assertEqual(q["r"], 0)

    def test_staggered_columns_on_both_halves(self):
        view = am338_view()
        self.assertEqual((key(view, 4)["x"], key(view, 4)["y"]), (4, 0.25))  # T
        self.assertEqual((key(view, 5)["x"], key(view, 5)["y"]), (8.75, 0.25))  # Y
        self.assertEqual((key(view, 9)["x"], key(view, 9)["y"]), (12.75, 0.6))  # P

    def test_thumb_keys_keep_their_rotation(self):
        view = am338_view()
        space = key(view, 34)  # L34, matrix 3,4
        self.assertAlmostEqual(space["x"], 4.05)
        self.assertAlmostEqual(space["y"], 3.725)
        self.assertEqual((space["r"], space["rx"], space["ry"]), (10, 5.35, 5.5))
        enter = key(view, 37)  # R34, matrix 7,4
        self.assertAlmostEqual(enter["x"], 8.75)
        self.assertAlmostEqual(enter["y"], 3.26)
        self.assertEqual((enter["r"], enter["rx"], enter["ry"]), (-10, 11.15, 5.5))


    def test_every_layout_position_lands_on_its_own_kle_key(self):
        # 42 positions: the right-ball option drops 7,1 7,2 7,3; every other matrix label in
        # via.json is drawn once, and no two keys share a place.
        view = am338_view()
        present = [k for k in view["keys"] if k["present"]]
        self.assertEqual(len(view["keys"]), 42)
        self.assertEqual(len(present), 39)
        labels = {
            item.split("\n")[0]
            for row in load("via.json")["layouts"]["keymap"]
            if isinstance(row, list)
            for item in row
            if isinstance(item, str) and item.split("\n")[0]  # unlabelled keys are decoration
        }
        drawn = {"{},{}".format(*k["matrix"]) for k in present}
        self.assertEqual(drawn, labels - {"7,1", "7,2", "7,3"})
        places = {(k["x"], k["y"], k["r"], k["rx"], k["ry"]) for k in present}
        self.assertEqual(len(places), 39)


class BallTest(unittest.TestCase):
    def test_right_ball_removes_the_three_keys_it_sits_on(self):
        view = am338_view(ball="right")
        absent = [k["index"] for k in view["keys"] if not k["present"]]
        self.assertEqual(absent, [38, 39, 40])  # R33, R32, R31

    def test_right_ball_keeps_the_left_thumb_row(self):
        view = am338_view(ball="right")
        self.assertEqual((key(view, 31)["x"], key(view, 31)["y"]), (1, 3.25))  # L31
        self.assertEqual((key(view, 32)["x"], key(view, 32)["y"]), (2, 3.0))  # L32
        self.assertEqual((key(view, 33)["x"], key(view, 33)["y"]), (3.15, 3.5))  # L33

    def test_ball_sits_at_the_centre_of_the_keys_it_replaces(self):
        # Centres of 7,2 (10.75, 3.0), 7,1 (11.75, 3.25), 7,3 (9.6, 3.5), each + 0.5.
        balls = am338_view(ball="right")["balls"]
        self.assertEqual(len(balls), 1)
        self.assertAlmostEqual(balls[0]["x"], 11.2)
        self.assertAlmostEqual(balls[0]["y"], 3.75)
        self.assertAlmostEqual(balls[0]["d"], 34 / 19.05, places=3)

    def test_no_ball_keeps_every_key_and_draws_no_ball(self):
        view = am338_view(ball="none")
        self.assertTrue(all(k["present"] for k in view["keys"]))
        self.assertEqual(view["balls"], [])


AM338_CONFIG = {
    "layers": ["Base", "Symbol", "Number", "Function"],
    "ball": {"default": "cursor", "3": "scroll"},
    "labels": {"SCRSHOT_AREA": {"en": "Area shot", "ja": "範囲スクショ"}},
}


class LayersTest(unittest.TestCase):
    def test_layers_carry_keycodes_in_layout_order(self):
        layers = am338_view()["layers"]
        self.assertEqual(len(layers), 4)
        self.assertEqual(layers[0]["keys"][0], "ALT_T(KC_Q)")
        self.assertEqual(layers[0]["keys"][37], "LT(2, KC_ENT)")
        self.assertEqual(layers[3]["keys"][32], "LCA(KC_DEL)")

    def test_names_and_ball_modes_come_from_the_configuration(self):
        view = am338_view(config=AM338_CONFIG)
        self.assertEqual([l["name"] for l in view["layers"]], ["Base", "Symbol", "Number", "Function"])
        self.assertEqual([l["ball"] for l in view["layers"]], ["cursor", "cursor", "cursor", "scroll"])
        self.assertEqual(view["labels"]["SCRSHOT_AREA"]["ja"], "範囲スクショ")

    def test_without_configuration_layers_have_no_names_or_ball_modes(self):
        view = am338_view(config={})
        self.assertEqual([l["name"] for l in view["layers"]], [None] * 4)
        self.assertEqual([l["ball"] for l in view["layers"]], [None] * 4)
        self.assertEqual(view["labels"], {})


class SourceTest(unittest.TestCase):
    """What keymap.c says beyond the layer arrays. Line numbers are those of fixtures/am338/keymap.c."""

    def test_defines_name_keycode_expressions(self):
        self.assertEqual(
            am338_view()["defines"],
            {"TH_EISU": "LALT_T(KC_LNG2)", "TH_KANA": "LALT_T(KC_LNG1)"},
        )

    def test_combos_with_their_positions_on_the_base_layer(self):
        self.assertEqual(
            am338_view()["combos"],
            [
                {"keys": ["KC_M", "KC_BTN1"], "positions": [26, 27], "output": "KC_COMM", "line": 85},
                {"keys": ["KC_BTN1", "KC_BTN2"], "positions": [27, 28], "output": "KC_DOT", "line": 86},
                {"keys": ["KC_BTN2", "RSFT_T(KC_SLSH)"], "positions": [28, 29], "output": "KC_BSLS", "line": 87},
            ],
        )

    def test_combo_keys_match_through_define_aliases(self):
        # The base layer says TH_EISU / TH_KANA; a combo may spell out what they stand for.
        keymap_c = (FIXTURES / "keymap.c").read_text(encoding="utf-8").replace(
            "{KC_M, KC_BTN1, COMBO_END}", "{LALT_T(KC_LNG2), LALT_T(KC_LNG1), COMBO_END}"
        )
        combo = am338_view(keymap_c=keymap_c)["combos"][0]
        self.assertEqual(combo["positions"], [31, 32])

    def test_keys_handled_in_code_with_their_lines(self):
        # Keys are written without spaces so `LT(1, KC_TAB)` and `LT(1,KC_TAB)` meet.
        self.assertEqual(
            am338_view()["code"],
            {
                "LT(1,KC_TAB)": [107],
                "LT(3,KC_QUOT)": [108],
                "LT(3,KC_ESC)": [109],
                "ALT_T(KC_Q)": [134],
                "TH_EISU": [159],
                "TH_KANA": [160],
                "SCRSHOT_AREA": [186],
                "SCRSHOT_FULL": [195],
            },
        )


class FallbackAndErrorsTest(unittest.TestCase):
    def test_without_a_via_definition_keys_use_the_qmk_grid(self):
        view = am338_view(via=None)
        self.assertTrue(all(k["present"] for k in view["keys"]))
        self.assertEqual((key(view, 0)["x"], key(view, 0)["y"]), (0, 0))  # L00 in info.json
        self.assertEqual((key(view, 5)["x"], key(view, 5)["y"]), (7, 0))  # R04 in info.json
        self.assertEqual(view["balls"], [])

    def test_a_layer_of_the_wrong_length_is_a_readable_error(self):
        c2json = load("c2json.json")
        c2json["layers"][2] = c2json["layers"][2][:40]
        with self.assertRaises(ViewError) as caught:
            am338_view(c2json=c2json)
        self.assertIn("layer 2 has 40 keys", str(caught.exception))

    def test_an_unknown_layout_is_a_readable_error(self):
        c2json = dict(load("c2json.json"), layout="LAYOUT_mystery")
        with self.assertRaises(ViewError) as caught:
            am338_view(c2json=c2json)
        self.assertIn("LAYOUT_mystery", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
