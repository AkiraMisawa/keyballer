#!/usr/bin/env python3
"""Build the QMK firmware described by a Keyballer config repository.

usage:
  build_qmk.py CONFIG_DIR OUT_DIR [--only ID]   build firmware into OUT_DIR
  build_qmk.py CONFIG_DIR --list                print build ids as a JSON array
  build_qmk.py CONFIG_DIR --image               print the qmk_cli image to build in

For every build, OUT_DIR receives <id>.<hex|bin|uf2> and <id>.json with
details the app needs (size, MCU, bootloader, split).

Environment:
  KEYBALLER_QMK_HOME  an existing qmk_firmware checkout to use as is. When
                      unset, the QMK version from keyballer.json is cloned
                      into WORK_DIR. (QMK_HOME is not used: the qmk_cli
                      image already sets it to a directory that is empty.)
  WORK_DIR            scratch directory for clones (default: ./.keyballer-work).

Runs on Python 3.9 (the qmk_cli image).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from keyballer_view import ViewError, make_view

CONFIG_FILE = "keyballer.json"
DEFAULT_IMAGE = (
    "ghcr.io/qmk/qmk_cli@sha256:"
    "2dc05fc9f32efebd6b05c2b8676ee548358bc7e151e9dbf4dac6b6eed4513b07"
)
FIRMWARE_EXTS = ("hex", "bin", "uf2")
BALL_SIDES = ("none", "right", "left", "dual")
# keyballer.json is untrusted input: its values reach $GITHUB_OUTPUT, container images and git.
# Patterns are used with fullmatch, so a trailing newline never passes.
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]*")
VERSION_PATTERN = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
# An image pinned by digest: a tag can be moved, a digest cannot.
IMAGE_PATTERN = re.compile(r"[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}")
# GitHub owners use letters, digits and "-"; repository names may also use "." and "_", but not be "." or "..".
REPO_PATTERN = re.compile(r"[A-Za-z0-9-]+/(?!\.\.?$)[A-Za-z0-9_.-]+")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
NAME_PATTERN = re.compile(r"[A-Za-z0-9_-]+")
PATH_SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]*")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
SIZE_LINE = re.compile(r"firmware size .*?(\d+)/(\d+)")


class ConfigError(Exception):
    pass


def _full(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def load_config(config_dir):
    path = config_dir / CONFIG_FILE
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError("{} not found".format(path))
    except json.JSONDecodeError as e:
        raise ConfigError("{} is not valid JSON: {}".format(path, e))

    if cfg.get("firmware") != "qmk":
        raise ConfigError('"firmware" must be "qmk"')
    if not isinstance(cfg.get("qmk"), dict) or not cfg["qmk"].get("version"):
        raise ConfigError('"qmk.version" is required')
    if not _full(VERSION_PATTERN, cfg["qmk"]["version"]):
        raise ConfigError('"qmk.version" must look like 0.22.14')
    image = cfg["qmk"].get("image")
    if image is not None and not _full(IMAGE_PATTERN, image):
        raise ConfigError('"qmk.image" must be pinned by digest (name@sha256:...)')

    for i, src in enumerate(cfg.get("sources", [])):
        for key in ("repo", "ref", "path", "as"):
            if not src.get(key):
                raise ConfigError('sources[{}] needs "{}"'.format(i, key))
        if not _full(REPO_PATTERN, src["repo"]):
            raise ConfigError('sources[{}].repo must be owner/name'.format(i))
        if not _full(COMMIT_PATTERN, src["ref"]):
            raise ConfigError(
                'sources[{}].ref must be a full commit SHA: a branch or tag can change without a commit here'.format(i)
            )
        if not (isinstance(src["path"], str) and all(_full(PATH_SEGMENT, seg) for seg in src["path"].split("/"))):
            raise ConfigError('sources[{}].path must be a plain relative path'.format(i))
        if not _full(NAME_PATTERN, src["as"]):
            raise ConfigError('sources[{}].as may only use letters, digits, "-" and "_"'.format(i))

    builds = cfg.get("builds")
    if not isinstance(builds, list) or not builds:
        raise ConfigError('"builds" must list at least one build')
    seen = set()
    for i, b in enumerate(builds):
        for key in ("id", "name", "keyboard", "keymap", "keymap_dir"):
            if not b.get(key):
                raise ConfigError('builds[{}] needs "{}"'.format(i, key))
        if not _full(ID_PATTERN, b["id"]):
            raise ConfigError(
                'builds[{}].id "{}" may only use a-z, 0-9, "-" and "_"'.format(i, b["id"])
            )
        if b["id"] in seen:
            raise ConfigError('build id "{}" is used twice'.format(b["id"]))
        seen.add(b["id"])
        if not (config_dir / b["keymap_dir"]).is_dir():
            raise ConfigError(
                'builds[{}].keymap_dir "{}" is not a directory'.format(i, b["keymap_dir"])
            )
        if b.get("ball", "right") not in BALL_SIDES:
            raise ConfigError(
                'builds[{}].ball must be one of {}'.format(i, ", ".join(BALL_SIDES))
            )
    views = cfg.get("views", {})
    if not isinstance(views, dict) or not all(isinstance(v, dict) for v in views.values()):
        raise ConfigError('"views" must map keymap directories to settings')
    return cfg


def qmk_env(qmk):
    """Environment for qmk CLI commands, pointed at our checkout."""
    env = dict(os.environ)
    env["QMK_HOME"] = str(qmk)
    return env


def run(cmd, cwd=None, capture=False, env=None):
    print("+ " + " ".join(str(c) for c in cmd), flush=True)
    if not capture:
        subprocess.run(cmd, cwd=cwd, check=True, env=env)
        return ""
    proc = subprocess.run(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env
    )
    print(proc.stdout, end="", flush=True)
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout)
    return proc.stdout


def ensure_qmk(version, work_dir):
    home = os.environ.get("KEYBALLER_QMK_HOME")
    if home:
        qmk = Path(home).resolve()
        if not (qmk / "keyboards").is_dir():
            raise ConfigError("KEYBALLER_QMK_HOME={} is not a qmk_firmware checkout".format(home))
        return qmk
    qmk = work_dir / "qmk_firmware"
    if not (qmk / ".git").is_dir():
        run([
            "git", "clone", "--quiet", "--depth", "1", "--branch", version,
            "--recurse-submodules", "--shallow-submodules",
            "https://github.com/qmk/qmk_firmware.git", str(qmk),
        ])
        run([sys.executable, "-m", "pip", "install", "--quiet", "-r",
             str(qmk / "requirements.txt")])
    return qmk.resolve()


def fetch_source(src, work_dir, qmk):
    dest = work_dir / "sources" / src["as"]
    head = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "HEAD"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ).stdout.strip()
    if head != src["ref"]:
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        run(["git", "-C", str(dest), "init", "--quiet"])
        run(["git", "-C", str(dest), "fetch", "--quiet", "--depth", "1",
             "https://github.com/{}.git".format(src["repo"]), src["ref"]])
        run(["git", "-C", str(dest), "checkout", "--quiet", "FETCH_HEAD"])

    target = dest / src["path"]
    if not target.is_dir():
        raise ConfigError('{} has no "{}"'.format(src["repo"], src["path"]))
    link = qmk / "keyboards" / src["as"]
    if link.is_symlink():
        link.unlink()
    elif link.exists():
        raise ConfigError(
            'QMK already has keyboards/{}; pick another "as" name'.format(src["as"])
        )
    link.symlink_to(target, target_is_directory=True)


def qmk_json(qmk, args):
    """Runs a qmk command that prints JSON; None when it fails or prints something else."""
    out = subprocess.run(
        ["qmk"] + args, cwd=qmk, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        env=qmk_env(qmk),
    ).stdout
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def keyboard_summary(info):
    if not info:
        return {}
    split = info.get("split", {})
    return {
        "processor": info.get("processor"),
        "bootloader": info.get("bootloader"),
        "split": bool(split.get("enabled")) if isinstance(split, dict) else False,
    }


def find_via(qmk, keyboard):
    """The keyboard's VIA definition, looking from its folder up to its source root."""
    folder = qmk / "keyboards" / keyboard
    root = qmk / "keyboards"
    while folder != root and folder.parent != folder:
        candidate = folder / "via.json"
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
        folder = folder.parent
    return None


