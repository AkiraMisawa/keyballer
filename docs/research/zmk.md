# ZMK support: builds, provenance and UF2 flashing

Research date: 2026-11-22.

Sources are primary; links are at the end. **Observed** marks what I checked myself on 2026-11-22. That covers source code read at the commits named in Sources, GitHub and Docker Hub API calls, two upstream build logs, and one upstream firmware artifact that I parsed locally. Nothing was built or flashed. **Inference** marks my own reasoning.

**The brief assumed both keyboards are split.** Only roBa is. meteorite40 is a single-board keyboard: one XIAO, a charlieplexed 7×7 matrix, and no `ZMK_SPLIT` anywhere (Observed).

## Summary

- **Build workflow.** ZMK's `build-user-config.yml` puts `${{ }}` matrix values straight into shell and uses a moving image tag. Keyballer needs its own `build-zmk.yml` that validates values, pins the image by digest and records a frozen west manifest.
- **Pinning.** `west update` verifies nothing, and ZMK tracks Zephyr by **branch**. Pinning ZMK alone does not pin Zephyr.
- **The owner's forks.** They build ZMK `main` for `seeeduino_xiao_ble`, a board that `main` has called `xiao_ble//zmk` since 2025-12-09. **Inference:** they do not build today; pin ZMK v0.3.0 first.
- **roBa's central is the right half** (Observed). Read each half's role from the build.
- **The bootloader trusts any block.** It flashes UF2 blocks written to any sector and accepts a family that replaces the bootloader. There are no signatures, so Keyballer must validate the file first.
- **Direct write.** Chromium's blocklist allows `/Volumes/<name>` and `E:\` (Inference from source). `createWritable()` writes a `.crswap` file that the bootloader flashes as it arrives; `close()` probably fails afterwards.
- **Keymap view.** The build's `zephyr.dts` holds layers, combos and physical layouts in resolved form (Observed).

## 1. ZMK user-config builds in GitHub Actions

- **Inputs:** `build_matrix_path` (`build.yaml`), `config_path` (`config`), `fallback_binary` (`bin`) and `archive_name` (`firmware`) [zmk-buc].
- **Matrix.** `yq` turns `build.yaml` into the job matrix. Each entry may set `board`, `shield`, `snippet`, `cmake-args` and `artifact-name`. A settings-reset build is just `shield: settings_reset`, which the owner's roBa already lists (Observed).
- **Steps** (Observed in [zmk-buc]): `west init -l config`, then `west update --fetch-opt=--filter=tree:0`, then `west build -s zmk/app -b <board> [-S <snippet>] -- -DZMK_CONFIG=… -DSHIELD=… <cmake-args>`. If `zephyr/module.yml` exists, the repository is also passed as `-DZMK_EXTRA_MODULES`. The job prints `.config` and `zephyr.dts` to the log.
- **Outputs.** `zephyr/zmk.uf2` (or `zmk.bin`) is renamed `${shield}-${board, "/"→"_"}-zmk`, and all files are merged into one `firmware` artifact [zmk-buc]. Example: `meteorite40-xiao_ble__zmk-zmk.uf2` (Observed in [up-m40]).
- **Image.** Both v0.3.0 and `main` use `zmkfirmware/zmk-build-arm:stable` [zmk-buc].
  - **Observed** [zmk-docker]: `stable` and `4.1` share the digest `sha256:edb1c953…afc5` (2025-10-03), which is the digest the upstream build pulled.
  - The tag moves. `image@sha256:…` pins it, as Keyballer already does for `qmk_cli`.
- **Hardening gaps** (Observed). `${{ matrix.board }}`, `${{ matrix.cmake-args }}` and `${{ inputs.build_matrix_path }}` are expanded inside `run:` scripts, and actions are pinned by tag. Both break Keyballer's rules.
- **Our workflow** (Inference). Mirror `build-qmk.yml`:
  - **Plan job:** runs `build_zmk.py --list/--image`.
  - **Build job:** `contents: read`, with the image pinned by digest. It runs `build_zmk.py … --only "$ID"`, which calls `west` with argument lists.
  - **Publish job:** unchanged.
  - **Validation**, each value checked with `fullmatch`:
    - `board`: `[a-z0-9_]+(@[0-9.]+)?(/[a-z0-9_]*)*`;
    - `shield` and `snippet`: space-separated `[A-Za-z0-9_-]+`;
    - `cmake-args`: dropped, or limited to `-DCONFIG_[A-Z0-9_]+=(y|n|[0-9]+)`.
