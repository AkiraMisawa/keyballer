# LED settings (Keyball, QMK)

Status: phase 1 being built (2026-11-22), at the owner's request. Shares saving (review, commit to `main`) with the keymap editor ([keymap-editor.md](keymap-editor.md)) and the trackball settings ([trackball-settings.md](trackball-settings.md)).

## Problem

Keyball+ has 58 LEDs, 29 a side; Keyball39 and Keyball44 can have them too. Whether a board has LEDs is up to whoever built it, and the owner has boards both with and without them. Today:

- **Off for every board.** LEDs are on or off per keymap (`RGBLIGHT_ENABLE` in `rules.mk`), and one keymap folder serves several boards. am338 serves Keyball+ and Keyball39, so its LEDs are off for both.
- **Settings are code.** `RGBLIGHT_DEFAULT_MODE`, hue, saturation and brightness are numbers in `config.h`. Nothing says which effects fit, or what each one costs.
- **Saved values win.** QMK keeps LED settings in EEPROM and reads its defaults only when EEPROM has none (`rgblight_init`: `if (!rgblight_config.mode)`, QMK 0.22.14). So after a board has once run firmware with LEDs, new defaults in `config.h` never apply.
- **Little room.** The flash is small. am338 on Keyball+ is 23,838 of 28,672 bytes, and every effect costs some of what is left.

## Solution

1. **LEDs per build.** Each build in `keyballer.json` says whether its board has LEDs: `"leds": true` or `false`. Without the field, the keymap's `rules.mk` decides, as today. The build passes the choice to QMK: `qmk compile -e RGBLIGHT_ENABLE=yes` or `=no`. qmk's `-e` becomes a make command-line variable (`lib/python/qmk/commands.py`, `create_make_target`), and that wins over the assignment in `rules.mk`. So one keymap folder serves a board with LEDs and one without. The manifest records `leds` for each build.
2. **An LED panel** in the keymap screen. It has:
   - whether this board has LEDs;
   - the effect at start-up, with its speed (and direction, where the effect has one);
   - the colour and brightness;
   - whether LEDs are on at start-up;
   - which other effects to include, for the effect keys to switch between;
   - an estimate of the firmware size.

   Saving writes `config.h` and `keyballer.json`, through the same review and commit as other edits.
3. **LED keys in the key picker**, in a "Lighting" group: on/off, next and previous effect, hue, saturation and brightness up and down, and a key for each effect. A key for an effect the firmware does not include does nothing. The picker says so.
4. **New defaults win after flashing.** A one-off block in the keymap's `keymap.c` does this (am338 gets it in keyballer-config):
   - It keeps a stamp of the LED defaults in the user EEPROM data block (`EECONFIG_USER_DATA_SIZE 4`). The trackball's stamp already uses the user EEPROM word, so the LEDs cannot share it. Separate stamps mean that changing an LED setting does not reset trackball speeds saved on the keyboard.
   - When a flashed build's stamp differs, it writes the new defaults to EEPROM (`eeconfig_update_rgblight_default`, then `rgblight_reload_from_eeprom`), turns the LEDs off when they should start off, and stores the stamp.
   - Changes made with the LED keys are then kept until the next build with different defaults.

## Implementation decisions

### What QMK 0.22.14 offers (RGB Lighting, `quantum/rgblight/`)

- **Defaults.** These are `RGBLIGHT_DEFAULT_MODE`, `_HUE`, `_SAT` and `_VAL`. `RGBLIGHT_DEFAULT_SPD` is stored but no RGB Lighting animation reads it.
- **Speed and direction.** An effect's speed, and its direction, is a choice of mode number. Breathing has 4 speeds. Rainbow mood and knight rider have 3. Rainbow swirl and snake have 3 speeds in 2 directions, and twinkle has 6 variants. So the default is written as `RGBLIGHT_MODE_BREATHING + 2` and the like.
- **Brightness.** Keyball limits it to `RGBLIGHT_LIMIT_VAL 150` (of 255) for power. The panel's brightness goes up to that limit and says why.
- **Effects.** Each effect is compiled in with its own `RGBLIGHT_EFFECT_*`: breathing, rainbow mood, rainbow swirl, snake, knight, christmas, static gradient, twinkle and alternating. `RGB_MOD` steps through the included ones.
- **On at start-up.** There is no default for it: `eeconfig_update_rgblight_default` always switches the LEDs on. The block in `keymap.c` turns them off after applying the defaults when `KEYBALLER_LEDS_OFF` is defined.

