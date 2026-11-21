#!/usr/bin/env python3
"""Write manifest.json for the firmware branch.

usage: make_manifest.py OUT_DIR IDS_JSON

OUT_DIR holds the <id>.json files written by build_qmk.py. IDS_JSON is the
build order from keyballer.json (the output of `build_qmk.py --list`).
Repository and run details come from the GitHub Actions environment.
Also appends a summary table to $GITHUB_STEP_SUMMARY when it is set.
"""

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
        builds.append(json.loads(meta_path.read_text(encoding="utf-8")))

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
            "| Firmware | Keyboard | Size | MCU | Bootloader |",
            "| --- | --- | --- | --- | --- |",
        ]
        for b in builds:
            size = "{} / {}".format(b.get("size"), b.get("max_size")) if b.get("size") else "?"
            lines.append("| {} | `{}:{}` | {} | {} | {} |".format(
                b["name"], b["keyboard"], b["keymap"], size,
                b.get("processor") or "?", b.get("bootloader") or "?"))
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
