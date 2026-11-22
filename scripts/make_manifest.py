#!/usr/bin/env python3
"""Write manifest.json for the firmware branch.

usage: make_manifest.py OUT_DIR IDS_JSON

OUT_DIR holds the <id>.json files written by build_qmk.py or build_zmk.py.
IDS_JSON is the build order from keyballer.json (the output of `--list`).
Repository and run details come from the GitHub Actions environment.
Each build gets the SHA-256 of its firmware file (`sha256`), of its keymap
view (`view_sha256`) and, for ZMK, of its frozen west manifest (`west_sha256`). The publish job keeps an artifact named after the
manifest's own SHA-256 with the run, so the app can check the bytes it
flashes against a run of this workflow (src/lib/provenance.ts).
Also appends a summary table to $GITHUB_STEP_SUMMARY when it is set.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    out_dir = Path(sys.argv[1])
    ids = json.loads(sys.argv[2])

    builds = []
    for build_id in ids:
        meta_path = out_dir / "{}.json".format(build_id)
        if not meta_path.exists():
            print("missing build output for {}".format(build_id), file=sys.stderr)
            return 1
        build = json.loads(meta_path.read_text(encoding="utf-8"))
        for field, digest_field in (("file", "sha256"), ("view", "view_sha256"), ("west", "west_sha256")):
            name = build.get(field)
            if not name:
                continue
            path = out_dir / name
            if not path.is_file():
                print("missing {} {} for {}".format(field, name, build_id), file=sys.stderr)
                return 1
            build[digest_field] = hashlib.sha256(path.read_bytes()).hexdigest()
        builds.append(build)

    repo = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "0")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    manifest = {
        "schema": 1,
        "source": {
            "repository": repo,
            "sha": os.environ.get("GITHUB_SHA", ""),
            "ref": os.environ.get("GITHUB_REF", ""),
        },
        "run": {
            "id": int(run_id),
            "url": "{}/{}/actions/runs/{}".format(server, repo, run_id),
        },
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "builds": builds,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        lines = [
            "| Firmware | Keyboard | Size | MCU or role | Bootloader or format |",
            "| --- | --- | --- | --- | --- |",
        ]
        for b in builds:
            if b.get("firmware") == "zmk":
                lines.append("| {} | `{} {}` | {} bytes | {} | uf2 |".format(
                    b["name"], b["board"], b["shield"], b.get("size") or "?", b.get("role") or "?"))
                continue
            size = "{} / {}".format(b.get("size"), b.get("max_size")) if b.get("size") else "?"
            lines.append("| {} | `{}:{}` | {} | {} | {} |".format(
                b["name"], b["keyboard"], b["keymap"], size,
                b.get("processor") or "?", b.get("bootloader") or "?"))
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
