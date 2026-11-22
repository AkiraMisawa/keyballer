# ZMK keyboards: builds, provenance and UF2 flashing

Status (2026-11-22): phases 1, 3 and 4 built. Both owner configs build and publish, the app offers their checked UF2 files, and their keymaps can be viewed and edited. Flashing on the owner's hardware is still to do, and so is phase 2.

Research and sources: [../research/zmk.md](../research/zmk.md). Provenance and the threat model this builds on: [github-login.md](github-login.md).

## Problem

Two of the owner's keyboards run ZMK, and Keyballer cannot build or flash either:

- **roBa** is split. The right half is the central, with the trackball. The left half is the peripheral.
- **meteorite40** is a single XIAO nRF52840 with a trackball.

The owner's config repositories, `AkiraMisawa/zmk-config-roBa` and `AkiraMisawa/zmk-config-meteorite40`, are forks of their designers' repositories. They follow ZMK `main` and their modules by branch. ZMK `main` moved to Zephyr 4.1 and renamed the XIAO board, so they most likely do not build today.

ZMK's own workflow, `build-user-config.yml`, has two problems:

- it expands matrix values inside shell scripts, and it pins actions by tag and its image by a moving tag;
- it publishes a zip artifact that a page cannot check against anything.

## Solution

The same model as QMK: Keyballer's own reusable workflow builds the firmware, publishes it on the `firmware` branch with a manifest, and keeps a record of the manifest with the run. Keyballer checks the bytes against that record before offering them.

**Phase 1: build, provenance and verified download.**

1. **Workflow.** `build-zmk.yml` and `scripts/build_zmk.py`, modelled on `build-qmk.yml`: a plan job, a build job with no write token, and the same publish job.
2. **Config.** The repository's `keyballer.json` with `"firmware": "zmk"` lists the builds. ZMK's `build.yaml` is not read.
3. **Pinning.** `config/west.yml` must pin every project by commit SHA, before and after `west update`, including Zephyr. Every commit the config pins must be contained in a branch or tag of the repository it is fetched from. The resolved manifest, with every project at a SHA, is published next to the firmware.
4. **The UF2 check.** Both the build and the browser check the file block by block.
5. **Provenance.** It accepts runs of `build-zmk.yml` as it does `build-qmk.yml`.
6. **The app.** It lists each keyboard's files with their roles, offers a verified download, and explains how to flash:
   - the double reset;
   - the drive;
   - that a copy error at the end is normal;
   - for split keyboards, the order, and settings reset as a separate "fix pairing" step.

**Phase 2: direct write (Chromium).** The owner picks the bootloader drive. Keyballer reads `INFO_UF2.TXT` and checks the board, then writes the file. An error when the file is closed, after every byte was written, means the board has reset; the page asks whether the keyboard restarted. The download stays as the fallback.

**Phase 3: keymap view (built, read-only).** The build writes `<id>.view.json` from the final `zephyr.dts` (`scripts/zmk_view.py`), in the same format as the QMK build's view, so the existing keymap screen draws it, read-only for now: `E` says that editing ZMK keymaps comes later. ZMK cards get "View keymap" (and `V` for the first) when the build made a view. Asked by the owner: the view comes from the build, so it always matches the firmware it sits next to; each push to `main` builds it in about three minutes. Reading the live keymap over ZMK Studio (Web Serial) would show it without a build, and Studio edits too; that can come later.

