# Trackball settings

Status: proposed (2026-11-22). Shares saving (review, commit to `main`) with the keymap editor ([keymap-editor.md](keymap-editor.md)).

## Problem

On a Keyball, cursor speed is the sensor's CPI and scroll speed is a divider. Both have defaults in `config.h` (`KEYBALL_CPI_DEFAULT 700`, `KEYBALL_SCROLL_DIV_DEFAULT 4`) and can be changed on the keyboard with `CPI_I100`, `SCRL_DVI` and friends, then kept with `KBC_SAVE`. The numbers say nothing about how it feels ("700 CPI", "divider 4"), I cannot try a value before flashing, and a value once saved on the keyboard quietly wins over a new default in `config.h` after flashing. Ball size (34 mm on Keyball+) matters when measuring what the sensor really reports.

## Solution

Selecting the trackball (`B`) shows its settings in the side panel; changing one starts the unsaved changes (there is no separate edit mode): cursor speed and scroll speed, each as the setting and as what it means in physical terms (counts per centimetre of ball surface; scroll steps per centimetre). A try-out pad lets me roll the ball and feel a new value before flashing. A calibration measures the sensor through one full turn of the ball, using the ball's diameter, and reports the real CPI. Saving goes through the same review and commit as keymap edits and writes the defaults to `config.h`. The firmware makes the new defaults win after flashing, while on-keyboard changes still work until the next flash that changes them.

## User stories

1. As a Keyball owner, I want to set cursor speed with a slider that also says how far the cursor moves per centimetre of ball movement, so that the number means something.
2. As a Keyball owner, I want to set scroll speed the same way (scroll steps per centimetre), so that I can tune scrolling without guessing powers of two.
3. As a Keyball owner, I want to try a new speed on a test pad by rolling my ball before I flash, so that I only flash values I like.
4. As a Keyball owner, I want to measure my sensor by rolling the ball one full turn, so that I know the real CPI, which can differ from the setting.
5. As a Keyball owner, I want the ball diameter to be part of my build's settings (34 mm by default), so that the measurement is right for my ball.
6. As a Keyball owner, I want new speeds to take effect after flashing even if I had saved a value on the keyboard, so that what I set on screen is what I get.
7. As a Keyball owner, I want on-keyboard speed changes (CPI keys, `KBC_SAVE`) to keep working until I flash different defaults, so that quick tweaks are still possible.
8. As a Keyball owner, I want the trackball changes in the same review and commit as keymap changes, so that saving works one way.
9. As a keyboard user, I want every setting reachable from the keyboard and the command line (`cursor speed <cpi>`, `scroll speed <divider>`, `ball size <mm>`, `try speed`, `measure sensor`), so that I do not need the mouse to set the mouse.

## Implementation decisions

### What the numbers mean

- **Cursor**: PMW3360 CPI from 100 to 12,000 in steps of 100 (Keyball stores CPI / 100 in one byte). Shown as counts per cm of ball surface: CPI ÷ 2.54. How many pixels a count becomes depends on the OS pointer speed and acceleration, which a web page cannot read, so the screen says so and the try-out pad is the way to feel it.
- **Scroll**: Keyball sends one scroll step per 2^(divider − 1) counts (divider 1–7, default 4 = every 8 counts). Shown as steps per cm: CPI ÷ 2.54 ÷ 2^(divider − 1). What one step scrolls depends on the OS setting.
- Both are shown in both languages, with the raw setting (CPI, divider) next to the physical figure.

### Try-out pad and calibration

- The pad uses the Pointer Lock API with `unadjustedMovement: true`, which gives the counts the Keyball sends, without OS acceleration (honoured by Chromium browsers; others may ignore the option, so they are treated as without it). Pointer lock is entered with a click or Enter and left with Esc.
- **Try-out**: a dot moves by the received counts scaled by new CPI ÷ current CPI. The current CPI is the build's default unless a measurement says otherwise. Scrolling is tried with the ball in cursor mode: the counts are turned into scroll steps at the new divider and counted on the pad. Wheel events from scroll mode are not used, because the OS has already scaled them. Without raw movement the try-out still works with the OS's acceleration in it, and says so.
- The files are read from the repository the first time the panel or a trackball command needs them, not every time a keymap opens.
- **Calibration**: "Mark the ball, then roll it one full turn along the arrow". Counts along the roll ÷ (π × diameter) give counts per mm, so the real CPI is counts per mm × 25.4. Three rolls are averaged; when they spread more than 15 % of the middle one, the roll farthest from it is asked again. The result is shown and becomes the "current CPI" the try-out compares with. It is not saved. Measuring needs raw movement; without it the panel says why.
- **Ball diameter**: `builds[].ball_mm` in `keyballer.json` (default 34). It is editable in the same panel.

### Making new defaults win after flashing

- am338 gets a small block in `keymap.c` (part of this change in keyballer-config). It keeps a stamp of the build's `KEYBALL_CPI_DEFAULT` and `KEYBALL_SCROLL_DIV_DEFAULT` in the user EEPROM area. When a flashed build's stamp differs, it clears Keyball's saved CPI and divider (so the defaults apply) and stores the new stamp. Otherwise Keyball's saved values are kept, so `KBC_SAVE` still works between flashes.
- Keymaps without that block still get the new `config.h`. The panel then says that a value saved on the keyboard wins until reset with `KBC_RST` and `KBC_SAVE`.

### Saving

- The settings write `#define KEYBALL_CPI_DEFAULT` and `#define KEYBALL_SCROLL_DIV_DEFAULT` in the keymap's `config.h` (changed in place, or added before the end if missing), and `ball_mm` in `keyballer.json`. They are part of the editor's review and commit (the config source module and the commit module of [keymap-editor.md](keymap-editor.md)).
- Keymaps shared by several builds (Keyball+ and Keyball39) share these settings, and the panel says so.

### Order of work

The trackball settings are the smallest thing that needs saving, so they come first and bring the shared pieces with them: the commit module, the review screen and the write-token handling. The keymap editor then adds key, combo and layer edits on top. GitHub sign-in follows as another way to get the same token.

## Testing decisions

1. **Speed figures** (pure): CPI and divider to counts per cm and steps per cm; calibration from counts and diameter to CPI, with the outlier rule. Expected values worked out by hand.
2. **Config source module** (pure, like the keymap source module): change or add the two defines in the real am338 `config.h` and in one without them; no edits gives identical text; `keyballer.json` `ball_mm`.
3. **Saving**: covered by the editor's commit module tests.
4. **Firmware stamp**: compiled for both boards and tried on the board (flash with a saved CPI, check that the new default applies; save a CPI on the keyboard, unplug, check that it stays).

The panel and the pad are checked in the browser with the Keyball, with screenshots in the pull request.

## Out of scope

- Auto mouse layer, scroll snap and other Keyball options (later, in the same panel).
- Pointer settings of the OS.
- LED settings (planned after this).
