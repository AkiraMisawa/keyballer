# Keyballer

English | [日本語](README.ja.md)

Keyballer builds keyboard firmware with GitHub Actions and flashes it straight from your browser.

**App:** not published while it is being built. Run it on your computer: `npm ci && npm run build && npm run preview`, then open http://127.0.0.1:4173 (English and Japanese; add `?lang=ja` to open it in Japanese). Flashing works there too.

```
Config repository (keymaps etc.) ──push──▶ GitHub Actions builds
                                                  │
                                                  ▼
                                   hex files on the firmware branch
                                                  │
Keyballer (this app) ◀──── GitHub API ────────────┘
     │
     └──Web Serial──▶ keyboard (Pro Micro)
```

- Your settings live in a GitHub repository per keyboard. Change the keymap and push; the build starts on its own.
- The build steps are a shared workflow in this repository, so a config repository calls it in a few lines.
- Flashing uses Web Serial in Chrome / Edge. Nothing to install.
- No sign-in is needed for public repositories. Without a token, Keyballer reads their files from raw.githubusercontent.com, so it stays well within GitHub's 60 API requests an hour.

## Status

| | Status |
| --- | --- |
| QMK builds | Supported, including keyboards defined outside qmk_firmware (for example Yowkees/keyball) |
| ZMK builds | Supported, with Keyballer's workflow |
| Flashing Pro Micro (ATmega32U4 / Caterina) | Supported |
| Flashing nRF52840 (UF2, ZMK) | Supported: a checked file to copy onto the keyboard's drive. Writing it from the page, and RP2040, are planned |
| Keymap editor | Supported (keys, combos, layers), for QMK and ZMK |
| LED settings | Supported for QMK (RGB Lighting): LEDs per build, effect, colour, brightness, the effects the LED keys switch between, and a firmware size estimate |

## Config repository

