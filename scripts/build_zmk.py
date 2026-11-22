#!/usr/bin/env python3
"""Build the ZMK firmware described by a Keyballer config repository (docs/plans/zmk.md).

usage:
  build_zmk.py CONFIG_DIR OUT_DIR --only ID   build one firmware into OUT_DIR
  build_zmk.py CONFIG_DIR --list              print build ids as a JSON array
  build_zmk.py CONFIG_DIR --image             print the zmk-build-arm image to build in

CONFIG_DIR is a ZMK user config repository with keyballer.json at its top and
config/west.yml. For the build, OUT_DIR receives <id>.uf2 (checked block by
block), <id>.west.yml (the frozen west manifest) and <id>.json with details
the app needs (role, board, shield, UF2 range, ZMK and Zephyr commits).

Every value from keyballer.json and config/west.yml is untrusted: values are
checked with fullmatch and reach west and git as argument lists, never shell
text. Every west project must be pinned by commit SHA, and every commit must be
contained in a branch or tag of the repository it is fetched from.

Environment:
  WORK_DIR  scratch directory for the west workspace (default: ./.keyballer-work).

Runs on Python 3.9 or later (the zmk-build-arm image).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from uf2check import UF2Error, check_uf2

CONFIG_FILE = "keyballer.json"
ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]*")
NAME_TEXT = re.compile(r"[^\x00-\x1f\x7f]{1,80}")
# Zephyr board names, with an optional revision and qualifiers: nice_nano@2.0.0, xiao_ble//zmk.
BOARD_PATTERN = re.compile(r"[a-z0-9_]+(@[0-9.]+)?(/[a-z0-9_]*)*")
# One or more shields or snippets, separated by single spaces.
WORDS_PATTERN = re.compile(r"[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*")
IMAGE_PATTERN = re.compile(r"[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
GITHUB_OWNER_URL = re.compile(r"https://github\.com/[A-Za-z0-9-]+")
WEST_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]*")
PATH_SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]*")
BUILD_KEYS = {"id", "name", "group", "board", "shield", "snippet"}
PROJECT_KEYS = {"name", "remote", "revision", "path", "import", "clone-depth", "repo-path"}


class ConfigError(Exception):
    pass


def _matches_fully(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _plain_path(value):
    return isinstance(value, str) and all(_matches_fully(PATH_SEGMENT, seg) for seg in value.split("/"))


def load_config(config_dir):
    path = config_dir / CONFIG_FILE
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError("{} not found".format(path))
    except json.JSONDecodeError as e:
        raise ConfigError("{} is not valid JSON: {}".format(path, e))
    if not isinstance(cfg, dict) or cfg.get("firmware") != "zmk":
        raise ConfigError('"firmware" must be "zmk"')
    zmk = cfg.get("zmk")
    if not isinstance(zmk, dict) or not _matches_fully(IMAGE_PATTERN, zmk.get("image")):
        raise ConfigError('"zmk.image" is required and must be pinned by digest (name@sha256:...)')

    builds = cfg.get("builds")
    if not isinstance(builds, list) or not builds:
        raise ConfigError('"builds" must list at least one build')
    seen = set()
    for i, b in enumerate(builds):
        if not isinstance(b, dict):
            raise ConfigError("builds[{}] must be an object".format(i))
        extra = set(b) - BUILD_KEYS
        if extra:
            raise ConfigError("builds[{}] has unknown fields: {}".format(i, ", ".join(sorted(extra))))
        if not _matches_fully(ID_PATTERN, b.get("id")):
            raise ConfigError('builds[{}].id may only use a-z, 0-9, "-" and "_"'.format(i))
        if b["id"] in seen:
            raise ConfigError('build id "{}" is used twice'.format(b["id"]))
        seen.add(b["id"])
        if not _matches_fully(NAME_TEXT, b.get("name")):
            raise ConfigError("builds[{}].name must be one line of text".format(i))
        if not _matches_fully(ID_PATTERN, b.get("group")):
            raise ConfigError('builds[{}].group may only use a-z, 0-9, "-" and "_"'.format(i))
        if not _matches_fully(BOARD_PATTERN, b.get("board")):
            raise ConfigError("builds[{}].board must be a Zephyr board name such as xiao_ble//zmk".format(i))
        if not _matches_fully(WORDS_PATTERN, b.get("shield")):
            raise ConfigError("builds[{}].shield must be shield names separated by spaces".format(i))
        if "snippet" in b and not _matches_fully(WORDS_PATTERN, b["snippet"]):
            raise ConfigError("builds[{}].snippet must be snippet names separated by spaces".format(i))
    return cfg


def check_west(doc):
    """Checks config/west.yml, parsed, before west reads it."""
    manifest = doc.get("manifest") if isinstance(doc, dict) else None
    if not isinstance(manifest, dict) or set(manifest) - {"remotes", "projects", "self", "defaults"}:
        raise ConfigError("west.yml may only have remotes, projects, defaults and self")
    remotes = {}
    for r in manifest.get("remotes") or []:
        if not isinstance(r, dict) or set(r) != {"name", "url-base"}:
            raise ConfigError("each west remote needs exactly a name and a url-base")
        if not _matches_fully(WEST_NAME, r["name"]) or not _matches_fully(GITHUB_OWNER_URL, r["url-base"]):
            raise ConfigError("west remote {!r} must be https://github.com/<owner>".format(r.get("name")))
        remotes[r["name"]] = r["url-base"]
    defaults = manifest.get("defaults") or {}
    if not isinstance(defaults, dict) or set(defaults) - {"remote"} or defaults.get("remote", next(iter(remotes), None)) not in remotes:
        raise ConfigError("west defaults may only name one of the remotes")
    projects = manifest.get("projects")
    if not isinstance(projects, list) or not projects:
        raise ConfigError("west.yml must list projects")
    for p in projects:
        if not isinstance(p, dict) or set(p) - PROJECT_KEYS:
            raise ConfigError("west project {!r}: only name, remote, revision, path, import and clone-depth".format(
                p.get("name") if isinstance(p, dict) else p))
        name = p.get("name")
        if not _matches_fully(WEST_NAME, name):
            raise ConfigError("west project names may only use letters, digits, '.', '-' and '_'")
        if p.get("remote", defaults.get("remote")) not in remotes:
            raise ConfigError("west project {}: its remote must be one of the listed remotes".format(name))
        if not _matches_fully(COMMIT_PATTERN, p.get("revision")):
            raise ConfigError(
                "west project {}: revision must be a full commit SHA; a branch or tag can change without a commit here".format(name))
        for key in ("path", "repo-path"):
            if key in p and not _plain_path(p[key]):
                raise ConfigError("west project {}: {} must be a plain relative path".format(name, key))
        if "import" in p and not _allowed_import(name, p["import"]):
            raise ConfigError("west project {}: only zmk may import app/west.yml, and zephyr a name-allowlist".format(name))
    self_ = manifest.get("self") or {}
    if not isinstance(self_, dict) or set(self_) != {"path"} or self_["path"] != "config":
        raise ConfigError("west.yml self must be exactly {path: config}")


def _allowed_import(name, value):
    if name == "zmk":
        return value == "app/west.yml"
    if name == "zephyr":
        # Zephyr's own west.yml pins its modules by SHA; only which of them to take may be listed.
        return (isinstance(value, dict) and len(value) == 1
                and next(iter(value)) in ("name-allowlist", "name-blocklist")
                and isinstance(next(iter(value.values())), list)
                and all(_matches_fully(WEST_NAME, n) for n in next(iter(value.values()))))
    return False


def check_resolved(projects):
    """Every project west will build from, imports included, must be pinned by SHA."""
    for p in projects:
        if not _matches_fully(COMMIT_PATTERN, p.get("revision")):
            raise ConfigError(
                "west project {} resolves to {!r}, not a commit SHA: pin it in config/west.yml".format(
                    p.get("name"), p.get("revision")))


def role_of(dot_config, shield):
    """The build's role and whether ZMK Studio is on, from Zephyr's generated .config."""
    options = dict(
        line.split("=", 1) for line in dot_config.splitlines() if line.startswith("CONFIG_") and "=" in line
    )
    studio = options.get("CONFIG_ZMK_STUDIO") == "y"
    if shield.split()[0] == "settings_reset":
        return "settings_reset", studio
    if options.get("CONFIG_ZMK_SPLIT") != "y":
        return "standalone", studio
    return ("central" if options.get("CONFIG_ZMK_SPLIT_ROLE_CENTRAL") == "y" else "peripheral"), studio


def run(cmd, cwd=None, capture=False):
    print("+ " + " ".join(str(c) for c in cmd), flush=True)
    if not capture:
        subprocess.run(cmd, cwd=cwd, check=True)
        return ""
    return subprocess.run(cmd, cwd=cwd, check=True, stdout=subprocess.PIPE, text=True).stdout


def read_yaml(text):
    import yaml  # PyYAML ships with west in the build image

    return yaml.safe_load(text)


def prepare_workspace(config_dir, work_dir):
    """A west workspace with the config repository at config/, updated and checked."""
    west_yml = config_dir / "config" / "west.yml"
    if not west_yml.is_file():
        raise ConfigError("config/west.yml not found")
    doc = read_yaml(west_yml.read_text(encoding="utf-8"))
    check_west(doc)
    own = {p["name"] for p in doc["manifest"]["projects"]}

    # Only config/ goes into the workspace, as in ZMK's own workflow: west clones zephyr/ at the
    # top, where the repository may have its own zephyr/module.yml (passed as an extra module).
    ws = work_dir / "ws"
    shutil.rmtree(ws, ignore_errors=True)
    ws.mkdir(parents=True)
    shutil.copytree(config_dir / "config", ws / "config")
    run(["west", "init", "-l", "config"], cwd=ws)
    run(["west", "update", "--fetch-opt=--filter=tree:0"], cwd=ws)
    # Registers this Zephyr with CMake, as ZMK's own workflow does, so `west build` can find it.
    run(["west", "zephyr-export"], cwd=ws)

    resolved = read_yaml(run(["west", "manifest", "--resolve"], cwd=ws, capture=True))
    projects = resolved["manifest"]["projects"]
    check_resolved(projects)
    # The config's own pins come from untrusted input. Imported projects (ZMK's and Zephyr's
    # modules) are pinned by the manifest inside a commit that is itself checked here.
    for p in projects:
        if p["name"] in own:
            ensure_contained(ws, p)
    return ws, projects


def ensure_contained(ws, project):
    """GitHub serves a fork network's commits through every member's URL, so a SHA alone does not
    prove the code is the named repository's. Fetch its branches and tags (commits only) and
    require one of them to contain the pinned commit."""
    path = ws / project.get("path", project["name"])
    git = ["git", "-C", str(path)]
    run(git + ["fetch", "--quiet", "--filter=tree:0", project["url"],
               "+refs/heads/*:refs/remotes/keyballer/*", "+refs/tags/*:refs/tags/*"])
    containing = subprocess.run(
        git + ["for-each-ref", "--count=1", "--contains", project["revision"], "refs/remotes/keyballer", "refs/tags"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ).stdout.strip()
    if not containing:
        raise ConfigError("{} has no branch or tag containing {}: it may be a fork's commit".format(
            project["url"], project["revision"]))


def build_one(build, cfg, config_dir, ws, projects, out_dir):
    build_dir = ws / "build" / build["id"]
    cmd = ["west", "build", "-p", "-s", "zmk/app", "-d", str(build_dir), "-b", build["board"]]
    for snippet in build.get("snippet", "").split():
        cmd += ["-S", snippet]
    cmd += ["--", "-DZMK_CONFIG={}".format(ws / "config"), "-DSHIELD={}".format(build["shield"])]
    # The repository itself is a Zephyr module when it has zephyr/module.yml (boards, shields).
    if (config_dir / "zephyr" / "module.yml").is_file():
        cmd.append("-DZMK_EXTRA_MODULES={}".format(config_dir))
    print("::group::Build {} ({} {})".format(build["id"], build["board"], build["shield"]), flush=True)
    try:
        run(cmd, cwd=ws)
    finally:
        print("::endgroup::", flush=True)

    uf2 = build_dir / "zephyr" / "zmk.uf2"
    if not uf2.is_file():
        raise RuntimeError("ZMK built {} but no zmk.uf2 was found".format(build["id"]))
    data = uf2.read_bytes()
    try:
        summary = check_uf2(data)
    except UF2Error as e:
        raise RuntimeError("{}: the UF2 file fails Keyballer's check: {}".format(build["id"], e))
    role, studio = role_of((build_dir / "zephyr" / ".config").read_text(encoding="utf-8"), build["shield"])

    out_file = "{}.uf2".format(build["id"])
    (out_dir / out_file).write_bytes(data)
    west_file = "{}.west.yml".format(build["id"])
    frozen = run(["west", "manifest", "--freeze"], cwd=ws, capture=True)
    (out_dir / west_file).write_text(frozen, encoding="utf-8")
    shas = {p["name"]: p["revision"] for p in projects}

    meta = {
        "id": build["id"],
        "name": build["name"],
        "firmware": "zmk",
        "group": build["group"],
        "board": build["board"],
        "shield": build["shield"],
        "file": out_file,
        "format": "uf2",
        "role": role,
        "studio": studio,
        "uf2": summary,
        "size": summary["blocks"] * 256,
        "west": west_file,
        "zmk_sha": shas.get("zmk"),
        "zephyr_sha": shas.get("zephyr"),
        "image": cfg["zmk"]["image"],
    }
    if build.get("snippet"):
        meta["snippet"] = build["snippet"]
    (out_dir / "{}.json".format(build["id"])).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return meta


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("config_dir", type=Path)
    parser.add_argument("out_dir", type=Path, nargs="?")
    parser.add_argument("--only", metavar="ID", help="build this id")
    parser.add_argument("--list", action="store_true", help="print build ids as JSON")
    parser.add_argument("--image", action="store_true", help="print the zmk-build-arm image")
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
        print(cfg["zmk"]["image"])
        return 0
    if args.out_dir is None or not args.only:
        parser.error("OUT_DIR and --only are required when building")
    builds = [b for b in cfg["builds"] if b["id"] == args.only]
    if not builds:
        print('no build with id "{}"'.format(args.only), file=sys.stderr)
        return 2

    work_dir = Path(os.environ.get("WORK_DIR", ".keyballer-work")).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir = args.out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        ws, projects = prepare_workspace(config_dir, work_dir)
        meta = build_one(builds[0], cfg, config_dir, ws, projects, out_dir)
        print("Built {}: {} ({}, {} blocks)".format(meta["id"], meta["file"], meta["role"], meta["uf2"]["blocks"]),
              flush=True)
    except (ConfigError, RuntimeError) as e:
        print("error: {}".format(e), file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print("error: command failed ({}): {}".format(e.returncode, " ".join(map(str, e.cmd))), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
