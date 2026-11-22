#!/usr/bin/env python3
"""Build the ZMK firmware described by a Keyballer config repository (docs/plans/zmk.md).

usage:
  build_zmk.py CONFIG_DIR OUT_DIR --only ID   build one firmware into OUT_DIR
  build_zmk.py CONFIG_DIR --list              print build ids as a JSON array
  build_zmk.py CONFIG_DIR --image             print the zmk-build-arm image to build in

CONFIG_DIR is a ZMK user config repository with keyballer.json at its top and
config/west.yml. For the build, OUT_DIR receives <id>.uf2 (checked block by
block), <id>.west.yml (the resolved west manifest, every project at a SHA) and
<id>.json with details the app needs (role, board, shield, UF2 range, ZMK and
Zephyr commits).

Every value from keyballer.json and config/west.yml is untrusted (config_checks.py).
Every west project must be pinned by commit SHA. Before west runs, each commit that
config/west.yml pins is checked, in a scratch repository, to be contained in a branch
or tag of the repository it names: GitHub serves a fork network's commits through
every member's URL. No code from a pinned project runs before that check.

Environment:
  WORK_DIR  scratch directory for the west workspace (default: ./.keyballer-work).

Runs on Python 3.9 or later (the zmk-build-arm image).
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from collections import namedtuple
from pathlib import Path

from config_checks import (
    COMMIT_PATTERN,
    ID_PATTERN,
    IMAGE_PATTERN,
    NAME_TEXT,
    PATH_SEGMENT,
    ConfigError,
    matches_fully,
    plain_path,
    run,
)
from uf2check import UF2Error, check_uf2
from zmk_view import ViewError, make_view

CONFIG_FILE = "keyballer.json"
# Zephyr board names, with an optional revision and qualifiers: nice_nano@2.0.0, xiao_ble//zmk.
BOARD_PATTERN = re.compile(r"[a-z0-9_]+(@[0-9.]+)?(/[a-z0-9_]*)*")
# One or more shields or snippets, separated by single spaces.
WORDS_PATTERN = re.compile(r"[A-Za-z0-9_-]+( [A-Za-z0-9_-]+)*")
GITHUB_OWNER_URL = re.compile(r"https://github\.com/[A-Za-z0-9-]+")
BUILD_KEYS = {"id", "name", "group", "board", "shield", "snippet"}
PROJECT_KEYS = {"name", "remote", "revision", "path", "repo-path", "import", "clone-depth"}
# Where the workspace keeps ZMK, Zephyr, the config, builds and imported modules; no other project
# may sit there, or the build would use its code under another project's name.
RESERVED_PATHS = {"zmk", "zephyr", "config", "build", "modules", "bootloader", "tools"}

Workspace = namedtuple("Workspace", "path projects resolved")


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
    if not isinstance(zmk, dict) or not matches_fully(IMAGE_PATTERN, zmk.get("image")):
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
        if not matches_fully(ID_PATTERN, b.get("id")):
            raise ConfigError('builds[{}].id may only use a-z, 0-9, "-" and "_"'.format(i))
        if b["id"] in seen:
            raise ConfigError('build id "{}" is used twice'.format(b["id"]))
        seen.add(b["id"])
        if not matches_fully(NAME_TEXT, b.get("name")):
            raise ConfigError("builds[{}].name must be one line of text".format(i))
        if not matches_fully(ID_PATTERN, b.get("group")):
            raise ConfigError('builds[{}].group may only use a-z, 0-9, "-" and "_"'.format(i))
        if not matches_fully(BOARD_PATTERN, b.get("board")):
            raise ConfigError("builds[{}].board must be a Zephyr board name such as xiao_ble//zmk".format(i))
        if not matches_fully(WORDS_PATTERN, b.get("shield")):
            raise ConfigError("builds[{}].shield must be shield names separated by spaces".format(i))
        if "snippet" in b and not matches_fully(WORDS_PATTERN, b["snippet"]):
            raise ConfigError("builds[{}].snippet must be snippet names separated by spaces".format(i))
    return cfg


def check_west(doc):
    """Checks config/west.yml, parsed, before west reads it. Returns {name: (url, sha)} per project."""
    manifest = doc.get("manifest") if isinstance(doc, dict) else None
    if not isinstance(manifest, dict) or set(manifest) - {"remotes", "projects", "self"}:
        raise ConfigError("west.yml may only have remotes, projects and self")
    remotes = {}
    for r in manifest.get("remotes") or []:
        if not isinstance(r, dict) or set(r) != {"name", "url-base"}:
            raise ConfigError("each west remote needs exactly a name and a url-base")
        if not matches_fully(PATH_SEGMENT, r["name"]) or not matches_fully(GITHUB_OWNER_URL, r["url-base"]):
            raise ConfigError("west remote {!r} must be https://github.com/<owner>".format(r.get("name")))
        if r["name"] in remotes:
            raise ConfigError("west remote {} is listed twice".format(r["name"]))
        remotes[r["name"]] = r["url-base"]
    if not remotes:
        raise ConfigError("west.yml must list its remotes")
    projects = manifest.get("projects")
    if not isinstance(projects, list) or not projects:
        raise ConfigError("west.yml must list projects")
    pins = {}
    for p in projects:
        if not isinstance(p, dict) or set(p) - PROJECT_KEYS:
            raise ConfigError("west project {!r}: only name, remote, revision, path, repo-path, import and clone-depth".format(
                p.get("name") if isinstance(p, dict) else p))
        name = p.get("name")
        if not matches_fully(PATH_SEGMENT, name):
            raise ConfigError("west project names may only use letters, digits, '.', '-' and '_'")
        if name in pins:
            raise ConfigError("west project {} is listed twice".format(name))
        if p.get("remote") not in remotes:
            raise ConfigError("west project {}: remote must name one of the listed remotes".format(name))
        if not matches_fully(COMMIT_PATTERN, p.get("revision")):
            raise ConfigError(
                "west project {}: revision must be a full commit SHA; a branch or tag can change without a commit here".format(name))
        if "repo-path" in p and not plain_path(p["repo-path"]):
            raise ConfigError("west project {}: repo-path must be a plain relative path".format(name))
        if name in ("zmk", "zephyr"):
            if "path" in p:
                raise ConfigError("west project {} must stay at {}/, where the build looks for it".format(name, name))
        else:
            where = p.get("path", name)
            if not plain_path(where) or where.split("/")[0] in RESERVED_PATHS:
                raise ConfigError("west project {}: path {!r} is not allowed".format(name, where))
        if "import" in p and not _allowed_import(name, p["import"]):
            raise ConfigError(
                "west project {}: only zmk may import (app/west.yml), and zephyr a name-allowlist or name-blocklist".format(name))
        pins[name] = ("{}/{}".format(remotes[p["remote"]], p.get("repo-path", name)), p["revision"])
    if "zmk" not in pins:
        raise ConfigError("west.yml must list zmk")
    self_ = manifest.get("self") or {}
    if not isinstance(self_, dict) or set(self_) != {"path"} or self_["path"] != "config":
        raise ConfigError("west.yml self must be exactly {path: config}")
    return pins


def _allowed_import(name, value):
    if name == "zmk":
        return value == "app/west.yml"
    if name == "zephyr":
        # Zephyr's own west.yml pins its modules by SHA; only which of them to take may be listed.
        return (isinstance(value, dict) and len(value) == 1
                and next(iter(value)) in ("name-allowlist", "name-blocklist")
                and isinstance(next(iter(value.values())), list)
                and all(matches_fully(PATH_SEGMENT, n) for n in next(iter(value.values()))))
    return False


def check_resolved(projects):
    """Every project west will build from, imports included, must be pinned by SHA."""
    for p in projects:
        if not matches_fully(COMMIT_PATTERN, p.get("revision")):
            raise ConfigError(
                "west project {} resolves to {!r}, not a commit SHA: pin it in config/west.yml".format(
                    p.get("name"), p.get("revision")))


def role_and_studio(dot_config, shield):
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


def read_yaml(text):
    import yaml  # PyYAML ships with west in the build image

    return yaml.safe_load(text)


def require_contained(scratch, url, sha):
    """Fetches a repository's branches and tags (commits only) into a new, empty repository and
    requires one of them to contain the commit. Nothing of the project runs here."""
    shutil.rmtree(scratch, ignore_errors=True)
    scratch.mkdir(parents=True)
    git = ["git", "-C", str(scratch)]
    run(git + ["init", "--quiet", "--bare"])
    # A filtered fetch needs a named remote (it becomes the partial clone's promisor).
    run(git + ["remote", "add", "origin", url])
    run(git + ["fetch", "--quiet", "--filter=tree:0", "origin",
               "+refs/heads/*:refs/keyballer/heads/*", "+refs/tags/*:refs/keyballer/tags/*"])
    containing = subprocess.run(
        git + ["for-each-ref", "--count=1", "--contains", sha, "refs/keyballer"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ).stdout.strip()
    if not containing:
        raise ConfigError("{} has no branch or tag containing {}: it may be a fork's commit".format(url, sha))


def prepare_workspace(config_dir, work_dir):
    """A west workspace with the config repository at config/, its pins checked, then updated."""
    west_yml = config_dir / "config" / "west.yml"
    if not west_yml.is_file():
        raise ConfigError("config/west.yml not found")
    pins = check_west(read_yaml(west_yml.read_text(encoding="utf-8")))
    # Each commit the config pins, before west fetches anything: the manifests inside the ZMK and
    # Zephyr commits choose the other projects, and Zephyr's commands run in the build.
    for name, (url, sha) in pins.items():
        require_contained(work_dir / "contained" / name, url, sha)

    # Only config/ goes into the workspace, as in ZMK's own workflow: west clones zephyr/ at the
    # top, where the repository may have its own zephyr/module.yml (passed as an extra module).
    ws = work_dir / "ws"
    shutil.rmtree(ws, ignore_errors=True)
    ws.mkdir(parents=True)
    shutil.copytree(config_dir / "config", ws / "config")
    run(["west", "init", "-l", "config"], cwd=ws)
    run(["west", "update", "--fetch-opt=--filter=tree:0"], cwd=ws)

    # Every project is pinned by SHA (checked here), so the resolved manifest is the frozen one.
    # `west manifest --freeze` itself refuses projects that are not cloned (Zephyr's optional ones).
    resolved = run(["west", "manifest", "--resolve"], cwd=ws, capture=True)
    projects = read_yaml(resolved)["manifest"]["projects"]
    check_resolved(projects)
    paths = {p["name"]: p.get("path", p["name"]) for p in projects}
    for name, (_, sha) in pins.items():
        head = run(["git", "-C", str(ws / paths[name]), "rev-parse", "HEAD"], capture=True).strip()
        if head != sha:
            raise ConfigError("west checked out {} at {}, not the pinned {}".format(name, head, sha))
    # Registers this Zephyr with CMake, as ZMK's own workflow does, so `west build` can find it.
    # This is Zephyr's code: it runs only now that its commit has been checked.
    run(["west", "zephyr-export"], cwd=ws)
    return Workspace(ws, projects, resolved)


def keymap_source(cmake_cache, workspace, repo):
    """The .keymap file ZMK built from (KEYMAP_FILE, which ZMK's keymap module sets), as its path in
    the config repository and its SHA-256, for the editor; None when it is not plainly the
    repository's own .keymap file.

    The workspace has a copy of the repository's config/ folder; the repository itself is where ZMK
    reads boards and shields from when it is a module. Anything else in the workspace (ZMK, Zephyr,
    modules) is not the repository's, even when the workspace is inside it, as in a local build.
    Like the view, this never fails the build: a value it cannot follow is no keymap."""
    m = re.search(r"^KEYMAP_FILE:[A-Z]+=([^\r\n]+)$", cmake_cache, re.M)
    if not m:
        return None
    try:
        path = Path(m.group(1).strip()).resolve()
        copy = (workspace / "config").resolve()
        if path.is_relative_to(copy):
            name = "config/" + path.relative_to(copy).as_posix()
        elif path.is_relative_to(workspace.resolve()) or not path.is_relative_to(repo.resolve()):
            return None
        else:
            name = path.relative_to(repo.resolve()).as_posix()
        # The repository's own file, with no link on the way: the workspace copy follows links, a
        # link out of the repository would publish another file's digest, and the editor would
        # write a plain file over a link. The build runs the repository's own CMake, which could
        # name any of its files, so only a .keymap file with a plain path counts.
        original = repo / name
        if not (plain_path(name) and name.endswith(".keymap") and original.is_file()
                and original.resolve() == repo.resolve() / name):
            return None
        return {"path": name, "sha256": hashlib.sha256(original.read_bytes()).hexdigest()}
    except (OSError, RuntimeError, ValueError):
        return None


def write_view(build, build_dir, out_dir, keymap=None):
    """Writes <id>.view.json from the final devicetree; returns view, or view_error. A view that
    cannot be made never fails the build. keymap is the source file (keymap_source), if known."""
    name = "{}.view.json".format(build["id"])
    try:
        view = make_view((build_dir / "zephyr" / "zephyr.dts").read_text(encoding="utf-8"))
        view["keyboard"] = "{} {}".format(build["board"], build["shield"])
        if keymap:
            view["zmk"]["keymap"] = keymap
        (out_dir / name).write_text(json.dumps(view, ensure_ascii=False) + "\n", encoding="utf-8")
    except ViewError as e:
        print("No keymap view for {}: {}".format(build["id"], e), flush=True)
        return {"view_error": str(e)}
    except Exception as e:  # the view must never fail the build
        print("No keymap view for {}: {!r}".format(build["id"], e), flush=True)
        return {"view_error": "Keyballer could not read the build's devicetree ({}: {})".format(type(e).__name__, e)}
    return {"view": name}


def build_one(build, cfg, config_dir, workspace, out_dir):
    ws = workspace.path
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
    role, studio = role_and_studio((build_dir / "zephyr" / ".config").read_text(encoding="utf-8"), build["shield"])

    out_file = "{}.uf2".format(build["id"])
    (out_dir / out_file).write_bytes(data)
    west_file = "{}.west.yml".format(build["id"])
    (out_dir / west_file).write_text(workspace.resolved, encoding="utf-8")
    shas = {p["name"]: p["revision"] for p in workspace.projects}

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
    if role != "settings_reset":
        try:
            cache = (build_dir / "CMakeCache.txt").read_text(encoding="utf-8", errors="replace")
            keymap = keymap_source(cache, ws, config_dir)
        except Exception as e:  # like the view, this must never fail the build
            print("No keymap source for {}: {!r}".format(build["id"], e), flush=True)
            keymap = None
        meta.update(write_view(build, build_dir, out_dir, keymap))
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
        workspace = prepare_workspace(config_dir, work_dir)
        meta = build_one(builds[0], cfg, config_dir, workspace, out_dir)
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
