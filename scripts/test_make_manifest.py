"""make_manifest.py records each published file's SHA-256 in manifest.json."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("make_manifest.py")
# FIPS 180-2, appendix B.1.
ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


class MakeManifestTest(unittest.TestCase):
    def test_lists_the_digest_of_each_firmware_and_view_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "kb.hex").write_bytes(b"abc")
            (out / "kb.view.json").write_bytes(b"{}")
            (out / "kb.json").write_text(json.dumps({"id": "kb", "file": "kb.hex", "view": "kb.view.json"}))
            env = dict(os.environ, GITHUB_REPOSITORY="o/r", GITHUB_RUN_ID="7", GITHUB_SHA="a" * 40)
            env.pop("GITHUB_STEP_SUMMARY", None)
            subprocess.run([sys.executable, str(SCRIPT), str(out), '["kb"]'], check=True, env=env)
            build = json.loads((out / "manifest.json").read_text())["builds"][0]
            self.assertEqual(build["sha256"], ABC)
            self.assertEqual(build["view_sha256"], hashlib.sha256(b"{}").hexdigest())

    def test_lists_the_digest_of_a_zmk_build_and_its_frozen_west_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "r.uf2").write_bytes(b"abc")
            (out / "r.west.yml").write_bytes(b"manifest: {}\n")
            (out / "r.json").write_text(json.dumps({
                "id": "r", "name": "roBa right", "firmware": "zmk", "board": "xiao_ble", "shield": "roBa_R",
                "role": "central", "file": "r.uf2", "west": "r.west.yml", "size": 256}))
            summary = out / "summary.md"
            env = dict(os.environ, GITHUB_REPOSITORY="o/r", GITHUB_RUN_ID="7", GITHUB_SHA="a" * 40,
                       GITHUB_STEP_SUMMARY=str(summary))
            subprocess.run([sys.executable, str(SCRIPT), str(out), '["r"]'], check=True, env=env)
            build = json.loads((out / "manifest.json").read_text())["builds"][0]
            self.assertEqual(build["sha256"], ABC)
            self.assertEqual(build["west_sha256"], hashlib.sha256(b"manifest: {}\n").hexdigest())
            self.assertIn("roBa_R", summary.read_text())

    def test_fails_when_a_listed_file_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "kb.json").write_text(json.dumps({"id": "kb", "file": "kb.hex"}))
            env = dict(os.environ, GITHUB_REPOSITORY="o/r", GITHUB_RUN_ID="7", GITHUB_SHA="a" * 40)
            result = subprocess.run([sys.executable, str(SCRIPT), str(out), '["kb"]'], env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