def write_view(build, cfg, qmk, keymap_in_qmk, info, out_dir):
    """Writes <id>.view.json and returns the manifest fields: view, or view_error."""
    keymap_dir = build["keymap_dir"]
    keymap_c = keymap_in_qmk / "keymap.c"
    try:
        if not keymap_c.is_file():
            raise ViewError("{} has no keymap.c".format(keymap_dir))
        c2json = qmk_json(qmk, ["c2json", "--no-cpp", "-kb", build["keyboard"], "-km", build["keymap"], str(keymap_c)])
        if not c2json or "layers" not in c2json:
            raise ViewError("QMK could not read the layers in keymap.c")
        if not info:
            raise ViewError("QMK could not describe keyboard {}".format(build["keyboard"]))
        view = make_view(
            c2json=c2json,
            info=info,
            via=find_via(qmk, build["keyboard"]),
            keymap_c=keymap_c.read_text(encoding="utf-8"),
            config=cfg.get("views", {}).get(keymap_dir, {}),
            ball=build.get("ball", "right"),
        )
    except ViewError as e:
        print("No keymap view for {}: {}".format(build["id"], e), flush=True)
        return {"view_error": str(e)}
    except Exception as e:  # the view must never fail the build
        print("No keymap view for {}: {!r}".format(build["id"], e), flush=True)
        return {"view_error": "Keyballer could not read the keyboard definition or keymap ({}: {})".format(
            type(e).__name__, e)}
    view["keyboard"] = build["keyboard"]
    view["keymap"] = build["keymap"]
    view["source"] = {"path": "{}/keymap.c".format(keymap_dir)}
    # Set by GitHub Actions: where the links to keymap.c lines point.
    if os.environ.get("GITHUB_REPOSITORY") and os.environ.get("GITHUB_SHA"):
        view["source"]["repository"] = os.environ["GITHUB_REPOSITORY"]
        view["source"]["commit"] = os.environ["GITHUB_SHA"]
    name = "{}.view.json".format(build["id"])
    (out_dir / name).write_text(json.dumps(view, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"view": name}


def build_one(build, cfg, config_dir, qmk, out_dir):
    keyboard, keymap = build["keyboard"], build["keymap"]
    print("::group::Build {} ({}:{})".format(build["id"], keyboard, keymap), flush=True)
    try:
        keymaps_dir = qmk / "keyboards" / keyboard / "keymaps"
        if not keymaps_dir.is_dir():
            raise ConfigError("keyboard {} was not found".format(keyboard))
        dst = keymaps_dir / keymap
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(config_dir / build["keymap_dir"], dst)

        for ext in FIRMWARE_EXTS:
            stale = qmk / "{}_{}.{}".format(keyboard.replace("/", "_"), keymap, ext)
            if stale.exists():
                stale.unlink()

        log = ANSI.sub("", run(
            ["qmk", "compile", "-kb", keyboard, "-km", keymap],
            cwd=qmk, capture=True, env=qmk_env(qmk),
        ))
    finally:
        print("::endgroup::", flush=True)

    produced = [
        qmk / "{}_{}.{}".format(keyboard.replace("/", "_"), keymap, ext)
        for ext in FIRMWARE_EXTS
    ]
    produced = [p for p in produced if p.exists()]
    if not produced:
        raise RuntimeError("QMK built {}:{} but no firmware file was found".format(keyboard, keymap))
    firmware = produced[0]
    ext = firmware.suffix[1:]
    out_file = "{}.{}".format(build["id"], ext)
    shutil.copyfile(firmware, out_dir / out_file)

    size = SIZE_LINE.search(log)
    meta = {
        "id": build["id"],
        "name": build["name"],
        "keyboard": keyboard,
        "keymap": keymap,
        "file": out_file,
        "format": ext,
        "size": int(size.group(1)) if size else None,
        "max_size": int(size.group(2)) if size else None,
    }
    info = qmk_json(qmk, ["info", "-kb", keyboard, "-f", "json"])
    meta.update(keyboard_summary(info))
    meta.update(write_view(build, cfg, qmk, dst, info, out_dir))
    (out_dir / "{}.json".format(build["id"])).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return meta


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("config_dir", type=Path)
    parser.add_argument("out_dir", type=Path, nargs="?")
    parser.add_argument("--only", metavar="ID", help="build only this id")
    parser.add_argument("--list", action="store_true", help="print build ids as JSON")
    parser.add_argument("--image", action="store_true", help="print the qmk_cli image")
    args = parser.parse_args()

    config_dir = args.config_dir.resolve()
    try:
        cfg = load_config(config_dir)
    except ConfigError as e:
        print("keyballer.json: {}".format(e), file=sys.stderr)
        return 2

    if args.list:
        print(json.dumps([b["id"] for b in cfg["builds"]]))
        return 0
    if args.image:
        print(cfg["qmk"].get("image") or DEFAULT_IMAGE)
        return 0
    if args.out_dir is None:
        parser.error("OUT_DIR is required when building")

    builds = cfg["builds"]
    if args.only:
        builds = [b for b in builds if b["id"] == args.only]
        if not builds:
            print('no build with id "{}"'.format(args.only), file=sys.stderr)
            return 2

    work_dir = Path(os.environ.get("WORK_DIR", ".keyballer-work")).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        qmk = ensure_qmk(cfg["qmk"]["version"], work_dir)
        for src in cfg.get("sources", []):
            fetch_source(src, work_dir, qmk)
        for build in builds:
            meta = build_one(build, cfg, config_dir, qmk, out_dir)
            print("Built {}: {} ({} / {} bytes)".format(
                meta["id"], meta["file"], meta["size"], meta["max_size"]), flush=True)
    except (ConfigError, RuntimeError) as e:
        print("error: {}".format(e), file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print("error: command failed ({}): {}".format(e.returncode, " ".join(map(str, e.cmd))),
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
