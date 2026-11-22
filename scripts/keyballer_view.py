"""Builds the view file: a keymap drawn on the board's real shape.

make_view joins what the build already has:

- the keymap from `qmk c2json` (layout name and keycodes per layer),
- matrix positions per layout index from `qmk info`,
- the board's shape from its VIA definition (KLE), and
- the keymap source, read as text for aliases, combos and code-handled keys.

Pure: no files, no subprocesses. Runs on Python 3.9 (the qmk_cli image).
"""

import re


def parse_kle(rows):
    """KLE rows -> keys with absolute, unrotated positions in key units.

    Follows kle-serial: each key starts where the previous one ended, each row
    starts one unit lower at the rotation origin's x, and a row that sets rx/ry
    restarts from that origin.
    """
    keys = []
    x = y = 0.0
    r = rx = ry = 0.0
    for row in rows:
        if not isinstance(row, list):
            continue  # keyboard metadata
        width = height = 1.0
        for item in row:
            if isinstance(item, dict):
                if "r" in item:
                    r = float(item["r"])
                if "rx" in item:
                    rx = float(item["rx"])
                    x, y = rx, ry
                if "ry" in item:
                    ry = float(item["ry"])
                    x, y = rx, ry
                x += float(item.get("x", 0))
                y += float(item.get("y", 0))
                width = float(item.get("w", width))
                height = float(item.get("h", height))
                continue
            labels = item.split("\n")
            option = labels[3] if len(labels) > 3 and labels[3] else None
            keys.append({
                "matrix": labels[0] or None,
                "option": tuple(int(p) for p in option.split(",")) if option else None,
                "x": round(x, 6), "y": round(y, 6), "w": width, "h": height,
                "r": r, "rx": rx, "ry": ry,
            })
            x += width
            width = height = 1.0
        y += 1
        x = rx
    return keys


BALL_MM = 34.0
KEY_UNIT_MM = 19.05


class ViewError(Exception):
    """The view cannot be made; the message says why, for the manifest."""


def _layout_keys(info, layout):
    name = info.get("layout_aliases", {}).get(layout, layout)
    if name not in info.get("layouts", {}):
        raise ViewError("the keyboard has no layout {}".format(layout))
    return info["layouts"][name]["layout"]


def _grid(layout_keys):
    """Positions straight from the QMK layout, for keyboards without a VIA definition."""
    by_matrix = {}
    for lk in layout_keys:
        by_matrix["{},{}".format(*lk["matrix"])] = {
            "x": lk.get("x", 0), "y": lk.get("y", 0), "w": lk.get("w", 1), "h": lk.get("h", 1),
            "r": lk.get("r", 0), "rx": lk.get("rx", 0), "ry": lk.get("ry", 0),
        }
    return by_matrix, []


def _choices(via_labels, ball):
    """The chosen choice per VIA layout option group, and which group is the ball's."""
    chosen, ball_group = {}, None
    for group, label in enumerate(via_labels or []):
        if not isinstance(label, list):
            continue  # a plain toggle option; keep its default
        chosen[group] = 0
        if "ball" in label[0].lower():
            ball_group = group
            names = [n.lower() for n in label[1:]]
            if ball in names:
                chosen[group] = names.index(ball)
    return chosen, ball_group


def _centre(k):
    return (k["x"] + k["w"] / 2, k["y"] + k["h"] / 2)


def _balls(replaced):
    """One ball per cluster of replaced keys (two for a dual-ball board)."""
    clusters = []
    for k in sorted(replaced, key=lambda k: _centre(k)[0]):
        if clusters and _centre(k)[0] - _centre(clusters[-1][-1])[0] <= 2:
            clusters[-1].append(k)
        else:
            clusters.append([k])
    d = round(BALL_MM / KEY_UNIT_MM, 4)
    return [
        {
            "x": round(sum(_centre(k)[0] for k in c) / len(c), 4),
            "y": round(sum(_centre(k)[1] for k in c) / len(c), 4),
            "d": d,
        }
        for c in clusters
    ]


def _geometry(via, ball):
    """Key rectangles by matrix label for the chosen layout options, and the balls."""
    kle = parse_kle(via["layouts"]["keymap"])
    chosen, ball_group = _choices(via["layouts"].get("labels"), ball)

    def in_option(k, group, choice):
        return k["option"] == (group, choice)

    by_matrix = {k["matrix"]: dict(k) for k in kle if k["matrix"] and k["option"] is None}
    replaced = []
    for group, choice in chosen.items():
        defaults = [k for k in kle if in_option(k, group, 0)]
        picked = [k for k in kle if in_option(k, group, choice)]
        # VIA draws every choice where the first one is: align by their top-left corners.
        dx = min((k["x"] for k in defaults), default=0) - min((k["x"] for k in picked), default=0)
        dy = min((k["y"] for k in defaults), default=0) - min((k["y"] for k in picked), default=0)
        for k in picked:
            if k["matrix"]:
                by_matrix[k["matrix"]] = dict(k, x=round(k["x"] + dx, 6), y=round(k["y"] + dy, 6))
        if group == ball_group:
            kept = {k["matrix"] for k in picked if k["matrix"]}
            replaced += [k for k in defaults if k["matrix"] and k["matrix"] not in kept]
    return by_matrix, _balls(replaced)


