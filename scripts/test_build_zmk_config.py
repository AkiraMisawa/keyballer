"""Checks of a ZMK config repository's keyballer.json and config/west.yml, which are untrusted
input to the workflow (docs/plans/zmk.md), and reading a build's role from Zephyr's .config."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from build_zmk import ConfigError, check_resolved, check_west, load_config, role_of

SHA = "edf5c08139c6a2a2a5e02cb4d6a3e4e3a1b7f2c0"
IMAGE = "docker.io/zmkfirmware/zmk-build-arm@sha256:" + "0" * 64

ROBA = {
    "firmware": "zmk",
    "zmk": {"image": IMAGE},
    "builds": [
        {"id": "roba-right", "name": "roBa right", "group": "roba", "board": "seeeduino_xiao_ble",
         "shield": "roBa_R", "snippet": "studio-rpc-usb-uart"},
        {"id": "roba-left", "name": "roBa left", "group": "roba", "board": "seeeduino_xiao_ble", "shield": "roBa_L"},
        {"id": "roba-reset", "name": "roBa settings reset", "group": "roba", "board": "seeeduino_xiao_ble",
         "shield": "settings_reset"},
    ],
}

WEST = {
    "manifest": {
        "remotes": [
            {"name": "zmkfirmware", "url-base": "https://github.com/zmkfirmware"},
            {"name": "kumamuk-git", "url-base": "https://github.com/kumamuk-git"},
        ],
        "projects": [
            {"name": "zmk", "remote": "zmkfirmware", "revision": SHA, "import": "app/west.yml"},
            {"name": "zephyr", "remote": "zmkfirmware", "revision": SHA, "clone-depth": 1,
             "import": {"name-blocklist": ["ci-tools", "hal_altera"]}},
            {"name": "zmk-pmw3610-driver", "remote": "kumamuk-git", "revision": SHA},
        ],
        "self": {"path": "config"},
    }
}


def load(cfg):
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / "keyballer.json").write_text(json.dumps(cfg), encoding="utf-8")
        return load_config(Path(d))


def changed(base, path, value):
    """A copy of base with the value at path (keys and indexes) replaced, or removed for None."""
    out = copy.deepcopy(base)
    node = out
    for key in path[:-1]:
        node = node[key]
    if value is None:
        del node[path[-1]]
    else:
        node[path[-1]] = value
    return out


class KeyballerJson(unittest.TestCase):
    def test_takes_the_owner_roba_config(self):
        self.assertEqual([b["id"] for b in load(ROBA)["builds"]], ["roba-right", "roba-left", "roba-reset"])

    def test_takes_zephyr_4_board_names(self):
        load(changed(ROBA, ["builds", 0, "board"], "xiao_ble//zmk"))
        load(changed(ROBA, ["builds", 0, "board"], "nice_nano@2.0.0"))

    def test_refuses_another_firmware_or_an_unpinned_image(self):
        for cfg in (
            changed(ROBA, ["firmware"], "qmk"),
            changed(ROBA, ["zmk"], None),
            changed(ROBA, ["zmk", "image"], "zmkfirmware/zmk-build-arm:stable"),
            changed(ROBA, ["zmk", "image"], IMAGE + "\nX=1"),
        ):
            with self.assertRaises(ConfigError):
                load(cfg)

    def test_refuses_values_that_could_reach_a_shell_or_another_path(self):
        bad = [
            (["builds", 0, "id"], "Roba Right"),
            (["builds", 0, "id"], "x\n"),
            (["builds", 0, "name"], "two\nlines"),
            (["builds", 0, "group"], "../roba"),
            (["builds", 0, "board"], "seeeduino_xiao_ble;id"),
            (["builds", 0, "board"], "../boards"),
            (["builds", 0, "board"], "$(id)"),
            (["builds", 0, "shield"], "roBa_R -DCONFIG_X=y"),
            (["builds", 0, "shield"], "roBa_R\n"),
            (["builds", 0, "snippet"], "studio;rm"),
            (["builds", 0, "cmake-args"], "-DCONFIG_ZMK_SLEEP=y"),
            (["builds", 0, "board"], None),
            (["builds", 0, "shield"], 7),
        ]
        for path, value in bad:
            with self.subTest(path=path, value=value):
                with self.assertRaises(ConfigError):
                    load(changed(ROBA, path, value))

    def test_takes_several_shields_and_snippets(self):
        cfg = changed(ROBA, ["builds", 0, "shield"], "roBa_R nice_view_adapter")
        cfg = changed(cfg, ["builds", 0, "snippet"], "studio-rpc-usb-uart zmk-usb-logging")
        load(cfg)

    def test_refuses_a_repeated_id(self):
        with self.assertRaises(ConfigError):
            load(changed(ROBA, ["builds", 1, "id"], "roba-right"))


class WestYml(unittest.TestCase):
    def test_takes_a_manifest_pinned_by_sha(self):
        check_west(WEST)

    def test_zephyr_may_import_its_modules_by_allowlist_or_blocklist(self):
        check_west(changed(WEST, ["manifest", "projects", 1, "import"], {"name-allowlist": ["cmsis", "hal_nordic"]}))
        for value in ({"name-allowlist": ["a b"]}, {"name-blocklist": "x"}, {"path-allowlist": ["x"]}, "west.yml", True):
            with self.subTest(value=value):
                with self.assertRaises(ConfigError):
                    check_west(changed(WEST, ["manifest", "projects", 1, "import"], value))

    def test_refuses_branches_tags_and_short_shas(self):
        for revision in ("main", "v0.3-branch", "v0.3.0", SHA[:12], SHA.upper(), None):
            with self.subTest(revision=revision):
                with self.assertRaises(ConfigError):
                    check_west(changed(WEST, ["manifest", "projects", 2, "revision"], revision))

    def test_refuses_remotes_that_are_not_a_github_owner(self):
        for url in ("http://github.com/zmkfirmware", "https://gitlab.com/zmkfirmware", "https://github.com/a/b",
                    "https://github.com/zmkfirmware/", "file:///tmp", "https://github.com/zmk firmware"):
            with self.subTest(url=url):
                with self.assertRaises(ConfigError):
                    check_west(changed(WEST, ["manifest", "remotes", 0, "url-base"], url))

    def test_refuses_projects_that_fetch_from_elsewhere_or_bring_more_in(self):
        bad = [
            (["manifest", "projects", 2, "url"], "https://example.com/x.git"),
            (["manifest", "projects", 2, "remote"], None),
            (["manifest", "projects", 2, "remote"], "elsewhere"),
            (["manifest", "projects", 2, "import"], True),
            (["manifest", "projects", 0, "import"], "west.yml"),
            (["manifest", "projects", 2, "submodules"], True),
            (["manifest", "projects", 2, "path"], "../escape"),
            (["manifest", "projects", 2, "name"], "a b"),
            (["manifest", "self", "path"], "elsewhere"),
            (["manifest", "self", "import"], "more.yml"),
            (["manifest", "group-filter"], ["+optional"]),
        ]
        for path, value in bad:
            with self.subTest(path=path, value=value):
                with self.assertRaises(ConfigError):
                    check_west(changed(WEST, path, value))

    def test_every_resolved_project_must_be_pinned(self):
        check_resolved([{"name": "zmk", "revision": SHA}, {"name": "zephyr", "revision": SHA}])
        for revision in ("v3.5.0+zmk-fixes", "main", "HEAD"):
            with self.assertRaises(ConfigError):
                check_resolved([{"name": "zmk", "revision": SHA}, {"name": "zephyr", "revision": revision}])


class Role(unittest.TestCase):
    def test_reads_the_role_from_the_build_config(self):
        central = "CONFIG_ZMK_SPLIT=y\nCONFIG_ZMK_SPLIT_ROLE_CENTRAL=y\nCONFIG_ZMK_STUDIO=y\n"
        peripheral = "CONFIG_ZMK_SPLIT=y\n# CONFIG_ZMK_SPLIT_ROLE_CENTRAL is not set\n"
        single = "# CONFIG_ZMK_SPLIT is not set\nCONFIG_ZMK_STUDIO=y\n"
        self.assertEqual(role_of(central, "roBa_R"), ("central", True))
        self.assertEqual(role_of(peripheral, "roBa_L"), ("peripheral", False))
        self.assertEqual(role_of(single, "meteorite40"), ("standalone", True))
        self.assertEqual(role_of("# CONFIG_ZMK_SPLIT is not set\n", "settings_reset"), ("settings_reset", False))


if __name__ == "__main__":
    unittest.main()