- **Layout:** the chosen `zmk,physical-layout`, from centi-keyunits and centi-degrees (negative values are 32-bit two's complement in `zephyr.dts`) to key units and degrees.
- **Bindings, as the QMK keycode that means the same:** `&kp` usages (HID keyboard and consumer pages; implicit modifiers in the top byte become `LSFT(…)` and so on), hold-taps holding a modifier as `LALT_T(…)` and holding a layer as `LT(n, …)`, `&mo`, `&to`, `&tog`, `&sl`, `&sk`, `&trans`, `&none`, `&mkp`, `&bootloader`, `&sys_reset`, `&caps_word`, `&key_repeat`. Behaviours are recognised by their node's `compatible`, so a renamed or custom hold-tap reads the same.
- **No QMK keycode** (Bluetooth, output selection, macros, mouse movement, underglow…): a name of Keyballer's own (`ZMK_BT_SEL_0`) with a label (`BT 1`; an identifier such as `TO_LAYER_0` reads as words, `to layer 0`).
- **Combos:** key positions and output; their trigger keys are the base layer's keys there.
- **Layers:** named by `display-name`, then `label`, then the node name, as ZMK does. A layer with fewer bindings than keys is filled with no action, as ZMK leaves those keys; unused layers (`status` other than okay) at the end are left out, so that layer numbers keep their meaning.
- **Not yet:** the trackball (its position is not in the devicetree), combos limited to layers other than the base layer, and links to `.keymap` lines.
- **Errors:** a view that cannot be made is recorded as `view_error` and never fails the build; the settings reset gets none.

**Phase 4: keymap editing (built 2026-11-22).** The keymap screen's edit mode works for ZMK as it does for QMK. You can change keys, add, change and remove combos, and add, remove and rename layers. Saving goes through the same review and commits the `.keymap` file to `main`; the build then makes the new firmware and view. The editor needs no keyboard connected, so the whole loop can be checked on Actions.

- **Which file.** ZMK chooses the keymap file itself (`KEYMAP_FILE` in the build's `CMakeCache.txt`, set by `app/keymap-module/modules/modules.cmake` at both pinned ZMK commits). The build records that file in the view as `zmk.keymap`, with its path in the repository and its SHA-256, when it is plainly the repository's own `.keymap` file: a plain path, and no link on the way, checked in the repository itself because the workspace copy follows links. A keymap that comes from a module is not in the repository, so it cannot be edited.
- **What the keys mean.** This comes from the build; the source is not read for meaning again.
  - The editor opens only when the file on `main` has the SHA-256 that the build recorded.
  - The source must also match the build in structure: the same layer nodes, in order, with the same status and behaviour references (`zmk.layers`, every layer node of `zephyr.dts`, unused ones too), and every combo of the view found by its node name.
  - Otherwise the editor says why: the keymap changed after the build, or it is written with macros that Keyballer cannot follow.
  - After a save, the edited keymap is the starting point until the next build.
- **Writing a key.**
  - **Text already in the file.** A key takes its exact text from the file when the same key is somewhere in it. This keeps the owner's spelling (`&kp LEFT_ALT`, `&kp N7`), and lets custom behaviours and macros be copied.
  - **The name table.** Otherwise Keyballer writes it from a table of ZMK names:
    - `&kp` with ZMK's names: `LS(…)` and so on for modifiers, and `EXCL` and friends for shifted symbols;
    - `&mt` for a mod-tap that holds one modifier, and `&lt` for a layer-tap;
    - `&mo`, `&tog`, `&to`, `&sl`, `&sk`, `&trans`, `&none`, `&bootloader`, `&sys_reset`, `&caps_word` and `&key_repeat`.
  - **Behaviours that need a feature.** `&mkp` builds only with ZMK's mouse keys on, and `&bt` only with Bluetooth (`app/CMakeLists.txt` at the pinned commits). Keyballer offers them only when the keymap already uses that behaviour. `&out`, `&caps_word` and `&key_repeat` always build on the central. Keyballer adds the header a key's names need (`bt.h`, `outputs.h`, `pointing.h`) when the file does not include it.
  - **Refused, with a reason:** keys that ZMK has no binding for, such as Keyball's own keys, `TT`, `DF`, and a mod-tap that holds several modifiers.
  - **Checking the table.** The table is checked against ZMK's `keys.h` at both pinned ZMK commits (the headers are the same), through the build's own reader (`zmk_view.keycode`).
- **Columns.** The next binding on the line keeps its column when there is room.
- **Combos.** A ZMK combo is a set of key positions, so it stays at its positions when the keys there change. A new combo has no `layers`, so it works on every layer, and its node is named `combo_<output>`.
- **Layers.**
  - A new layer goes after the last layer in use, before any reserved ones. Every key is `&trans`, in the last layer's rows.
  - Removing a layer takes the last layer in use.
  - A layer's name is its `display-name`.
- **Shared keymaps.** The editor names no other build as sharing the file. Builds of one keyboard need not share a `.keymap` file (meteorite40 and its low-profile build do not), and only a split keyboard's central half uses it.
- **Checked end to end (2026-11-22).**
  - **The edit.** The session code changed the owner's `roBa.keymap` in one pass:
    - 21 kinds of key: plain, shifted, with modifiers, mod-tap, layer-tap, one-shot, Bluetooth, output, mouse button, media, caps word, bootloader, a custom behaviour and others;
    - a new combo, a changed one and a removed one;
    - a new layer, and two layer names.
  - **The build.** The file was built on a side branch of the owner's fork, which publishes nothing. ZMK built it.
  - **The result.** The build's view recorded the edited file's SHA-256 and matched the editor's view. Every layer, name and combo was the same, and so was every key except three, which were the same key spelled two ways (`KC_EXLM` and `LSFT(KC_1)`).
- **ZMK Studio.** For builds with Studio on, the review warns that changes made in ZMK Studio win: once a keymap has been changed there, ".keymap" edits apply only after "Restore Stock Settings" in ZMK Studio ([zmk.dev/docs/features/studio](https://zmk.dev/docs/features/studio)).
- **Not yet:**
  - combos limited to other layers, which stay as they are;
  - sensor bindings;
  - hold-tap settings;
  - editing macros.

## Decisions

- **`keyballer.json` for ZMK.** It is checked with `fullmatch`, like QMK's.

  ```json
  {
    "firmware": "zmk",
    "zmk": { "image": "docker.io/zmkfirmware/zmk-build-arm@sha256:…" },
    "builds": [
      { "id": "roba-right", "name": "roBa right", "group": "roba",
        "board": "seeeduino_xiao_ble", "shield": "roBa_R", "snippet": "studio-rpc-usb-uart" },
      { "id": "roba-left", "name": "roBa left", "group": "roba",
        "board": "seeeduino_xiao_ble", "shield": "roBa_L" },
      { "id": "roba-reset", "name": "roBa settings reset", "group": "roba",
        "board": "seeeduino_xiao_ble", "shield": "settings_reset" }
    ]
  }
  ```

  The fields and their patterns:

  | Field | Pattern |
  |---|---|
  | `id` | `[a-z0-9][a-z0-9_-]*` |
  | `name` | one line of text |
  | `group` | an id-like name; builds of one keyboard share it |
  | `board` | `[a-z0-9_]+(@[0-9.]+)?(/[a-z0-9_]*)*` |
  | `shield` and `snippet` | one or more space-separated `[A-Za-z0-9_-]+` |
  | `zmk.image` | required, pinned by digest. Use the image for ZMK's Zephyr: `zmk-build-arm:3.5` for Zephyr 3.5 (ZMK v0.3 and `main` before 2025-12-09), `4.1` after that. |

  There are no `cmake-args`: a value there reaches CMake, and nothing in the owner's builds needs one.
- **`config/west.yml`.** It is checked before `west` runs:
  - **remotes:** each `url-base` is `https://github.com/<owner>`;
  - **projects:**
    - each has a remote, a plain path, and a 40-hex `revision`;
    - `import` is allowed only on `zmk`, as `app/west.yml`, and on `zephyr`, as a `name-allowlist` or `name-blocklist`. Overriding `zephyr` replaces ZMK's import of it, so the config repeats ZMK's list;
    - `zmk` and `zephyr` stay at their own paths, and no other project may sit under `zmk`, `zephyr`, `config`, `build`, `modules`, `bootloader` or `tools`, so nothing else is built under their names;
    - names and remotes appear once, and there are no `defaults`;
    - there are no `submodules`;
  - **`self.path`** is `config`.

  After `west update`, `west manifest --resolve` must show a SHA for every project, so the config also pins `zephyr` (the top-level definition wins over ZMK's branch).
- **The containment check.** For every project that `config/west.yml` itself lists, before `west` runs, the build:
  - fetches the repository's branches and tags with `--filter=tree:0` into a new, empty repository, under `refs/keyballer/`;
  - requires `git for-each-ref --contains <sha>`, as `build_qmk.py` does for QMK sources.

  Nothing from a pinned project runs before this check. In particular, `west zephyr-export` is Zephyr's own command, so it runs only after the check: the security review showed that a forked Zephyr could otherwise plant a tag and pass. After `west update`, each project must be checked out at its pinned commit. Projects imported by ZMK or Zephyr are pinned by the manifest inside a commit that this check covers.
- **The published manifest.** The build writes `west manifest --resolve` to `<id>.west.yml`, which the manifest lists with its SHA-256. Every project in it is at a SHA, so it is the frozen manifest. `west manifest --freeze` itself refuses Zephyr's optional projects, which are not cloned.
- **No build cache.** A poisoned cache would be trusted. Builds take about three minutes.
- **What the build records** for each build, in its `<id>.json`:
  - `board`, `shield`, `snippet`, `group`, `file`, `format: "uf2"`, `west`;
  - the role from `zephyr/.config`: `central`, `peripheral`, `standalone` or `settings_reset`;
  - `studio` (whether ZMK Studio is on);
  - `uf2: {family, blocks, start, end}`;
  - `zmk_sha` and `zephyr_sha`, from the frozen manifest;
  - `image`.
- **The UF2 rules**, the same in Python (build) and TypeScript (browser):
  - the length is a positive multiple of 512;
  - every block has the three magics, flags exactly `0x2000`, family `0xADA52840`, a 256-byte payload, `blockNo` equal to its index, and the same `numBlocks` as the others;
  - every target address is 256-aligned and in `[0x27000, 0xEC000)`, the application area for SoftDevice S140 v7, as on the XIAO nRF52840. Boards with S140 v6 (application from `0x26000`, such as early nice!nano bootloaders) are refused until phase 2 reads `INFO_UF2.TXT`;
  - the addresses do not repeat.

  This refuses files that would overwrite the bootloader (family `0xd663823c`), the SoftDevice, or the settings and bonds. In the browser, the file's block count and range must also equal the manifest's.
- **Provenance.** `KEYBALLER_WORKFLOWS` lists `build-qmk.yml` and `build-zmk.yml`. The workflow commit must still be on Keyballer's `main`. Nothing else changes.
- **The owner's config repositories** get a pull request each:
  - **pins:** `config/west.yml` pinned by SHA, taking each designer's current working pins where they exist;
  - **config:** `keyballer.json`;
  - **workflow:** `.github/workflows/build.yml` replaced by one that calls Keyballer's `build-zmk.yml` (ZMK's unpinned workflow is removed).

  These pins build with `zmk-build-arm:3.5` (checked on Actions, 2026-11-22):

  | Project | roBa | meteorite40 |
  |---|---|---|
  | ZMK | `acfd8e5e` (`v0.3-branch`, as roBa's designer uses) | `abb64ba3` (`main` of 2025-12-07, the last on Zephyr 3.5, when the config was last changed) |
  | Zephyr | `dacab487` (`v3.5.0+zmk-fixes`) | `dacab487` |
  | Modules | `kumamuk-git/zmk-pmw3610-driver` at `main` | the four `iwk7273` modules as of 2025-12-01 |

  The builds and their roles:

  | Build | Role | ZMK Studio |
  |---|---|---|
  | roBa right | central | on |
  | roBa left | peripheral | off |
  | roBa settings reset | settings_reset | off |
  | meteorite40, meteorite40 (low profile) | standalone | on |

  Every UF2 file starts at `0x27000`. Each build takes about three minutes.

## User stories

1. As a roBa or meteorite40 owner, I want Keyballer to build my ZMK config on GitHub Actions and show the firmware like my Keyball's, so that one tool covers all my keyboards.
2. As an owner, I want Keyballer to refuse a UF2 file that its build did not record, or that would overwrite the bootloader or my pairings, so that a leaked token cannot brick or take over a keyboard.
3. As a split-keyboard owner, I want to see which file goes on which half, in order, so that I flash the right halves.
4. As an owner whose halves stopped pairing, I want a separate "fix pairing" step with the settings reset, so that I never flash it by accident.
5. As an owner, I want the flashing steps (double reset, the drive's name, the copy error that is normal), so that I can flash without searching the ZMK docs.

## Threat model (additions)

| Threat | What it could do | Defence |
|---|---|---|
| A stolen token commits a `keyballer.json` or `west.yml` value that injects into the workflow | Code in the publish job; a forged record | `fullmatch` on every value; values reach `west` and `git` as argument lists, never shell text; no expressions in `run:` |
| A stolen token points `west.yml` at a branch, or at a fork's commit through the upstream URL | New code without a reviewable commit, or someone else's code under an upstream name | SHAs only, before and after `west update`; every commit must be in a branch or tag of the repository it comes from; the frozen manifest is published |
| A crafted UF2 (bootloader family, writes over the bootloader, SoftDevice or bonds) | A bricked or taken-over keyboard | The UF2 rules in the build and in the browser |
| A stolen token rewrites the `firmware` branch | Unbuilt UF2 on the keyboard | Provenance, as for QMK |
| A module or ZMK commit with malicious code on `main` | Firmware built from it | As for QMK, not preventable once a token can write. The flash step shows the run, the commit and the pinned ZMK and Zephyr SHAs. |
| The bootloader has no signatures | Anything that reaches the drive is flashed | Outside Keyballer. The browser offers only checked bytes; a file the owner copies by hand is their choice. |

## Testing decisions

**Seams** (TDD, with expected values from the UF2 spec and the bootloader source):
- **The UF2 check**, in Python and TypeScript: synthetic files built from the spec's constants, plus each refusal (family, flags, payload size, an address outside the range, a misaligned address, a short file, block numbering).
- **`build_zmk.py` config and `west.yml` checks:** each refusal, plus the owner's real files.
- **The manifest and provenance:** the new fields, and the workflow list.
- **The app:** listing a group's files with their roles, and the download offering only checked bytes.

**Real runs:** build both owner configs on Actions; flash on the owner's hardware (owner step).

## Out of scope

- Direct write (phase 2), until the owner has flashed by hand.
- Building ZMK locally with Docker. The QMK path has it; ZMK can follow.
- ZMK Studio over Web Serial.
- Keyboards whose bootloader is not the Adafruit nRF52 UF2 bootloader.
