# Keyballer

English | [日本語](README.ja.md)

Keyballer builds keyboard firmware with GitHub Actions and flashes it straight from your browser.

**App:** https://akiramisawa.github.io/keyballer/ (English and Japanese; add `?lang=ja` to open it in Japanese)

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

## Status

| | Status |
| --- | --- |
| QMK builds | Supported, including keyboards defined outside qmk_firmware (for example Yowkees/keyball) |
| ZMK builds | Planned |
| Flashing Pro Micro (ATmega32U4 / Caterina) | Supported |
| Flashing RP2040 / nRF52840 (UF2) | Planned |
| Keymap editor | Planned |

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
      "keymap_dir": "keymaps/am338"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `qmk.version` | QMK tag to build with |
| `qmk.image` | (Optional) `ghcr.io/qmk/qmk_cli` image to build in. Defaults to one tested with QMK 0.22.14 |
| `sources[]` | Keyboard definitions that are not in qmk_firmware. `path` in `repo` at `ref` is used as QMK's `keyboards/<as>` |
| `builds[].id` | ID used for output file names (lowercase letters, digits, `-`, `_`) |
| `builds[].name` | Name shown in the app |
| `builds[].keyboard` / `keymap` | Passed to `qmk compile -kb <keyboard> -km <keymap>` |
| `builds[].keymap_dir` | Keymap folder in the config repository. Several builds can share one |

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

When a build succeeds, the `firmware` branch is replaced by a single commit holding `manifest.json` and the firmware files.

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
npm run dev     # dev server
npm test        # Vitest (flashing is tested against an in-memory bootloader)
npm run build   # type check and build
```

Pushing to `main` runs the tests and the build, then publishes to GitHub Pages.

Design rules (colours, type, keycaps, words, accessibility, and what never to do) are in [DESIGN.md](DESIGN.md); `npm test` checks the colour contrast it requires.

All UI text is in `src/i18n/messages.ts`. English is the source; the type check fails if a Japanese string is missing, and a test fails if the two languages use different placeholders. The app opens in English unless `?lang=ja` or a saved choice says otherwise.

## Roadmap

1. ZMK builds and UF2 flashing
2. Keymap editor (saving makes a commit)
3. Trackball settings in physical units with calibration, LED settings, GitHub sign-in, templates
