"""Checks shared by the build scripts (build_qmk.py, build_zmk.py).

A config repository's keyballer.json and west.yml are untrusted input: their values reach
$GITHUB_OUTPUT, container images, git and west. Patterns are used with fullmatch, so a trailing
newline never passes, and commands are argument lists, never shell text.

Runs on Python 3.9.
"""

import re
import subprocess

ID_PATTERN = re.compile(r"[a-z0-9][a-z0-9_-]*")
# A display name: any text on one line.
NAME_TEXT = re.compile(r"[^\x00-\x1f\x7f]{1,80}")
# An image pinned by digest: a tag can be moved, a digest cannot.
IMAGE_PATTERN = re.compile(r"[a-z0-9][a-z0-9./_-]*(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
PATH_SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]*")


class ConfigError(Exception):
    pass


def matches_fully(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def plain_path(value):
    """A relative path that stays where it is: no empty, "." or ".." segments, no leading "/"."""
    return isinstance(value, str) and all(matches_fully(PATH_SEGMENT, seg) for seg in value.split("/"))


def run(cmd, cwd=None, capture=False, env=None):
    print("+ " + " ".join(str(c) for c in cmd), flush=True)
    if not capture:
        subprocess.run(cmd, cwd=cwd, check=True, env=env)
        return ""
    proc = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
    print(proc.stdout, end="", flush=True)
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout)
    return proc.stdout
