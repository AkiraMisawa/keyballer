# Spec: Keymap view (read-only)

Status: draft for agreement, 2026-11-22. Background: [docs/research/keymap-editor-design.md](../research/keymap-editor-design.md) and [DESIGN.md](../../DESIGN.md).

## Problem Statement

My keymap lives in `keymap.c` in my config repository. To know what a key does on a layer, I read C: `LT(3, KC_K)`, `ALT_T(KC_Q)`, `TH_EISU`, arrays in `LAYOUT_universal` order that look nothing like the board. I cannot see my keymap on the shape of my Keyball, I cannot compare layers, and I cannot tell which keys behave differently because of code (Mac/Windows branches) without reading the whole file. Before Keyballer can edit keymaps, I need to see them correctly.

## Solution

Keyballer shows each firmware's keymap drawn on the real board: column stagger, rotated thumb keys and the trackball where it actually sits. I can switch layers, see all layers side by side, see tap and hold actions and combos the way keymap-drawer draws them, see where transparent keys fall through to, and see which keys have behaviour set in code, with a link to those lines on GitHub. Everything works from the keyboard and from the command line. The view is read-only; editing comes in a later spec.

The data is prepared when the firmware is built: the build already has QMK, the keyboard sources and the keymap, so it also writes one view file per build next to the firmware. The app only reads it.

## User Stories