- **Untrusted code still runs in the build.** The config repository is a Zephyr module, and `west build` runs Python from the checked-out Zephyr [west-manifest]. As with QMK's `rules.mk`, that is acceptable only because the build job holds no write token and the publish job only hashes the bytes.
- **Timing** (Observed): 3:35 per run for roBa [up-roba], and 2:37 for meteorite40 with the cache restored [up-m40].
- **Cache.** Restore keys fall back as far as `${{ runner.os }}-` [zmk-buc], and `west update` does not fetch SHAs already present [west-built-in]. **Inference:** start without a cache, because a poisoned cache would be trusted.

## 2. west.yml: pinning, verification and fork commits

- **Revisions** may be "any fetchable git reference: branch, tag, SHA, pull request" [west-manifest].
- **Fetching.** Branches are always fetched; SHAs and tags already present locally are not. "West may fetch all refs from the Git server when given a SHA" [west-built-in].
- **Verification.** The west docs do not mention integrity or signatures. **Inference:** git's object ID is the only link between a SHA and its code.
- **Freezing.** `west manifest --freeze` writes a manifest in which "every project's revision is a SHA" [west-manifest]. Record one per build.
- **Precedence.** "The first definition is used", and the top-level manifest's own projects beat imported ones [west-manifest]. A config `west.yml` can therefore override `zephyr`.
- **Tags move.** ZMK moved its `v0.2` tag to `v0.2.1` [zmk-pin]. The latest release is v0.3.0 (`edf5c081…`, 2025-08-01; Observed in [zmk-rel]). v0.4 will be the first on Zephyr 4.1 [zmk-z41].
- **Zephyr is a branch.** `app/west.yml` sets `zephyr` to `v3.5.0+zmk-fixes` (v0.3.0) or `v4.1.0+zmk-fixes` (`main`) [zmk-appwest]. Both are branches of `zmkfirmware/zephyr` (Observed).
- **The owner's repositories** (Observed: [own-roba], [own-m40]):
  - roBa uses `zmk@main` and `kumamuk-git/zmk-pmw3610-driver@main`.
  - meteorite40 uses `zmk@main` and four `iwk7273` modules at `@main`.
  - Both build `seeeduino_xiao_ble` with `build-user-config.yml@main`, and neither has any runs.
  - Upstream, roBa now pins `v0.3-branch`. meteorite40 builds `xiao_ble//zmk` from **`iwk7273/zmk`** at a SHA, and the owner's fork is 348 commits behind it.
- **The modules are forks too** (Observed):
  - `kumamuk-git/zmk-pmw3610-driver` is a fork of `inorichi/…`;
  - `iwk7273/zmk-pmw3610-driver` is a fork of `badjeff/…`;
  - `iwk7273/zmk-feature-sensor_rotation` is a fork of `hsgw/…`.
- **Fork smuggling.** GitHub serves fork-network commits through the parent's URL. For QMK, `build_qmk.py` fetches branches and tags and requires `for-each-ref --contains` [kb-plan], [kb-qmk].
  - **Inference:** run the same check after `west update` for ZMK and every module.
  - **Inference:** decide whether a ZMK fork such as `iwk7273/zmk` is allowed.

## 3. UF2 and the Adafruit nRF52 bootloader

- **Format** [uf2]. A file is 512-byte blocks of little-endian u32 fields:
  - magic numbers `0x0A324655` and `0x9E5D5157` at offsets 0 and 4, and `0x0AB16F30` at 508;
  - flags, target address, payload size, block number, block count and family ID, then 476 bytes of data.
  - Flags: `0x1` not main flash, `0x1000` file container, `0x2000` family ID, `0x4000` MD5, `0x8000` extension tags.