### Sizes (Keyball+, am338, built on Actions on 2026-11-22)

| Build | Bytes | Free of 28,672 |
|---|---|---|
| LEDs off (today) | 23,838 | 4,834 |
| LEDs on, static colour only | 26,282 | 2,390 |
| + breathing | 27,210 | 1,462 |
| + rainbow mood | 26,942 | 1,730 |
| + rainbow swirl | 26,994 | 1,678 |
| + snake | 27,138 | 1,534 |
| + knight | 27,124 | 1,548 |
| + christmas | 27,166 | 1,506 |
| + static gradient | 26,536 | 2,136 |
| + twinkle | 27,850 | 822 |
| + alternating | 26,926 | 1,746 |
| + layer colours (`RGBLIGHT_LAYERS`) | 26,738 | 1,934 |
| all nine effects | 29,462 | 790 too many |

The animated effects share about 595 bytes of code (every effect but static gradient). The panel's estimate is the static build, plus 595 when any animated effect is included, plus each effect's own cost:

| Effect | Own cost |
|---|---|
| breathing | 333 |
| rainbow mood | 65 |
| rainbow swirl | 117 |
| snake | 261 |
| knight | 247 |
| christmas | 289 |
| static gradient | 254 |
| twinkle | 973 |
| alternating | 49 |

This model gives the all-effects build within 3 bytes. It is an estimate: the build has the final word, and the panel says so. It works from the latest build's size, so the estimate follows the keymap as it grows.

### Writing

- **`keyballer.json`.** `builds[].leds`, a boolean, is checked by `build_qmk.py` like the other fields.
- **`config.h`, values.** `RGBLIGHT_DEFAULT_MODE`, `RGBLIGHT_DEFAULT_HUE`, `RGBLIGHT_DEFAULT_SAT`, `RGBLIGHT_DEFAULT_VAL` and `KEYBALLER_LEDS_OFF` are written with the same define editor as the trackball's.
- **`config.h`, effects.** These are `#define RGBLIGHT_EFFECT_*` lines. The start-up effect is always included.
- **The stamp.** It is computed in C from the defaults, so it changes whenever they do. `keymap.c` falls back to QMK's defaults for any value `config.h` leaves out.

## Order of work

1. **Build side** (this repository): `builds[].leds`, `-e RGBLIGHT_ENABLE`, `leds` in the manifest, and this plan.
2. **keyballer-config:**
   - the stamp block and `EECONFIG_USER_DATA_SIZE 4` in am338;
   - `"leds": true` for Keyball+, which has LEDs fitted. Keyball39 is left to the owner to choose in the app.
3. **App:**
   - the LED panel, with its command-line commands and a keyboard shortcut;
   - the "Lighting" group in the key picker;
   - the size estimate;
   - the `config.h` and `keyballer.json` writers.
4. **Later:** colours per layer (`RGBLIGHT_LAYERS`, 456 bytes plus the layer definitions), and indicators such as Caps Lock.

## Testing decisions

- **`build_qmk.py`:**
  - `leds` must be a boolean;
  - the compile command gets `-e RGBLIGHT_ENABLE=yes` or `=no`, or neither;
  - the manifest records it.
- **Session:** writing and reading the LED settings in `config.h` and `keyballer.json`, the review lines, and the size estimate, with the numbers in the table above.
- **A real build:** Keyball+ with LEDs and Keyball39 without, from one keymap folder, both within size.
- **On the board, once it is back:**
  - the start-up effect and colour;
  - LEDs off at start when chosen;
  - a new build's defaults winning over values saved with the LED keys;
  - values saved with the keys staying across an unplug.

## Out of scope

- RGB Matrix: Keyball's `rules.mk` says it does not work yet.
- ZMK underglow: roBa and meteorite40 have no LEDs.
- Colours per layer, until phase 4.