1. As a Keyball owner, I want to open the keymap of a firmware from its card, so that I see exactly what I am about to flash.
2. As a Keyball owner, I want the board drawn with its real column stagger and rotated thumb keys, so that what I see matches the keyboard under my hands.
3. As a Keyball owner, I want the trackball drawn where it sits on my board (right, left, both or none), so that keys near it are where I expect.
4. As a Keyball owner, I want each key to show its tap action in the centre and its hold action at the bottom, so that dual-function keys read at a glance.
5. As a Keyball owner, I want keys that switch layers to name the layer, so that I know where they take me.
6. As a Keyball owner, I want layers to have names I choose (Base, Symbol, Number, Function), so that I do not think in numbers.
7. As a Keyball owner, I want to switch layers with tabs, `[` / `]` and digit keys, so that I can browse quickly.
8. As a Keyball owner, I want to see all layers side by side, so that I can compare where things are.
9. As a Keyball owner, I want a transparent key to show ▽ and, faintly, the key it falls through to, so that I know what actually happens.
10. As a Keyball owner, I want a key that does nothing to look different from a transparent key, so that I do not confuse the two.
11. As a Keyball owner, I want the keys I hold to reach the current layer marked, so that I see how I got there.
12. As a Keyball owner, I want combos drawn between their trigger keys with the output, so that I remember them.
13. As a Keyball owner, I want keys whose behaviour is changed by code (such as Q held = Cmd on Mac) marked, with a link to the lines in my repository, so that the picture never hides what the code does.
14. As a Keyball owner, I want the trackball to say what it does on the current layer (cursor, scroll), so that ball layers are visible too.
15. As a Mac and Windows user, I want to switch the legends between Mac and Windows names (⌘ / Win, ⌥ / Alt), so that the names match the computer I use, knowing only the display changes.
16. As a user of a Japanese or UK keyboard layout, I want to switch shifted-symbol legends between US, JIS and UK, so that `S(KC_2)` reads as the character I get, knowing only the display changes. (UK added during review: the owner's work PC defaults to the Windows UK layout.)
17. As a keyboard user, I want to move between keys with the arrow keys in the order they sit on the board, so that I can inspect keys without the mouse.
18. As a keyboard user, I want the selected key's details (tap, hold, the keycode as written, code notes) in a side panel, so that I can check exactly what is in the file.
19. As a keyboard user, I want commands such as `keymap keyballplus`, `layer symbol` and `layers all`, so that the command line reaches the view too.
20. As a Japanese-speaking user, I want every label and key name in Japanese or English, so that the view follows my language setting.
21. As a user of a firmware built before this feature, I want to be told to rebuild to see the keymap, so that I know why it is missing.
22. As a user whose keymap could not be read, I want the reason, so that I know the firmware itself is fine.
23. As a user on a narrow window, I want the board to scroll inside its frame instead of the page scrolling sideways, so that the page stays usable.
24. As a maintainer of another QMK keyboard with no VIA definition, I want the view to fall back to the QMK layout grid, so that it still works, plainly.

## Implementation Decisions

### Data produced at build time (one view file per build)

- The build script gains a view step that runs after a successful compile. It reads four inputs:
  - **Keymap**: QMK's `c2json` in no-preprocessor mode, which yields the layout macro name and every layer as keycode strings in layout order (verified on `am338`: 4 layers × 42 keys, custom names such as `TH_EISU` kept).
  - **Matrix positions**: QMK's keyboard info, which gives each layout index its matrix row and column and resolves layout aliases (`LAYOUT_universal` → `LAYOUT_no_ball`).
  - **Geometry**: the keyboard's VIA definition (KLE) when the keyboard sources have one; otherwise the QMK layout's x/y. KLE is resolved at build time into absolute key rectangles with rotation (x, y, w, h, r, rx, ry in key units), so the app does no KLE parsing.
  - **The keymap source** (`keymap.c`): read as text for three things `c2json` does not give: simple `#define NAME expression` aliases, combos (`const uint16_t PROGMEM name[] = {…, COMBO_END};` with `COMBO(name, output)`), and the keycodes handled by code (`case X:` labels inside the keymap's functions), each with its line numbers.
- **Joining**: layout index → matrix position → KLE key labelled `row,col`. VIA layout options (label position 3, `group,choice`) are applied with the build's chosen ball side; the KLE keys the chosen option drops are recorded as absent, and the ball is placed at the centre of the keys it replaces (diameter from the 34 mm ball at 19.05 mm per unit).
- **Combo positions**: combos are matched against layer 0, as `COMBO_ONLY_FROM_LAYER 0` does in `am338`; each combo records its trigger positions and output.
- **Output**: `<id>.view.json` next to `<id>.hex` on the firmware branch, and the manifest's build entry gains `view` (file name) or `view_error` (a reason). A view failure never fails the build or the flash flow.
- **View file shape** (schema 1): keyboard and keymap names, layout name, keys (index, matrix, rectangle, present), ball (position, diameter) or none, layers (name or none, keycode strings), ball modes per layer, combos, define aliases, custom labels, code-handled keycodes with line numbers, and the source repository, commit and path for links.

### Configuration (keyballer.json)

- Per build, optional `ball`: `none` / `right` / `left` / `dual`. Default `right` when the VIA definition has a ball option (Keyball's own default layout is the right-ball one).
- Per keymap directory, optional `views` entry, shared by every build using that directory:
  - `layers`: names in layer order.
  - `ball`: what the ball does per layer (`cursor`, `scroll`, or a short custom word), with a default.
  - `labels`: display names, in English and Japanese, for custom keycodes the app cannot know (`SCRSHOT_AREA`).
- For `am338`: layers `Base`, `Symbol`, `Number`, `Function`; ball `cursor`, layer 3 `scroll`; labels for `SCRSHOT_AREA` and `SCRSHOT_FULL`.

### App

- **Keymap view model** (a pure module, the main seam): given a view file, a layer, and display options (language, Mac/Windows, US/JIS/UK), it returns what to draw: for each present key its rectangle and legend parts (centre, top, bottom), its state (normal, modifier, layer key with target name, transparent with the resolved fall-through legend, no action, code-handled with lines, held-to-reach-this-layer), the ball with its mode text, and combos with positions and output legends. It also answers "which key is next in this direction" for arrow-key navigation, using key centres on the drawing.
- **Keycode legends** live inside that module: a dictionary for QMK basic keycodes, modifiers (`S()`, `C()`, `A()`, `G()`, `LCA()`, `LSG()` and friends), mod-taps (`ALT_T`, `CTL_T`, `SFT_T`, `RSFT_T`, `RCTL_T`, `LALT_T`, …), layer keys (`LT`, `MO`, `TG`, `TO`, `TT`, `OSL`, `DF`), one-shot mods, mouse keys, media keys, international keys (`KC_LNG1` = かな, `KC_LNG2` = 英数, `KC_INT1`–`KC_INT5`), Keyball keycodes (`CPI_I100`, `SCRL_DVI`, …), aliases resolved through the keymap's `#define`s, custom labels from configuration, and a readable fallback for anything unknown (its name in small type, never a crash, never raw nested syntax).
- **Screen**: a keymap section opened from a firmware card ("View keymap", shortcut `V`) or the command `keymap <id>`, addressable as `#keymap-<id>`. The board takes the full width; layer tabs above it; a side panel for the selected key from 1100 px up, below the board under that. Display switches (Mac/Windows, US/JIS/UK) are segmented controls and say "display only".
- **Commands** (declared with `useCommand`, so they are also shortcuts and appear in `?`): `keymap <id>`, `layer <name|n>`, `layers all` (`A`), `layer next` (`]`), `layer previous` (`[`), `0`–`9` to go to a layer, `ball` (`B`, select the trackball), arrow keys to move, `Esc` to clear the selection then close the view, `display mac|windows`, `display us|jis|uk`.
- **Data loading**: the view file is read from the firmware branch at the manifest's commit, like the firmware itself.

### Screen states and tokens (DESIGN.md §12)

| State | What shows | Tokens |
| --- | --- | --- |
| Loading the view file | The board frame with a short "Loading the keymap" line | `--muted` |
| No view in the manifest (built before this feature) | "Rebuild to see this keymap", with a link to the build workflow | `--muted`, link in `--text` |
| View failed at build time | The reason from the manifest, and that the firmware is unaffected | `--err` on `--err-soft` |
| Loaded | The board, layer tabs, side panel | below |
| Key: normal | Legend on a keycap | `--cap`, `--edge`, `--text` |
| Key: modifier | Same, modifier names | `--cap`, `--muted` for the hold line |
| Key: layer switch | Tap legend, layer name on the hold line | `--text`, `--muted` |
| Key: held to reach this layer | Filled keycap | `--ink`, `--ink-text` |
| Key: transparent | ▽ and the fall-through legend | `--muted` |
| Key: no action | "—" | `--muted` |
| Key: behaviour set in code | Corner notch; side panel names the lines | `--muted` notch |
| Key: selected | 2 px ring and skirt | `--ball` |
| Key: hover | Border to `--text`, no zoom | `--text` |
| Combo | Line between trigger keys, output chip | `--edge` line, chip `--surface` + `--edge` |
| Trackball | Flat circle with its mode | `--ball` fill; label colour per the note below |
| All layers | One small board per layer, names above | as above, smaller |
| One layer only, or up to 32 | Tabs wrap; all-layers grid fills rows | `--line` separators |
| Long names in either language | Legends shrink in three steps; never clipped silently | — |
| Unknown keycode | Its name in small type | `--muted` |
| No ball / dual ball | No circle / two circles | `--ball` |
| Narrow window | Board scrolls inside its frame | — |
| Light and dark | Same token roles | both themes |

The ball label colour must reach 4.5:1 on `--ball` in both themes; if it does not, the label goes below the circle in `--text` instead. This is checked when the tokens are added.

## Testing Decisions

Good tests here check what a user would see, from the outside of a module: given these inputs, this is drawn. They do not check private helpers or how a result is computed.

Two seams, both pure functions with fixtures from the real `am338` keymap and Keyball sources:

1. **View file generation (build side)**: inputs are `c2json` output, keyboard info, the VIA definition, `keymap.c` text and the view configuration; output is the view file. Tests check, for `am338` on Keyball+: every one of the 42 layout positions lands on the right KLE key (Q top-left, thumb keys rotated, `R31`–`R33` absent with the ball between them), the three combos with their positions, `TH_EISU` resolved to `LALT_T(KC_LNG2)`, the code-handled keycodes with their line numbers, layer names and ball modes from configuration, the fallback to the QMK grid when there is no VIA definition, and that a broken input produces a reason instead of an exception. Prior art: none in Python yet; these are the first tests for the build scripts, run in CI next to the app tests.
2. **Keymap view model (app side)**: input is a view file (the generated `am338` one, plus small hand-written ones for keycodes `am338` does not use); output is what to draw. Tests check legends (`ALT_T(KC_Q)` → Q / Alt, `LT(3, KC_K)` → K / Function, `S(KC_TAB)` → ⇧Tab, `KC_LNG2` → 英数, `C(KC_W)` → ⌃W on Mac display and Ctrl+W on Windows display, `S(KC_2)` → @ on US and " on JIS), transparent keys resolving to layer 0 through several layers, no-action keys, code-handled marks, held keys on layers 1–3, ball modes, combos, unknown keycodes, both languages, and arrow-key navigation on the staggered board (from `T`, right goes to `Y`; from `B`, down goes to the nearest thumb key). Prior art: the existing Vitest suites (`src/lib/caterina.test.ts`, `src/commands/model.test.ts`).

React components stay thin and are checked by hand against DESIGN.md §12's checklist, including a keyboard-only walk-through and both themes and languages.

## Out of Scope

- Editing keys, layers or combos, and saving (a separate spec; it will move layers to a data file).
- The AI assistant.
- ZMK keyboards (roBa, meteorite40) and their physical layouts.
- LED and trackball settings.
- Fetching VIA definitions from the-via/keyboards for keyboards whose sources lack one (they get the QMK grid for now).

## Further Notes

- `c2json` with the preprocessor fails on `am338`; the no-preprocessor mode works because the layer arrays are plain keycode lists. Keymaps that build their layers with macros will get `view_error` and a clear message.
- The VIA definition's ball option uses label position 3 (`0,0` none, `0,1` right, `0,2` left, dual has no keys there); verified on Keyball+.
- `keymap.c` is only read for display. Nothing here writes to the config repository.
