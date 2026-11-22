"""Checks of a ZMK config repository's keyballer.json and config/west.yml, which are untrusted
input to the workflow (docs/plans/zmk.md), and reading a build's role from Zephyr's .config."""

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from build_zmk import ConfigError, check_resolved, check_west, keymap_source, load_config, role_and_studio

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


BLOCKLIST = ["ci-tools", "hal_altera", "hal_cypress", "hal_infineon", "hal_microchip", "hal_nxp", "hal_openisa",
             "hal_silabs", "hal_xtensa", "hal_st", "hal_ti", "loramac-node", "mcuboot", "mcumgr", "net-tools",
             "openthread", "edtt", "trusted-firmware-m"]

# The owner's config/west.yml files, as committed for Keyballer's build (AkiraMisawa/zmk-config-roBa
# and zmk-config-meteorite40, branch keyballer), parsed.
OWNER_ROBA = {"manifest": {
    "remotes": [{"name": "zmkfirmware", "url-base": "https://github.com/zmkfirmware"},
                {"name": "kumamuk-git", "url-base": "https://github.com/kumamuk-git"}],
    "projects": [
        {"name": "zmk", "remote": "zmkfirmware", "revision": "acfd8e5ea76cf23ad1c9b6b99848f97a95224257", "import": "app/west.yml"},
        {"name": "zephyr", "remote": "zmkfirmware", "revision": "dacab4875df72109b96cc8977547a0dc04875bcd",
         "clone-depth": 1, "import": {"name-blocklist": BLOCKLIST}},
        {"name": "zmk-pmw3610-driver", "remote": "kumamuk-git", "revision": "5e04553ab803d24405bd45621a41310ea3050e59"},
    ],
    "self": {"path": "config"},
}}
OWNER_M40 = {"manifest": {
    "remotes": [{"name": "zmkfirmware", "url-base": "https://github.com/zmkfirmware"},
                {"name": "iwk7273", "url-base": "https://github.com/iwk7273"}],
    "projects": [
        {"name": "zmk", "remote": "zmkfirmware", "revision": "abb64ba316c29caddc49727ca2cac2f0ed5970c7", "import": "app/west.yml"},
        {"name": "zephyr", "remote": "zmkfirmware", "revision": "dacab4875df72109b96cc8977547a0dc04875bcd",
         "clone-depth": 1, "import": {"name-blocklist": BLOCKLIST}},
        {"name": "zmk-pmw3610-driver", "remote": "iwk7273", "revision": "72280acc8e4467ed1b4947ee216c6bf31d0278b2"},
        {"name": "zmk-feature-sensor_rotation", "remote": "iwk7273", "revision": "e1a0186220ade99220d04dadf9735b758cfdf086"},
        {"name": "zmk-feature-xy_clipper", "remote": "iwk7273", "revision": "643c1cabb9636de3d13e518c91c4350def1c1bb0"},
        {"name": "zmk-feature-scaling", "remote": "iwk7273", "revision": "5c7402e3e9a675376cc0c32719f9fc98501afd12"},
    ],
    "self": {"path": "config"},
}}


class WestYml(unittest.TestCase):
    def test_takes_a_manifest_pinned_by_sha(self):
        check_west(WEST)

    def test_takes_the_owner_manifests_and_names_each_pin_with_its_repository(self):
        self.assertEqual(check_west(OWNER_ROBA)["zmk-pmw3610-driver"],
                         ("https://github.com/kumamuk-git/zmk-pmw3610-driver", "5e04553ab803d24405bd45621a41310ea3050e59"))
        self.assertEqual(sorted(check_west(OWNER_M40)), sorted(
            ["zmk", "zephyr", "zmk-pmw3610-driver", "zmk-feature-sensor_rotation", "zmk-feature-xy_clipper", "zmk-feature-scaling"]))

    def test_keeps_zmk_and_zephyr_where_the_build_looks_and_other_projects_away_from_there(self):
        bad = [
            (["manifest", "projects", 0, "path"], "elsewhere"),
            (["manifest", "projects", 1, "path"], "zephyr2"),
            (["manifest", "projects", 2, "path"], "zmk"),
            (["manifest", "projects", 2, "path"], "zephyr/drivers"),
            (["manifest", "projects", 2, "path"], "config"),
            (["manifest", "projects", 2, "path"], "modules/lib/nanopb"),
            (["manifest", "projects", 2, "name"], "zmk"),
        ]
        for path, value in bad:
            with self.subTest(path=path, value=value):
                with self.assertRaises(ConfigError):
                    check_west(changed(WEST, path, value))
        check_west(changed(WEST, ["manifest", "projects", 2, "path"], "drivers/pmw3610"))

    def test_refuses_defaults_repeated_remotes_and_a_manifest_without_zmk(self):
        with_defaults = changed(WEST, ["manifest", "defaults"], {"remote": "zmkfirmware"})
        repeated = changed(WEST, ["manifest", "remotes", 1, "name"], "zmkfirmware")
        no_zmk = changed(WEST, ["manifest", "projects"], [WEST["manifest"]["projects"][2]])
        for doc in (with_defaults, repeated, no_zmk):
            with self.assertRaises(ConfigError):
                check_west(doc)

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
        self.assertEqual(role_and_studio(central, "roBa_R"), ("central", True))
        self.assertEqual(role_and_studio(peripheral, "roBa_L"), ("peripheral", False))
        self.assertEqual(role_and_studio(single, "meteorite40"), ("standalone", True))
        self.assertEqual(role_and_studio("# CONFIG_ZMK_SPLIT is not set\n", "settings_reset"), ("settings_reset", False))


