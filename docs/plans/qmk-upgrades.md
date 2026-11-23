# Checks for moving to another QMK version

Status: part 1 built (2026-11-23); parts 2 and 3 to come. Asked for by the owner: "バージョン上げても期待通り動くようにするためのテスト".

## Problem

Builds pin a QMK version (`qmk.version`, 0.22.14 today, the version Yowkees/keyball is verified with). Newer QMK renames keycodes and changes APIs. Moving builds to a newer version could therefore break things in four ways:
- the build itself;
- the keys Keyballer writes;
- the keymap view;
- what the keyboard does.

Today nothing would say so before a build failed, or before the keyboard misbehaved.

## Solution

1. **Key names (built).** `src/keymap/qmk-keys.json` lists every keycode name and keycode function that QMK's headers define at the pinned version, and Keyball's own keycodes.
   - `scripts/qmk_keys.py <tag> <keyball sha> <out>` writes the table, reading the headers from GitHub.
   - `src/keymap/qmkKeys.test.ts` checks that the table has every key the picker offers, and every key the picker builds (modifiers, mod-taps, layer-taps).
   - **Before moving:** write the table for the new version and run `npm test`.
2. **A trial build (next).** A workflow builds every config against a chosen QMK version without publishing. It reports:
   - whether each build passes, and its warnings;
   - its size against today's;
   - whether its keymap view still says the same.
3. **Behaviour tests (later).** QMK's host test framework (`tests/test_common`, present at 0.22.14 and 0.34.8) presses keys in software and checks what reaches the computer. It would cover:
   - am338's own behaviour: tap-hold, combos, Mac/Windows switching, UK mode and the scroll layers;
   - Keyball's functions, which get stand-ins.

   Running the same tests at both versions shows whether the keyboard still does the same.

What only the board can show stays a short manual checklist: the sensor, LEDs, OLED, the halves talking, and flashing.

## Found so far

Against QMK 0.34.8 (table written 2026-11-23), 22 keys the picker offers are gone from the headers keymaps include:
- the mouse keys: `KC_BTN1`–`KC_BTN5`, `KC_MS_*` and `KC_WH_*`. 0.34.8 names them `MS_BTN1` and so on, and am338 uses `KC_BTN1` and `KC_BTN2`;
- the RGB Lighting keys `RGB_TOG`, `RGB_MOD`, `RGB_RMOD` and `RGB_HUI` … `RGB_VAD`. 0.34.8 names them `UG_TOGG` and so on.

Moving to 0.34.8 needs those renamed in the app and in am338, besides whatever Keyball's own code needs.