- **Family ID.** NRF52840 is `0xada52840` [uf2-fam].
- **A real file** (Observed, upstream meteorite40): 1,197 sequential blocks, all with flags `0x2000`, family `0xada52840` and 256-byte payloads, at contiguous addresses from `0x27000` to `0x71c00`.
- **What the bootloader accepts** [ada-ghostfat]:
  - A block needs the magics and the family flag, and no not-main-flash flag. Its payload must be 256 bytes at a 256-aligned address.
  - Accepted families: `0xADA52840`, the board's own `(VID<<16)|PID`, and `0xd663823c`, which **replaces the bootloader**.
  - Application writes may go anywhere from `0x1000` up to the application-data reserve below the bootloader, which includes the SoftDevice.
  - "UF2 format does NOT support signing keys" [ada-bl].
- **Flash layout** [zephyr-part]. With SoftDevice v7, code is at `0x27000–0xEC000`, settings and bonds at `0xEC000`, and the bootloader at `0xF4000`. With v6, code starts at `0x26000`.
- **The drive** is a FAT16 "ghost" volume of just under 32 MB [ada-uf2cfg].
  - It holds `INFO_UF2.TXT` (`Model:`, `Board-ID:`, `Date:`, `SoftDevice:`), `INDEX.HTM` and `CURRENT.UF2` [ada-ghostfat]. Tools should detect a board by `INFO_UF2.TXT` [uf2].
  - Labels and board IDs [ada-boards]:
    - `NICENANO`, `nRF52840-nicenano`;
    - `XIAO-BOOT`, `nRF52840-SeeedXiao-v1`;
    - `XIAO-SENSE`, `nRF52840-SeeedXiaoSense-v1`.
- **Flashing.**
  - Every written sector goes to `write_block`. Data that is not UF2 is ignored, and file names are never read [ada-msc].
  - Once the bootloader has seen every block, the controller unmounts and restarts [zmk-setup].
  - It "resets itself before the OS receives confirmation", so transfer errors "are normal". macOS 14 reports "Error code -36" [zmk-flashing].
- **Entering the bootloader.**
  - Reset twice within 500 ms [ada-bl]: "double tap reset" on the nice!nano [nn-docs], or click twice rapidly on the XIAO [seeed-wiki].
  - Seeed's bootloader image is `…0.6.1_s140_7.3.0` [seeed-wiki], which matches the `0x27000` start.
  - ZMK's `&bootloader` resets the half that holds the binding [zmk-reset]. Both of the owner's keymaps bind it (Observed).

## 4. Writing the file from a web page

- **API.**
  - `showDirectoryPicker({mode:'readwrite'})` needs transient activation. It throws `AbortError` if the browser deems the directory "too sensitive or dangerous" [mdn-sdp].
  - **Support:** Chromium 86 on desktop and Chrome 132 on Android; not Firefox or Safari [bcd]. Keyballer's Web Serial users are already on desktop Chromium.
