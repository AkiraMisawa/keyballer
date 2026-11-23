"""The QMK key name table (scripts/qmk_keys.py): which names a header defines."""

import unittest

from qmk_keys import names_in


class NamesIn(unittest.TestCase):
    def test_reads_enum_members_and_macros_but_not_values_or_comments(self):
        names, functions = names_in(
            "enum qk_keycode_defines {\n"
            "    KC_NO = 0x0000,\n"
            "    KC_TRANSPARENT = 0x0001, // KC_TRNS below\n"
            "    QK_BOOT = 0x7C00,\n"
            "    KC_TRNS = KC_TRANSPARENT,\n"
            "};\n"
            "/* #define KC_OLD 1 */\n"
            "#define KC_EXLM LSFT(KC_1)\n"
            "#define LT(layer, kc) (QK_LAYER_TAP | (kc))\n"
            "#  define MOD_LCTL 0x01\n"
        )
        self.assertEqual(names, {"KC_NO", "KC_TRANSPARENT", "QK_BOOT", "KC_TRNS", "KC_EXLM", "MOD_LCTL"})
        self.assertEqual(functions, {"LT"})


if __name__ == "__main__":
    unittest.main()
