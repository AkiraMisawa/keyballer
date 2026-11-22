# am338 fixtures

Real inputs for `test_keyballer_view.py`, captured from a local build of the
`am338` keymap for Keyball+ (QMK 0.22.14, Yowkees/keyball at
4664de991d14da34bd42e7031ac7406b6ccb02af).

| File | Where it comes from | License |
| --- | --- | --- |
| `c2json.json` | `qmk c2json --no-cpp -kb keyball/keyballplus -km am338 keymap.c` | — |
| `info.json` | `qmk info -kb keyball/keyballplus -f json`, trimmed to `keyboard_name`, `layouts` and `layout_aliases` | GPL-2.0-or-later (QMK) |
| `via.json` | `keyboards/keyball/keyballplus/via.json` in Yowkees/keyball | GPL-3.0 (Yowkees/keyball) |
| `keymap.c` | `keymaps/am338/keymap.c` in the owner's keyballer-config | GPL-2.0-or-later, like QMK keymaps |

Line numbers in the tests are those of this `keymap.c`. When the keymap
changes, keep this copy as it is; it is a fixture, not the live keymap.