- **Blocklist** (`kBlockPaths` [cr-perm]):
  - **macOS:** `/System/Volumes`, `/dev`, `/Applications`, `~/Library` and app data.
  - **Windows:** Program Files, Windows, AppData, and local UNC paths.
  - **Matching:** a path is refused if it is a blocked path, lies inside one, or is a **parent** of one.
  - **Inference, untested:** `/` and `C:\` are refused. `/Volumes/XIAO-SENSE` and `E:\` match no rule and are allowed.
- **When the bytes are written.** `createWritable()` writes to `<name>.crswap` in the same directory [cr-handle]. On `close()`, Chromium reads the swap file back to hash it for its safety checks, then moves it over the target [cr-writer], [cr-move].
  - **Inference:** the bootloader flashes the blocks as the OS writes the `.crswap` sectors, then resets after the last one. `close()` therefore probably fails on a vanished volume. When the OS flushes is outside Chromium's control, and a partial write is recovered by a double-tap.
- **Persistence.** Since Chrome 122 the prompt offers "Allow on every visit", for handles kept in IndexedDB and re-requested with `requestPermission()` [cr-persist]. Nothing is said about removable drives.
- **Alternatives.**
  - **WebUSB:** Mass Storage (`0x08`) is a protected class, so `claimInterface` throws `SecurityError` [webusb].
  - **Download and drag:** ZMK's documented route [zmk-setup].
  - **Serial DFU:** the bootloader also offers DFU over CDC serial [ada-bl]. It is a separate protocol, which I did not investigate.

## 5. Split keyboards

- **Roles.** The central runs the keymap and talks to the hosts. Peripherals neither enumerate nor advertise. "By convention" the left half is central [zmk-split].
- **roBa** (Observed). `Kconfig.defconfig` makes `roBa_R` the central, with the trackball and the Studio snippet. `roBa_L` is the peripheral, with the encoder. **Inference:** take each role from the build's `zephyr/.config` (`CONFIG_ZMK_SPLIT_ROLE_CENTRAL`).
- **Files.** Each part needs its own file. Keymap changes "typically" need only the central; config changes need every part [zmk-split].
- **settings_reset.**
  - Bonds are **not** cleared by normal flashing [zmk-settings].
  - Reset when changing which half is central, or after replacing a controller [zmk-conn].
  - Procedure: reset firmware on every part, then the real firmware, then forget and re-pair the keyboard on each host. Bluetooth is off in the reset firmware [zmk-conn].
- **BLE notes for users.** The halves pair automatically; if they do not, reset both at once [zmk-setup]. A dual-boot host cannot share one profile between its systems [zmk-conn].

## 6. Keymaps and ZMK Studio

- **Format.** A `.keymap` is preprocessed devicetree [zmk-keymaps], [zmk-combos]. A `compatible = "zmk,keymap"` node has one child per layer, each with `bindings = <&kp A &mt LSHIFT B …>` (up to two parameters per binding). Combos list `key-positions`, `bindings` and optional `layers`. The owner's keymaps also use macros and behaviors from modules (Observed).
- **Machine-readable output** (Observed in the [up-m40] log). The final `zephyr.dts` keeps labels next to resolved values:
  - `display-name = "BASE"; bindings = < &kp 0x70014 … &mt 0x700e1 0x70004 … >`;
  - combos with `key-positions`;
  - physical layouts as `&key_physical_attrs w h x y r rx ry`, in hundredths of a key [zmk-physical].
  - **Inference:** parse it in the build with Zephyr's `dtlib` and decode the HID usages (pages `0x07` and `0x0C`, modifiers in the high byte). Behaviors from modules show only their label.
- **keymap-drawer** (MIT) preprocesses the `.keymap` "similar to the ZMK build system" [kd]. roBa already has a manual `draw.yml` for it (Observed).
- **ZMK Studio.**
  - It edits the keymap at runtime over USB in Chrome or Edge at zmk.studio. Over BLE it works only on Linux and in the native apps, and combos are "planned" [zmk-studio].
  - **Studio edits win.** After Studio is used, later `.keymap` edits "will not be applied" until "Restore Stock Settings" [zmk-studio], so a view built from the repository can be wrong.
  - The protocol is protobuf in `0xAB`/`0xAC`/`0xAD` frames [zmk-rpc], with `get_keymap` and `get_physical_layouts` [studio-msgs]. The MIT TypeScript client uses Web Serial [studio-ts].
  - Both of the owner's configs set `ZMK_STUDIO=y` with locking off (Observed).

## What this means for Keyballer

**Phase 1: build, provenance and UF2 by download.**

1. **Repin the configs (owner step).** Pin both to SHAs on ZMK v0.3.0 (`edf5c081…`) with `seeeduino_xiao_ble`. Move to `xiao_ble//zmk` once the PMW3610 forks support Zephyr 4.1.
2. **Add `build-zmk.yml` and `build_zmk.py`.**
   - **`keyballer.json`:** validated, with `"firmware": "zmk"`, `zmk.image` pinned by digest, and each build's `id`, `name`, `board`, `shield`, `snippet` and `group`.
   - **Manifest rules:** every config-manifest revision is a 40-hex SHA on github.com, with no `submodules` and no `import` except ZMK's.
   - **After `west update`:** the containment check, then the manifest saved as `<id>.west.yml`. (As built, the check runs before `west update` in a scratch repository, and the saved manifest is `west manifest --resolve`, because `--freeze` refuses uncloned projects; see docs/plans/zmk.md.)