def norm(code):
    """A keycode expression without spaces, so `LT(1, KC_A)` and `LT(1,KC_A)` meet."""
    return re.sub(r"\s+", "", code)


def _blank_comments(source):
    """Comments replaced by spaces, keeping every newline so line numbers hold."""
    def blank(m):
        return re.sub(r"[^\n]", " ", m.group(0))
    return re.sub(r"/\*.*?\*/|//[^\n]*", blank, source, flags=re.S)


def _split_args(text):
    """Comma-separated arguments at the top level of parentheses."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(text[start:i].strip())
            start = i + 1
    parts.append(text[start:].strip())
    return [p for p in parts if p]


def _call_args(source, at):
    """Arguments of the call whose opening parenthesis is at `at`."""
    depth = 0
    for i in range(at, len(source)):
        if source[i] == "(":
            depth += 1
        elif source[i] == ")":
            depth -= 1
            if depth == 0:
                return _split_args(source[at + 1:i])
    return []


def _line_of(source, offset):
    return source.count("\n", 0, offset) + 1


def _read_source(keymap_c, layers):
    source = _blank_comments(keymap_c)
    used = {norm(code) for layer in layers for code in layer}

    every_define = {
        m.group(1): m.group(2)
        for m in re.finditer(r"^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+(\S[^\n]*?)[ \t]*$", source, re.M)
    }
    defines = {name: value for name, value in every_define.items() if norm(name) in used}
    known = used | {norm(v) for v in defines.values()}

    def expand(code):
        """A keycode with #define aliases replaced by what they stand for."""
        for _ in range(8):
            if code not in every_define:
                break
            code = norm(every_define[code])
        return code

    arrays = {}
    for m in re.finditer(r"PROGMEM\s+(\w+)\s*\[\s*\]\s*=\s*\{(.*?)\}", source, re.S):
        keys = [k for k in _split_args(m.group(2)) if k != "COMBO_END"]
        arrays[m.group(1)] = (keys, _line_of(source, m.start()))
    base = [expand(norm(code)) for code in layers[0]] if layers else []
    combos = []
    for m in re.finditer(r"\bCOMBO\s*\(", source):
        args = _call_args(source, m.end() - 1)
        if len(args) != 2 or args[0] not in arrays:
            continue
        keys, line = arrays[args[0]]
        wanted = [expand(norm(k)) for k in keys]
        positions = [base.index(k) if k in base else None for k in wanted]
        combos.append({"keys": keys, "positions": positions, "output": args[1], "line": line})

    code = {}
    for m in re.finditer(r"\bcase\s+([^:;]+?)\s*:", source):
        label = norm(m.group(1))
        if label in known:
            code.setdefault(label, []).append(_line_of(source, m.start()))
    return defines, combos, code


def make_view(c2json, info, via, keymap_c, config, ball="right"):
    layout = c2json["layout"]
    layout_keys = _layout_keys(info, layout)
    for n, codes in enumerate(c2json["layers"]):
        if len(codes) != len(layout_keys):
            raise ViewError(
                "layer {} has {} keys; {} has {}".format(n, len(codes), layout, len(layout_keys))
            )
    by_matrix, balls = _geometry(via, ball) if via else _grid(layout_keys)

    keys = []
    for index, lk in enumerate(layout_keys):
        row, col = lk["matrix"]
        geo = by_matrix.get("{},{}".format(row, col))
        entry = {"index": index, "matrix": [row, col], "present": geo is not None}
        if geo:
            entry.update({f: geo[f] for f in ("x", "y", "w", "h", "r", "rx", "ry")})
        keys.append(entry)
    names = config.get("layers") or []
    modes = config.get("ball") or {}
    layers = []
    for n, codes in enumerate(c2json["layers"]):
        layers.append({
            "name": names[n] if n < len(names) else None,
            "ball": modes.get(str(n), modes.get("default")),
            "keys": list(codes),
        })

    defines, combos, code = _read_source(keymap_c, c2json["layers"])

    return {
        "schema": 1,
        "layout": layout,
        "keys": keys,
        "balls": balls,
        "layers": layers,
        "labels": dict(config.get("labels") or {}),
        "defines": defines,
        "combos": combos,
        "code": code,
    }
