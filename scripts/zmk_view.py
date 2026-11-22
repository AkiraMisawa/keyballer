"""Keyballer's keymap view for a ZMK build (docs/plans/zmk.md, phase 3).

The build's final devicetree (build/zephyr/zephyr.dts) has the keymap with every macro and include
resolved: layers with their bindings (`&kp 0x70014`), combos, behaviour nodes and the physical layout
(`&key_physical_attrs w h x y r rx ry`, in centi-keyunits and centi-degrees). This module reads it and
writes the same view file as the QMK build (src/keymap/view.ts), with each binding as the QMK keycode
that means the same, so the app's keymap screen draws it. Bindings with no QMK keycode get a name of
their own and a label.

Runs on Python 3.9.
"""

import re


class ViewError(Exception):
    pass


# --- Reading the devicetree -------------------------------------------------------------------

class Node:
    def __init__(self, name, labels):
        self.name = name
        self.labels = labels
        self.props = {}
        self.children = []

    def prop(self, name, default=None):
        return self.props.get(name, default)

    def child(self, name):
        return next((c for c in self.children if c.name == name), None)

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


_TOKEN = re.compile(r'''
    \s+ | /\*.*?\*/ | //[^\n]*                       # space and comments
  | (?P<string>"(?:[^"\\]|\\.)*")
  | (?P<ref>&[A-Za-z0-9_]+)
  | (?P<labeldef>[A-Za-z_][A-Za-z0-9_]*):(?=\s)
  | (?P<punct>[{}<>\[\];=])
  | (?P<comma>,)(?=\s)
  | (?P<word>[A-Za-z0-9_#.+@/?,\-]+)
''', re.VERBOSE | re.DOTALL)


def _tokens(text):
    at = 0
    while at < len(text):
        m = _TOKEN.match(text, at)
        if not m:
            raise ViewError("zephyr.dts: cannot read {!r}".format(text[at:at + 20]))
        at = m.end()
        kind = m.lastgroup
        if kind:
            yield kind, m.group(kind)


def parse_dts(text):
    """The root node of a devicetree source as dtlib writes it (zephyr.dts)."""
    toks = list(_tokens(text))
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else (None, None)

    def take():
        tok = peek()
        pos[0] += 1
        return tok

    def value_list():
        values = []
        while True:
            kind, tok = take()
            if tok == "<":
                while peek()[1] != ">":
                    k, t = take()
                    if k == "ref":
                        values.append(t)
                    elif k == "word":
                        values.append(int(t, 0))
                    else:
                        raise ViewError("zephyr.dts: unexpected {!r} in cells".format(t))
                take()
            elif kind == "string":
                values.append(bytes(tok[1:-1], "utf-8").decode("unicode_escape"))
            elif kind == "ref":
                values.append(tok)
            elif tok == "[":
                while peek()[1] != "]":
                    values.append(int(take()[1], 16))
                take()
            else:
                raise ViewError("zephyr.dts: unexpected {!r} in a value".format(tok))
            if peek()[0] == "comma":
                take()
                continue
            return values

    def node_body(node):
        while True:
            kind, tok = peek()
            if tok == "}":
                take()
                if peek()[1] == ";":
                    take()
                return node
            labels = []
            while peek()[0] == "labeldef":
                labels.append(take()[1])
            kind, name = take()
            if peek()[1] == "{":
                take()
                node.children.append(node_body(Node(name, labels)))
            elif peek()[1] == "=":
                take()
                node.props[name] = value_list()
                take()  # ;
            elif peek()[1] == ";":
                take()
                node.props[name] = []
            else:
                raise ViewError("zephyr.dts: unexpected {!r} after {!r}".format(peek()[1], name))

    root = Node("/", [])
    while pos[0] < len(toks):
        kind, tok = take()
        if tok == "/" and peek()[1] == "{":
            take()
            node_body(root)
        elif tok in ("/dts-v1/", ";"):
            continue
        else:
            raise ViewError("zephyr.dts: unexpected {!r} at the top".format(tok))
    return root


# --- Keycodes ---------------------------------------------------------------------------------

