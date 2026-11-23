"""Writes the table that checks the app's QMK key names (src/keymap/catalogue.ts, keycodes.ts):
every keycode name and every keycode function (LT, LSFT_T, OSM…) that a QMK version defines, and
Keyball's own keycodes. Run it with the QMK tag and the Keyball commit the builds pin:

    python3 scripts/qmk_keys.py 0.22.14 4664de991d14da34bd42e7031ac7406b6ccb02af src/keymap/qmk-keys.json

It reads the headers from raw.githubusercontent.com. Before moving to another QMK version, write
the table for it and run `npm test`: keys the app offers that the new version no longer has fail.
Not part of the build; the table is committed with the versions it came from.
"""

import json
import re
import sys
import urllib.request

# The headers a keymap's keycodes come from (quantum.h includes them all).
QMK_HEADERS = [
    "quantum/keycodes.h",
    "quantum/quantum_keycodes.h",
    "quantum/quantum_keycodes_legacy.h",
    "quantum/modifiers.h",
    "quantum/keymap_extras/keymap_us.h",
]
KEYBALL_HEADER = "qmk_firmware/keyboards/keyball/lib/keyball/keyball.h"

_COMMENT = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
_DEFINE = re.compile(r"^[ \t]*#[ \t]*define[ \t]+([A-Za-z_][A-Za-z0-9_]*)(\()?", re.M)
_ENUM = re.compile(r"\benum\b[^{;]*\{(.*?)\}", re.S)
_MEMBER = re.compile(r"(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?==|,|$)")


def names_in(text):
    """The names a header defines: object-like macros and enum members, and function-like macros."""
    text = _COMMENT.sub(" ", text)
    names, functions = set(), set()
    for m in _DEFINE.finditer(text):
        (functions if m.group(2) else names).add(m.group(1))
    for body in _ENUM.findall(text):
        names.update(_MEMBER.findall(body))
    return names, functions


def fetch(repo, ref, path):
    url = "https://raw.githubusercontent.com/{}/{}/{}".format(repo, ref, path)
    with urllib.request.urlopen(url, timeout=30) as res:
        return res.read().decode("utf-8")


def main():
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    qmk_ref, keyball_ref, out = sys.argv[1:]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", qmk_ref) or not re.fullmatch(r"[0-9a-f]{40}", keyball_ref):
        print("give a QMK tag such as 0.22.14 and a full Keyball commit SHA", file=sys.stderr)
        return 2
    names, functions = set(), set()
    for path in QMK_HEADERS:
        n, f = names_in(fetch("qmk/qmk_firmware", qmk_ref, path))
        names |= n
        functions |= f
    keyball, _ = names_in(fetch("Yowkees/keyball", keyball_ref, KEYBALL_HEADER))
    table = {
        "qmk": qmk_ref,
        "keyball": keyball_ref,
        "names": sorted(names),
        "functions": sorted(functions),
        "keyball_names": sorted(keyball),
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(table, f, indent=1)
        f.write("\n")
    print("{}: {} names, {} functions, {} Keyball names".format(out, len(names), len(functions), len(keyball)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
