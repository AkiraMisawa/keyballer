"""The QMK and ZMK workflows share one publish job (docs/plans/zmk.md): it writes the manifest,
keeps the build record with the run and pushes the firmware branch, which provenance depends on.
The two copies must not drift apart."""

import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / ".github" / "workflows"


def publish_job(name):
    text = (WORKFLOWS / name).read_text(encoding="utf-8")
    return text[text.index("\n  publish:\n"):]


class Workflows(unittest.TestCase):
    def test_qmk_and_zmk_publish_the_same_way(self):
        self.assertEqual(publish_job("build-qmk.yml"), publish_job("build-zmk.yml"))


if __name__ == "__main__":
    unittest.main()