# HID keyboard page (0x07) usages, which QMK's basic keycodes share (QMK data/constants/keycodes,
# keycodes_0.0.1_basic.hjson), by QMK's short names.
_BASIC = {}
for _i, _c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    _BASIC[0x04 + _i] = "KC_" + _c
for _i, _c in enumerate("123456789"):
    _BASIC[0x1E + _i] = "KC_" + _c
for _i in range(12):
    _BASIC[0x3A + _i] = "KC_F{}".format(_i + 1)
    _BASIC[0x68 + _i] = "KC_F{}".format(_i + 13)
for _i in range(9):
    _BASIC[0x59 + _i] = "KC_P{}".format(_i + 1)
    _BASIC[0x87 + _i] = "KC_INT{}".format(_i + 1)
    _BASIC[0x90 + _i] = "KC_LNG{}".format(_i + 1)
_BASIC.update({
    0x27: "KC_0", 0x28: "KC_ENT", 0x29: "KC_ESC", 0x2A: "KC_BSPC", 0x2B: "KC_TAB", 0x2C: "KC_SPC",
    0x2D: "KC_MINS", 0x2E: "KC_EQL", 0x2F: "KC_LBRC", 0x30: "KC_RBRC", 0x31: "KC_BSLS", 0x32: "KC_NUHS",
    0x33: "KC_SCLN", 0x34: "KC_QUOT", 0x35: "KC_GRV", 0x36: "KC_COMM", 0x37: "KC_DOT", 0x38: "KC_SLSH",
    0x39: "KC_CAPS", 0x46: "KC_PSCR", 0x47: "KC_SCRL", 0x48: "KC_PAUS", 0x49: "KC_INS", 0x4A: "KC_HOME",
    0x4B: "KC_PGUP", 0x4C: "KC_DEL", 0x4D: "KC_END", 0x4E: "KC_PGDN", 0x4F: "KC_RGHT", 0x50: "KC_LEFT",
    0x51: "KC_DOWN", 0x52: "KC_UP", 0x53: "KC_NUM", 0x54: "KC_PSLS", 0x55: "KC_PAST", 0x56: "KC_PMNS",
    0x57: "KC_PPLS", 0x58: "KC_PENT", 0x62: "KC_P0", 0x63: "KC_PDOT", 0x64: "KC_NUBS", 0x65: "KC_APP",
    0x67: "KC_PEQL", 0x7F: "KC_KB_MUTE", 0x80: "KC_KB_VOLUME_UP", 0x81: "KC_KB_VOLUME_DOWN",
    0x85: "KC_PCMM",
})
_MODIFIERS = ["LCTL", "LSFT", "LALT", "LGUI", "RCTL", "RSFT", "RALT", "RGUI"]
for _i, _m in enumerate(_MODIFIERS):
    _BASIC[0xE0 + _i] = "KC_" + _m
# HID consumer page (0x0C) usages that QMK has keycodes for.
_CONSUMER = {
    0xE2: "KC_MUTE", 0xE9: "KC_VOLU", 0xEA: "KC_VOLD", 0xB5: "KC_MNXT", 0xB6: "KC_MPRV", 0xB7: "KC_MSTP",
    0xCD: "KC_MPLY", 0xB8: "KC_EJCT", 0x6F: "KC_BRIU", 0x70: "KC_BRID", 0xB3: "KC_MFFD", 0xB4: "KC_MRWD",
}


def keycode(param):
    """`&kp` and friends: (implicit modifiers << 24) | (HID page << 16) | usage, as a QMK keycode."""
    page, usage, mods = (param >> 16) & 0xFF, param & 0xFFFF, (param >> 24) & 0xFF
    name = (_BASIC if page == 0x07 else _CONSUMER if page == 0x0C else {}).get(usage)
    if name is None:
        return None
    for bit in reversed(range(8)):
        if mods & (1 << bit):
            name = "{}({})".format(_MODIFIERS[bit], name)
    return name