3. **Manifest fields** for each build:
   - `firmware: "zmk"`, `format: "uf2"`, `board`, `shield`, `snippet`, `group`;
   - from `.config`: `role` (`central`, `peripheral`, `standalone` or `settings_reset`) and `studio`;
   - `uf2: {family, blocks, start, end}`;
   - `zmk_sha`, `zephyr_sha`, `image`, `sha256` and `west_sha256`.
4. **Provenance.** Accept `build-zmk.yml` in `KEYBALLER_WORKFLOW`; the rest of `judgeProvenance` stays.
5. **Validation in the browser**, before offering the bytes:
   - The SHA-256 matches, and the length is a multiple of 512.
   - Every block has the magics, flags of exactly `0x2000`, family `0xADA52840`, a 256-byte payload, `blockNo` equal to its index, and the same `numBlocks`.
   - Every address lies within `[0x26000, 0xEC000)` and inside the manifest's range.
   - These checks refuse bootloader and SoftDevice overwrites.
6. **UI.** List each group's files, central first, and put `settings_reset` behind a "fix pairing" flow. Download a verified Blob, with steps for the double-tap, the drive name, and "an error after copying is normal".

**Phase 2: direct write (Chromium).** The user picks the drive. Keyballer checks that the `Board-ID` in `INFO_UF2.TXT` matches the board, then writes `<id>.uf2`. A `close()` error after a complete `write()` means "probably flashed", so ask the user to confirm. Keep the download as the fallback, and test on macOS and Windows.

**Phase 3: keymap view.** Generate `<id>.view.json` from `zephyr.dts` in the build. Later, read the live keymap over Studio RPC on Web Serial, which also catches Studio edits.

**Risks.**

- Third-party modules are code, often forks of forks; pinning freezes them but reviewing them is not something Keyballer can do.
- The Zephyr branch can move even when ZMK is pinned.
- The direct write is untested on real hardware.
- Studio edits make a repository view stale.
- `settings_reset` wipes every bond.
- ZMK v0.4 renames the boards.

## Not confirmed

