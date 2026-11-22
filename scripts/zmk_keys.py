"""Writes the fixture that checks the app's table of ZMK key names (src/keymap/zmkKeys.ts):
every name ZMK's keys.h defines, with the keycode the build's reader (zmk_view.keycode) makes of
its value. Run it with ZMK's include folder (app/include at the pinned ZMK commit):

    python3 scripts/zmk_keys.py <zmk>/app/include src/keymap/zmk-keys.json

It runs the C preprocessor (clang or gcc -E) over keys.h, as ZMK's build does, so the values are
ZMK's own. Not part of the build; the fixture is committed with the ZMK commit it came from.
"""

import ast
import json
import operator
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from zmk_view import keycode

_OPS = {ast.BitOr: operator.or_, ast.BitAnd: operator.and_, ast.LShift: operator.lshift,
        ast.RShift: operator.rshift, ast.Add: operator.add, ast.Sub: operator.sub}


def _value(node):
    """An integer expression of the kind keys.h expands to: numbers, | & << >> + - and ~."""
    if isinstance(node, ast.Expression):
        return _value(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_value(node.left), _value(node.right))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.Invert, ast.USub)):
        return ~_value(node.operand) if isinstance(node.op, ast.Invert) else -_value(node.operand)
    raise ValueError("not an integer expression: {}".format(ast.dump(node)))


def main():
    include, out = Path(sys.argv[1]), Path(sys.argv[2])
    keys_h = include / "dt-bindings" / "zmk" / "keys.h"
    names = re.findall(r"^#define ([A-Z][A-Z0-9_]*) ", keys_h.read_text(encoding="utf-8"), re.M)
    cc = shutil.which("clang") or shutil.which("gcc")
    with tempfile.TemporaryDirectory() as tmp:
        probe = Path(tmp) / "probe.c"
        # A string is not expanded, so each line keeps its name next to its value.
        probe.write_text("#include <dt-bindings/zmk/keys.h>\n" + "".join('"{0}" {0}\n'.format(n) for n in names))
        expanded = subprocess.run([cc, "-E", "-P", "-x", "c", "-I", str(include), str(probe)],
                                  check=True, capture_output=True, text=True).stdout
    table = {}
    for line in expanded.splitlines():
        m = re.fullmatch(r'"([A-Z][A-Z0-9_]*)" (.+)', line.strip())
        if m:
            table[m.group(1)] = keycode(_value(ast.parse(m.group(2), mode="eval")))
    if set(table) != set(names):
        sys.exit("keys.h: could not read {}".format(sorted(set(names) - set(table))))
    out.write_text(json.dumps(table, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print("{} names".format(len(table)))


if __name__ == "__main__":
    main()