def _modifier_of(param):
    """LALT for `LEFT_ALT` (0x700e2): the modifier a hold-tap or sticky key holds, if it is one."""
    if (param >> 16) & 0xFF == 0x07 and 0xE0 <= (param & 0xFFFF) <= 0xE7 and not param >> 24:
        return _MODIFIERS[(param & 0xFFFF) - 0xE0]
    return None


# --- Bindings ---------------------------------------------------------------------------------

_BT = {0: "CLR", 1: "NXT", 2: "PRV", 3: "SEL", 4: "CLR_ALL", 5: "DISC"}
_BT_LABEL = {"CLR": "BT clear", "NXT": "BT next", "PRV": "BT prev", "CLR_ALL": "BT clear all"}
_OUT = {0: ("TOG", "USB/BT"), 1: ("USB", "USB"), 2: ("BLE", "BT")}
_RESET_UF2 = 0x57


class Converter:
    def __init__(self, root):
        self.labelled = {"&" + label: node for node in root.walk() for label in node.labels}
        self.labels = {}

    def custom(self, name, en, ja=None):
        """A keycode of Keyballer's own for a ZMK binding, with how the keymap screen labels it."""
        self.labels[name] = {"en": en, "ja": ja or en}
        return name

    def cells(self, ref):
        node = self.labelled.get(ref)
        count = (node.prop("#binding-cells") or [0])[0] if node else 0
        return node, count

    def read(self, cells):
        """Splits a bindings property into (behaviour node, reference, params) per binding."""
        out, i = [], 0
        while i < len(cells):
            ref = cells[i]
            if not isinstance(ref, str):
                raise ViewError("bindings: expected a behaviour at cell {}".format(i))
            node, count = self.cells(ref)
            out.append((node, ref, cells[i + 1:i + 1 + count]))
            i += 1 + count
        return out

    def convert(self, node, ref, params):
        compatible = (node.prop("compatible") or [""])[0] if node else ""
        kind = compatible.replace("zmk,behavior-", "")
        p = list(params) + [0, 0]
        if kind == "key-press":
            return keycode(p[0]) or self.custom("ZMK_KEY_{:X}".format(p[0]), "0x{:X}".format(p[0]))
        if kind == "transparent":
            return "KC_TRNS"
        if kind == "none":
            return "KC_NO"
        if kind == "momentary-layer":
            return "MO({})".format(p[0])
        if kind == "toggle-layer":
            return "TG({})".format(p[0])
        if kind == "to-layer":
            return "TO({})".format(p[0])
        if kind == "sticky-key":
            mod = _modifier_of(p[0])
            if mod and node.prop("bindings") and self._behaviour(node.prop("bindings")[0]) == "key-press":
                return "OSM(MOD_{})".format(mod)
            if node.prop("bindings") and self._behaviour(node.prop("bindings")[0]) == "momentary-layer":
                return "OSL({})".format(p[0])
        if kind == "mouse-key-press":
            for bit in range(5):
                if p[0] & (1 << bit):
                    return "KC_BTN{}".format(bit + 1)
        if kind == "reset":
            return "QK_BOOT" if (node.prop("type") or [0])[0] == _RESET_UF2 else "QK_RBT"
        if kind == "caps-word":
            return "CW_TOGG"
        if kind == "key-repeat":
            return "QK_REP"
        if kind == "bluetooth":
            cmd = _BT.get(p[0], str(p[0]))
            if cmd in ("SEL", "DISC"):
                word = "BT {}".format(p[1] + 1) if cmd == "SEL" else "BT disconnect {}".format(p[1] + 1)
                return self.custom("ZMK_BT_{}_{}".format(cmd, p[1]), word)
            return self.custom("ZMK_BT_{}".format(cmd), _BT_LABEL.get(cmd, "BT " + cmd))
        if kind == "outputs":
            name, word = _OUT.get(p[0], (str(p[0]), "Output"))
            return self.custom("ZMK_OUT_{}".format(name), word)
        if kind == "hold-tap":
            return self._hold_tap(node, ref, p)
        return self._named(node, ref, params)

    def _behaviour(self, ref):
        node = self.labelled.get(ref)
        return ((node.prop("compatible") or [""])[0] if node else "").replace("zmk,behavior-", "")

    def _hold_tap(self, node, ref, p):
        hold_ref, tap_ref = (node.prop("bindings") + [None, None])[:2]
        tap_node = self.labelled.get(tap_ref)
        tap = self.convert(tap_node, tap_ref, [p[1]]) if tap_node else None
        hold = self._behaviour(hold_ref)
        if hold == "momentary-layer" and tap:
            return "LT({},{})".format(p[0], tap)
        mod = _modifier_of(p[0])
        if hold == "key-press" and mod and tap:
            return "{}_T({})".format(mod, tap)
        return self._named(node, ref, p[:2])

    def _named(self, node, ref, params):
        """A behaviour with no QMK keycode (macros, mouse movement, underglow…): named after it."""
        label = ref[1:]
        text = label
        if node is not None:
            text = ((node.prop("label") or node.prop("display-name") or [label])[0]) or label
        suffix = "".join("_{:X}".format(x) for x in params)
        name = re.sub(r"[^A-Za-z0-9_]", "_", "ZMK_{}{}".format(label.upper(), suffix))
        word = text if not params else "{} {}".format(text, " ".join(_param_word(x) for x in params))
        return self.custom(name, word)