- How Chromium's write behaves on a real UF2 drive, and the handle name of a drive root on Windows.
- That Chromium allows `/Volumes/<name>` and `E:\`; this rests on reading the code only.
- Which label the owner's XIAOs show: `XIAO-BOOT` or `XIAO-SENSE`.
- Whether the PMW3610 forks build on Zephyr 4.1.
- Whether `get_keymap` works on a locked keyboard.
- Serial DFU over CDC from Web Serial.
- nice!nano's application start address under ZMK.

## Sources

[zmk-buc]: https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/.github/workflows/build-user-config.yml
[zmk-appwest]: https://github.com/zmkfirmware/zmk/blob/4de313367288aad5aeaa1243890e40dc813f7008/app/west.yml
[zmk-rel]: https://github.com/zmkfirmware/zmk/releases
[zmk-pin]: https://zmk.dev/blog/2025/06/20/pinned-zmk
[zmk-z41]: https://zmk.dev/blog/2025/12/09/zephyr-4-1
[zmk-setup]: https://zmk.dev/docs/user-setup
[zmk-flashing]: https://zmk.dev/docs/troubleshooting/flashing-issues
[zmk-split]: https://zmk.dev/docs/features/split-keyboards
[zmk-conn]: https://zmk.dev/docs/troubleshooting/connection-issues
[zmk-settings]: https://zmk.dev/docs/config/settings
[zmk-reset]: https://zmk.dev/docs/keymaps/behaviors/reset
[zmk-keymaps]: https://zmk.dev/docs/keymaps
[zmk-combos]: https://zmk.dev/docs/keymaps/combos
[zmk-physical]: https://zmk.dev/docs/hardware-integration/physical-layouts
[zmk-studio]: https://zmk.dev/docs/features/studio
[zmk-rpc]: https://zmk.dev/docs/development/studio-rpc-protocol
[studio-msgs]: https://github.com/zmkfirmware/zmk-studio-messages/blob/main/proto/zmk/keymap.proto
[studio-ts]: https://github.com/zmkfirmware/zmk-studio-ts-client/blob/main/src/transport/serial.ts
[zmk-docker]: https://hub.docker.com/r/zmkfirmware/zmk-build-arm/tags
[zephyr-part]: https://github.com/zmkfirmware/zephyr/blob/v4.1.0%2Bzmk-fixes/dts/common/nordic/nrf52840_partition_uf2_sdv7.dtsi
[west-built-in]: https://docs.zephyrproject.org/latest/develop/west/built-in.html
[west-manifest]: https://docs.zephyrproject.org/latest/develop/west/manifest.html
[uf2]: https://github.com/microsoft/uf2/blob/70fdee51cf15a487526e88ada2d52346596f80af/README.md
[uf2-fam]: https://github.com/microsoft/uf2/blob/70fdee51cf15a487526e88ada2d52346596f80af/utils/uf2families.json
[ada-bl]: https://github.com/adafruit/Adafruit_nRF52_Bootloader/blob/0ee83433a6b8ec23341629d2407cbf0fc62335f3/README.md
[ada-ghostfat]: https://github.com/adafruit/Adafruit_nRF52_Bootloader/blob/0ee83433a6b8ec23341629d2407cbf0fc62335f3/src/usb/uf2/ghostfat.c
[ada-msc]: https://github.com/adafruit/Adafruit_nRF52_Bootloader/blob/0ee83433a6b8ec23341629d2407cbf0fc62335f3/src/usb/msc_uf2.c
[ada-uf2cfg]: https://github.com/adafruit/Adafruit_nRF52_Bootloader/blob/0ee83433a6b8ec23341629d2407cbf0fc62335f3/src/usb/uf2/uf2cfg.h
[ada-boards]: https://github.com/adafruit/Adafruit_nRF52_Bootloader/tree/0ee83433a6b8ec23341629d2407cbf0fc62335f3/src/boards
[nn-docs]: https://nicekeyboards.com/docs/nice-nano/getting-started
[seeed-wiki]: https://wiki.seeedstudio.com/XIAO_BLE/
[cr-perm]: https://chromium.googlesource.com/chromium/src/+/f530a8431327f0e1b8600ed3f139ddd47373cc7c/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc
[cr-handle]: https://chromium.googlesource.com/chromium/src/+/f530a8431327f0e1b8600ed3f139ddd47373cc7c/content/browser/file_system_access/file_system_access_file_handle_impl.cc
[cr-writer]: https://chromium.googlesource.com/chromium/src/+/f530a8431327f0e1b8600ed3f139ddd47373cc7c/content/browser/file_system_access/file_system_access_file_writer_impl.cc
[cr-move]: https://chromium.googlesource.com/chromium/src/+/f530a8431327f0e1b8600ed3f139ddd47373cc7c/content/browser/file_system_access/file_system_access_safe_move_helper.cc
[cr-persist]: https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
[mdn-sdp]: https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
[bcd]: https://github.com/mdn/browser-compat-data/blob/main/api/Window.json
[webusb]: https://wicg.github.io/webusb/#has-a-protected-interface-class
[kd]: https://github.com/caksoylar/keymap-drawer
[own-roba]: https://github.com/AkiraMisawa/zmk-config-roBa/tree/64f6748ece7bd48b8935dd72da5b8df5c6c41204
[own-m40]: https://github.com/AkiraMisawa/zmk-config-meteorite40/tree/7060610bf5186da084f8fe1a90188747be72ebc1
[up-roba]: https://github.com/kumamuk-git/zmk-config-roBa/actions/runs/23657733078
[up-m40]: https://github.com/iwk7273/zmk-config-meteorite40/actions/runs/36013704619
[kb-plan]: ../plans/github-login.md
[kb-qmk]: ../../scripts/build_qmk.py

- The zmk.dev pages were read from `docs/` at the `zmk` commit in [zmk-buc].
- Chromium was read at `main` `f530a843`.
- MDN compatibility data was read from `api/Window.json` and `api/FileSystemFileHandle.json`.
