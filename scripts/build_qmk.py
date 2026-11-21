#!/usr/bin/env python3
"""Build the QMK firmware described by a Keyballer config repository.

usage:
  build_qmk.py CONFIG_DIR OUT_DIR [--only ID]   build firmware into OUT_DIR
  build_qmk.py CONFIG_DIR --list                print build ids as a JSON array
  build_qmk.py CONFIG_DIR --image               print the qmk_cli image to build in

For every build, OUT_DIR receives <id>.<hex|bin|uf2> and <id>.json with
details the app needs (size, MCU, bootloader, split).

Environment:
  QMK_HOME  an existing qmk_firmware checkout to use as is. When unset, the
            QMK version from keyballer.json is cloned into WORK_DIR.
  WORK_DIR  scratch directory for clones (default: ./.keyballer-work).

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

CONFIG_FILE = "keyballer.json"
DEFAULT_IMAGE = (
    "ghcr.io/qmk/qmk_cli@sha256:"
    "2dc05fc9f32efebd6b05c2b8676ee548358bc7e151e9dbf4dac6b6eed4513b07"
)
FIRMWARE_EXTS = ("hex", "bin", "uf2")
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
SIZE_LINE = re.compile(r"firmware size .*?(\d+)/(\d+)")


class ConfigError(Exception):
    pass


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

    for i, src in enumerate(cfg.get("sources", [])):
        for key in ("repo", "ref", "path", "as"):
            if not src.get(key):
                raise ConfigError('sources[{}] needs "{}"'.format(i, key))

    builds = cfg.get("builds")
    if not isinstance(builds, list) or not builds:
        raise ConfigError('"builds" must list at least one build')
    seen = set()
    for i, b in enumerate(builds):
        for key in ("id", "name", "keyboard", "keymap", "keymap_dir"):
            if not b.get(key):
                raise ConfigError('builds[{}] needs "{}"'.format(i, key))
        if not ID_PATTERN.match(b["id"]):
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
    return cfg


def run(cmd, cwd=None, capture=False):
    print("+ " + " ".join(str(c) for c in cmd), flush=True)
    if not capture:
        subprocess.run(cmd, cwd=cwd, check=True)
        return ""
    proc = subprocess.run(
        cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    print(proc.stdout, end="", flush=True)
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout)
    return proc.stdout


def ensure_qmk(version, work_dir):
    home = os.environ.get("QMK_HOME")
    if home:
        return Path(home).resolve()
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


def keyboard_info(qmk, keyboard):
    out = subprocess.run(
        ["qmk", "info", "-kb", keyboard, "-f", "json"],
        cwd=qmk, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ).stdout
    try:
        info = json.loads(out)
    except json.JSONDecodeError:
        return {}
    split = info.get("split", {})
    return {
        "processor": info.get("processor"),
        "bootloader": info.get("bootloader"),
        "split": bool(split.get("enabled")) if isinstance(split, dict) else False,
    }


def build_one(build, config_dir, qmk, out_dir):
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
            ["qmk", "compile", "-kb", keyboard, "-km", keymap], cwd=qmk, capture=True
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
    meta.update(keyboard_info(qmk, keyboard))
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
            meta = build_one(build, config_dir, qmk, out_dir)
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