def _param_word(param):
    """A parameter as the key it names (APOSTROPHE as QUOT), or as a number."""
    name = keycode(param) if param > 0xFFFF else None
    return name[3:] if name and name.startswith("KC_") else name or str(param)


# --- The view ---------------------------------------------------------------------------------

def _signed(v):
    return v - 0x100000000 if v >= 0x80000000 else v


def _layout(root, labelled):
    chosen = root.child("chosen")
    ref = (chosen.prop("zmk,physical-layout") or [None])[0] if chosen else None
    layout = labelled.get(ref) if ref else None
    if layout is None:
        layout = next((n for n in root.walk() if "zmk,physical-layout" in (n.prop("compatible") or [])), None)
    if layout is None:
        raise ViewError("the build has no physical layout (zmk,physical-layout)")
    cells = layout.prop("keys") or []
    if len(cells) % 8:
        raise ViewError("the physical layout's keys are not groups of eight cells")
    keys = []
    for i in range(0, len(cells), 8):
        w, h, x, y, r, rx, ry = (_signed(c) / 100 for c in cells[i + 1:i + 8])
        keys.append({"index": i // 8, "matrix": [0, i // 8], "present": True,
                     "x": x, "y": y, "w": w, "h": h, "r": r, "rx": rx, "ry": ry})
    name = (layout.prop("display-name") or [layout.name])[0]
    return name, keys


def make_view(dts_text):
    root = parse_dts(dts_text)
    keymap = next((n for n in root.walk() if (n.prop("compatible") or [None])[0] == "zmk,keymap"), None)
    if keymap is None:
        raise ViewError("the build has no keymap (zmk,keymap)")
    conv = Converter(root)
    layout_name, keys = _layout(root, conv.labelled)

    layers = []
    for layer in keymap.children:
        bindings = [conv.convert(*b) for b in conv.read(layer.prop("bindings") or [])]
        if len(bindings) != len(keys):
            raise ViewError("layer {} has {} bindings for {} keys".format(layer.name, len(bindings), len(keys)))
        layers.append({"name": (layer.prop("display-name") or [layer.name])[0], "ball": None, "keys": bindings})
    if not layers:
        raise ViewError("the keymap has no layers")

    combos = []
    combos_node = next((n for n in root.walk() if (n.prop("compatible") or [None])[0] == "zmk,combos"), None)
    for combo in combos_node.children if combos_node else []:
        positions = list(combo.prop("key-positions") or [])
        bound = conv.read(combo.prop("bindings") or [])
        if not bound or any(not 0 <= p < len(keys) for p in positions):
            continue
        combos.append({"keys": [layers[0]["keys"][p] for p in positions], "positions": positions,
                       "output": conv.convert(*bound[0]), "line": 0})

    return {
        "schema": 1,
        "layout": layout_name,
        "keys": keys,
        "balls": [],
        "layers": layers,
        "labels": conv.labels,
        "defines": {},
        "combos": combos,
        "code": {},
    }