class KeymapSource(unittest.TestCase):
    """Which .keymap file ZMK built from (KEYMAP_FILE in CMakeCache.txt), for the editor: its path in
    the config repository and its SHA-256, or None when the file is not plainly the repository's."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.repo = self.root / "repo"
        (self.repo / "config").mkdir(parents=True)
        (self.repo / "boards" / "shields" / "x").mkdir(parents=True)
        (self.repo / "config" / "roBa.keymap").write_bytes(b"/ { keymap { }; };\n")
        (self.repo / "boards" / "shields" / "x" / "x.keymap").write_bytes(b"x\n")
        self.ws = self.root / "ws"

    def workspace(self):
        """config/ copied into the workspace as prepare_workspace copies it."""
        shutil.copytree(self.repo / "config", self.ws / "config")
        return self.ws / "config"

    def cache(self, path):
        return "ZMK_CONFIG:PATH={}\nKEYMAP_FILE:STRING={}\nSHIELD:STRING=roBa_R\n".format(self.ws / "config", path)

    def test_a_keymap_in_config_is_config_slash_its_name(self):
        config = self.workspace()
        found = keymap_source(self.cache(config / "roBa.keymap"), self.ws, self.repo)
        # sha256 of b"/ { keymap { }; };\n"
        self.assertEqual(found, {"path": "config/roBa.keymap",
                                 "sha256": "4e2753da3201fad45b5b684046a3d8c3ac39edad71625bd371cbf4a00a5392a2"})

    def test_a_keymap_in_the_repository_as_a_module_keeps_its_path(self):
        self.workspace()
        found = keymap_source(self.cache(self.repo / "boards" / "shields" / "x" / "x.keymap"), self.ws, self.repo)
        self.assertEqual(found["path"], "boards/shields/x/x.keymap")

    def test_a_keymap_from_elsewhere_or_none_is_not_the_repositorys(self):
        config = self.workspace()
        other = self.root / "zmk" / "app" / "boards" / "shields" / "y.keymap"
        other.parent.mkdir(parents=True)
        other.write_bytes(b"y")
        self.assertIsNone(keymap_source(self.cache(other), self.ws, self.repo))
        self.assertIsNone(keymap_source(self.cache(config / ".." / ".." / "zmk" / "app" / "boards" / "shields" / "y.keymap"), self.ws, self.repo))
        self.assertIsNone(keymap_source("SHIELD:STRING=roBa_R\n", self.ws, self.repo))
        self.assertIsNone(keymap_source(self.cache(config / "missing.keymap"), self.ws, self.repo))

    def test_only_a_keymap_file_with_a_plain_path(self):
        # The build runs the repository's own CMake, which could name any file of it.
        (self.repo / ".github" / "workflows").mkdir(parents=True)
        (self.repo / ".github" / "workflows" / "build.yml").write_bytes(b"on: push\n")
        (self.repo / "boards" / "shields" / "x" / "x.overlay").write_bytes(b"x\n")
        self.workspace()
        self.assertIsNone(keymap_source(self.cache(self.repo / ".github" / "workflows" / "build.yml"), self.ws, self.repo))
        self.assertIsNone(keymap_source(self.cache(self.repo / "boards" / "shields" / "x" / "x.overlay"), self.ws, self.repo))

    def test_a_workspace_inside_the_repository_is_still_not_the_repositorys(self):
        # Building locally from the config repository puts the workspace (.keyballer-work) inside it.
        self.ws = self.repo / ".keyballer-work" / "ws"
        config = self.workspace()
        module = self.ws / "zmk" / "app" / "boards" / "shields" / "y" / "y.keymap"
        module.parent.mkdir(parents=True)
        module.write_bytes(b"y")
        self.assertIsNone(keymap_source(self.cache(module), self.ws, self.repo))
        self.assertEqual(keymap_source(self.cache(config / "roBa.keymap"), self.ws, self.repo)["path"], "config/roBa.keymap")

    def test_a_link_in_config_is_not_the_repositorys_file(self):
        # The workspace copy follows links, so the link is checked in the repository itself: one
        # out of it would publish another file's digest, and the editor would write over one in it.
        outside = self.root / "secret.keymap"
        outside.write_bytes(b"s")
        (self.repo / "shared").mkdir()
        (self.repo / "shared" / "roBa.keymap").write_bytes(b"shared\n")
        (self.repo / "config" / "out.keymap").symlink_to(outside)
        (self.repo / "config" / "in.keymap").symlink_to(self.repo / "shared" / "roBa.keymap")
        config = self.workspace()
        self.assertFalse((config / "out.keymap").is_symlink())
        self.assertIsNone(keymap_source(self.cache(config / "out.keymap"), self.ws, self.repo))
        self.assertIsNone(keymap_source(self.cache(config / "in.keymap"), self.ws, self.repo))

    def test_a_value_it_cannot_follow_is_no_keymap_and_no_error(self):
        config = self.workspace()
        (config / "loop.keymap").symlink_to(config / "loop.keymap")
        self.assertIsNone(keymap_source(self.cache(config / "loop.keymap"), self.ws, self.repo))
        self.assertIsNone(keymap_source(self.cache("{}\0x".format(config / "roBa.keymap")), self.ws, self.repo))


if __name__ == "__main__":
    unittest.main()