Example: [AkiraMisawa/keyballer-config](https://github.com/AkiraMisawa/keyballer-config)

```
keyballer.json              what to build
keymaps/<keymap>/           QMK keymap (keymap.c, config.h, rules.mk)
.github/workflows/build.yml calls the shared workflow
```

### keyballer.json

```json
{
  "firmware": "qmk",
  "qmk": { "version": "0.22.14" },
  "sources": [
    {
      "repo": "Yowkees/keyball",
      "ref": "4664de991d14da34bd42e7031ac7406b6ccb02af",
      "path": "qmk_firmware/keyboards/keyball",
      "as": "keyball"
    }
  ],
  "builds": [
    {
      "id": "keyballplus",
      "name": "Keyball+",
      "keyboard": "keyball/keyballplus",
      "keymap": "am338",
      "keymap_dir": "keymaps/am338",
      "ball": "right"
    }
  ],
  "views": {
    "keymaps/am338": {
      "layers": ["Base", "Symbol", "Number", "Function"],
      "ball": { "default": "cursor", "3": "scroll" },
      "labels": { "SCRSHOT_AREA": { "en": "Area shot", "ja": "範囲スクショ" } }
    }
  }
}
```

| Field | Meaning |
| --- | --- |
| `qmk.version` | QMK tag to build with. Before changing it, see [docs/plans/qmk-upgrades.md](docs/plans/qmk-upgrades.md) |
| `qmk.image` | (Optional) `ghcr.io/qmk/qmk_cli` image to build in. Defaults to one tested with QMK 0.22.14 |
| `sources[]` | Keyboard definitions that are not in qmk_firmware. `path` in `repo` at `ref` is used as QMK's `keyboards/<as>` |
| `builds[].id` | ID used for output file names (lowercase letters, digits, `-`, `_`) |
| `builds[].name` | Name shown in the app |
| `builds[].keyboard` / `keymap` | Passed to `qmk compile -kb <keyboard> -km <keymap>` |
| `builds[].keymap_dir` | Keymap folder in the config repository. Several builds can share one |
| `builds[].ball` | (Optional) Where the trackball is, for the keymap view: `none`, `right` (default), `left` or `dual` |
| `builds[].leds` | (Optional) Whether the board has LEDs: `true` builds it with RGB Lighting, `false` without. Without it, the keymap's `rules.mk` decides |
| `views` | (Optional) How the keymap view names things, per keymap folder: `layers` (layer names), `ball` (what the ball does per layer, with a `default`), `labels` (names for custom keycodes, in `en` and `ja`) |

### .github/workflows/build.yml

```yaml
name: Build firmware

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: build-firmware
  cancel-in-progress: true

jobs:
  build:
    uses: AkiraMisawa/keyballer/.github/workflows/build-qmk.yml@main
    permissions:
      contents: write
```

When a build of the default branch succeeds, the `firmware` branch is replaced by a single commit holding `manifest.json` and the firmware files. `manifest.json` lists the SHA-256 of each file, and the build run keeps an artifact named after the manifest's own SHA-256. Keyballer flashes only firmware that matches a manifest recorded by a successful run of the build for the default branch, and shows the run and the commit. A token can rewrite the `firmware` branch but cannot change what a run recorded, so a leaked token cannot slip firmware onto your keyboard without a commit on `main`. GitHub keeps the records for 90 days; older firmware is built again before flashing. For the same reason, `keyballer.json` pins what the build pulls in: `sources[].ref` must be a full commit SHA, and `qmk.image`, if set, must be pinned by `@sha256:`. A ruleset on `main` that blocks force-pushes and deletion is recommended.

### ZMK config repositories

A ZMK user config (for example [AkiraMisawa/zmk-config-roBa](https://github.com/AkiraMisawa/zmk-config-roBa)) builds with `build-zmk.yml` instead. Add `keyballer.json` at the top, next to `config/west.yml`, and call the workflow from `.github/workflows/build.yml` as above, with `build-zmk.yml`. ZMK's own `build.yaml` is not read. Plan: [docs/plans/zmk.md](docs/plans/zmk.md).

```json
{
  "firmware": "zmk",
  "zmk": { "image": "docker.io/zmkfirmware/zmk-build-arm@sha256:0979a8de…" },
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

| Field | Meaning |
| --- | --- |
| `zmk.image` | The build image, pinned by digest: `zmk-build-arm:3.5` for ZMK on Zephyr 3.5, `4.1` for newer ZMK |
| `builds[].group` | Builds of one keyboard share a group: both halves and the settings reset |
| `builds[].board`, `shield`, `snippet` | As in ZMK's `build.yaml` (several shields or snippets separated by spaces). There are no `cmake-args` |

`config/west.yml` must pin every project by full commit SHA, Zephyr included. ZMK names Zephyr by branch, so the config lists `zephyr` itself, with ZMK's import list. Each commit must be in a branch or tag of the repository it names. The build checks this before `west` runs, because GitHub serves a fork's commits through the parent's URL. The build records each file's role (central, peripheral, standalone or settings reset) and publishes the resolved `west.yml` next to the UF2 file. A UF2 file is kept only if every block targets the nRF52840's application area: the build refuses files that would overwrite the bootloader, the SoftDevice or the pairings.

## Building locally

Docker runs the same image and script as GitHub Actions.

```sh
docker run --rm \
  -v "$PWD/keyballer:/keyballer:ro" \
  -v "$PWD/keyballer-config:/config:ro" \
  -v "$PWD/out:/out" \
  -e WORK_DIR=/tmp/keyballer-work \
  ghcr.io/qmk/qmk_cli@sha256:2dc05fc9f32efebd6b05c2b8676ee548358bc7e151e9dbf4dac6b6eed4513b07 \
  python3 /keyballer/scripts/build_qmk.py /config /out
```

Flash the resulting `out/*.hex` with "Flash a hex file from your computer" in the app.

On Apple Silicon, Docker runs the arm64 image, which ships an older avr-gcc (5.4.0) than the x86 image GitHub Actions uses (8.3.0). Local builds therefore come out a few hundred bytes larger than CI builds.

## Development

```sh
npm ci
npm run dev     # dev server, http://127.0.0.1:5173
npm test        # Vitest (flashing is tested against an in-memory bootloader)
npm run build   # type check, build, and check that dist/ holds no sign-in settings
```

### Signing in on your own computer

When Keyballer runs on your computer (`npm run dev`, or `npm run build` then `npm run preview` at http://127.0.0.1:4173), it can sign in with GitHub instead of a pasted token. The hosted site keeps the pasted token.

The sign-in lasts until the tab closes, or 8 hours. It reaches only the repositories you install the app on. Signing out, or closing the tab, revokes it. Plan and threat model: [docs/plans/github-login.md](docs/plans/github-login.md).

It needs a GitHub App of your own. Register one at <https://github.com/settings/apps/new>:

- **Homepage URL:** anything, for example this repository.
- **Callback URLs:**
  - `http://127.0.0.1:5173/auth/callback`
  - `http://127.0.0.1:4173/auth/callback`
- **Expire user authorization tokens:** on.
- **Off:**
  - "Request user authorization (OAuth) during installation";
  - "Enable Device Flow";
  - the Setup URL;
  - the webhook ("Active").
- **Repository permissions:** Contents: Read and write, Actions: Read (Metadata: Read is added by GitHub). No account permissions.
- **Where can this GitHub App be installed?** Only on this account.

Then, on the app's page:

1. Generate a client secret.
2. Install the app on your config repository only ("Only select repositories").
3. Put the settings in `.env.local` at the top of this repository. Git ignores this file; never commit it.

```sh
KEYBALLER_GITHUB_CLIENT_ID=<the app's Client ID>
KEYBALLER_GITHUB_CLIENT_SECRET=<the client secret>
KEYBALLER_GITHUB_APP_SLUG=<the app's URL name, for the install link (optional)>
```

Vite reads these on its own server only. They never reach the page or `dist/`.

Build scripts have their own tests: `python3 -m unittest discover -s scripts -p 'test_*.py'`.

Pushing to `main` runs the tests and the build. Publishing to GitHub Pages is paused: the deploy job runs only when the repository variable `PAGES_PUBLISHED` is `true`, with Pages turned on and "GitHub Actions" as its source.

### Keymap view

Each build also writes `<id>.view.json` next to the firmware: the keymap drawn on the board's real shape (from the keyboard's VIA definition), its layers, combos, `#define` aliases and the keycodes the keymap's code handles, with line numbers. The app shows it with "View keymap" (`V`). If it cannot be made, the manifest says why and the firmware is unaffected. Plan: [docs/plans/keymap-view.md](docs/plans/keymap-view.md). ZMK builds write the same view from the build's devicetree.

### Keymap editing

On the keymap, `E` starts editing. Select a key and give it a new action from the key picker (search by QMK name, by what it prints, or in English or Japanese words; or press the key on your computer, `K`), with a hold action if you like. Add and remove combos on the board, and add, remove and rename layers. Only the data parts of `keymap.c` change (the layer arrays, the combos, `KEYBALLER_SCROLL_LAYERS`); your own code stays as it was. Layer names and which layers scroll also go to `keyballer.json`. The first combo also turns combos on: `COMBO_ENABLE = yes` in `rules.mk` and `#define COMBO_ONLY_FROM_LAYER 0` in `config.h`. Every command is on the command line too (`assign KC_ESC`, `assign KC_A hold=ctrl`, `combo add`, `layer rename Mouse keys`, `save Fix the comma combo`). Saving works as below. Plan: [docs/plans/keymap-editor.md](docs/plans/keymap-editor.md).

ZMK keymaps are edited the same way, in the `.keymap` file the build used.
- **When.** Editing opens only when that file on `main` is the one the latest build was made from. Otherwise, wait for the build.
- **What changes.** Only the bindings, combos and layer nodes, with their `display-name`, change. A key already in the file is written as the file writes it; anything else gets ZMK's names.
- **What is refused.** Keys ZMK has no binding for, such as Keyball's own, are refused with a reason.
- **ZMK Studio.** If you have changed a keyboard's keymap in ZMK Studio, the keyboard keeps those changes over the file until you choose "Restore Stock Settings" in ZMK Studio.

Plan: [docs/plans/zmk.md](docs/plans/zmk.md), phase 4.

### LED settings

Press `L` on the keymap to set the LEDs:
- whether this board has LEDs;
- the effect at start-up, with its speed or direction;
- the colour and brightness, and whether the LEDs start on;
- which other effects the LED keys can switch between.

The panel estimates the firmware size from the latest build. Pro Micro boards have little room: on Keyball+, RGB Lighting takes about 2.4 KB and each effect more. The LED keys (on/off, next effect, hue, brightness…) are in the key picker's Lighting group. Settings saved here are applied after flashing, even if you changed them with the LED keys before, when the keymap has Keyballer's stamps block (am338 does). Plan: [docs/plans/led-settings.md](docs/plans/led-settings.md)

### Trackball settings and saving

Select the trackball on the keymap (`B`) to set cursor and scroll speed. Each is shown as the setting and as counts or scroll steps per centimetre of ball. A pad lets you try a speed with your own ball before flashing, and the sensor can be measured with one full turn of the ball. Changes collect in a bar with undo and redo (⌘Z / Ctrl+Z). "Review and save" (⌘S / Ctrl+S) shows each change and the file diff, then commits to `main` of the config repository, and the firmware build starts. Saving needs a fine-grained token (`github_pat_`) for that repository with Contents: Read and write. Keyballer keeps the token only while the tab is open, never in the browser's storage, and does not take classic tokens (`ghp_`), which reach every repository you can write to. Plans: [docs/plans/trackball-settings.md](docs/plans/trackball-settings.md), [docs/plans/keymap-editor.md](docs/plans/keymap-editor.md).

Design rules (colours, type, keycaps, words, accessibility, and what never to do) are in [DESIGN.md](DESIGN.md); `npm test` checks the colour contrast it requires.

All UI text is in `src/i18n/messages.ts`. English is the source; the type check fails if a Japanese string is missing, and a test fails if the two languages use different placeholders. The app opens in English unless `?lang=ja` or a saved choice says otherwise.

## Roadmap

1. ZMK builds and UF2 flashing
2. GitHub sign-in, LED settings, templates
3. AI-made keymap changes, reviewed in the same screen
