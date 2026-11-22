# Keymap editor

Status: built (2026-11-22). As built: combos are made by picking their keys on the board (`combo add`), then choosing the output; the review lists the changes in words rather than on a second board; layer actions are in the side panel when no key is selected. `save [message]` opens the review with that message, since saving always goes through the review. `ball mode cursor|scroll` (not `ball cursor|scroll`), because `ball` already selects the ball. Esc leaving edit mode keeps the unsaved changes; they stay on the board and in the bar until saved or discarded. A base-layer key that a combo uses cannot become transparent, empty or a key already on the base layer, because QMK finds combo keys by their keycode there. Builds on the keymap view ([keymap-view.md](keymap-view.md)); design research in [../research/keymap-editor-design.md](../research/keymap-editor-design.md).

## Problem

The keymap view shows my keymap on the board, but to change a key I still open `keymap.c`, find the right argument in a `LAYOUT_universal(...)` block, keep the columns lined up, push, and wait for the build. Combos are two places in the file (a key array and a `COMBO()` entry) that must agree with the base layer. Adding a layer means writing 42 `_______` by hand. A slip only shows up after flashing.

## Solution

The keymap screen gets an edit mode. I select a key on the drawing and give it a new action from a key picker (search first, Japanese names included), or press the key on my computer's keyboard. I add, change and remove combos on the drawing, and add, remove and rename layers. Every change shows on the board at once, with undo and redo. When I save, Keyballer shows what changes (on the board, and as a file diff), drafts a commit message, and commits to `main` of my config repository. The build starts, and the build status leads me to flashing.

Only the data parts of `keymap.c` are edited: the layer arrays, the combo arrays and the combo list, and one define for the scroll layers. Everything else, my own C code included, is left byte for byte as it was.

## User stories

1. As a Keyball owner, I want to select a key on the board and change what it does, so that I never edit C to move a key.
2. As a Keyball owner, I want to find a key by typing its name in English or Japanese (英数, かな, 変換, ¥, "left click", "volume"), so that I do not need to know QMK names.
3. As a Keyball owner, I want to browse keys by category (letters, symbols, modifiers, layers, mouse, media, Keyball, my own keys), so that I can find what I do not know the name of.
4. As a Keyball owner, I want to give a key a tap action and a hold action (a modifier or a layer), so that dual-function keys are easy to make.
5. As a Keyball owner, I want combinations QMK cannot build (a shifted symbol as the tap of a hold key) to be refused with the reason, so that I never save a keymap that does not compile or does not work.
6. As a keyboard user, I want to press a key on my computer's keyboard to assign it, so that typing a letter is faster than searching.
7. As a keyboard user, I want Enter to assign and move on to the next key, so that I can fill a row without the mouse.
8. As a Keyball owner, I want to make a key transparent or "no action" with one command, so that clearing keys is quick.
9. As a Keyball owner, I want to add a combo by selecting its keys on the board and choosing its output, so that combos are made where they are used.
10. As a Keyball owner, I want to change or remove a combo, so that I can tidy them up.
11. As a Keyball owner, I want combos to keep working when I change a base-layer key they use, so that combos behave by position, like on my ZMK boards.
12. As a Keyball owner, I want to add a layer, so that I can grow my keymap.
13. As a Keyball owner, I want to remove the last layer, and be told which keys still lead to it, so that I do not leave keys pointing nowhere.
14. As a Keyball owner, I want to rename a layer, so that names match how I think of them.
15. As a Keyball owner, I want to choose whether the ball moves the cursor or scrolls on each layer, so that ball layers are set where I see them.
16. As a Keyball owner, I want undo and redo for every change, so that I can try things.
17. As a Keyball owner, I want changed keys marked and an unsaved count shown, so that I know what I have not saved.
18. As a Keyball owner, I want to see every change before saving (old → new on the board, and the file diff), so that I know exactly what goes into the commit.
19. As a Keyball owner, I want a commit message drafted from the changes, which I can edit, so that history stays readable.
20. As a Keyball owner, I want saving to commit straight to `main`, so that the firmware build starts right away.
21. As a Keyball owner, I want Keyballer to refuse to save if the repository changed since I opened the keymap, and say how to continue, so that I never overwrite other work.
22. As a Keyball owner, I want my own C code and comments untouched, so that the GUI and hand-written code live together.
23. As a Keyball owner, I want keys whose behaviour is changed by code to stay marked while editing, so that I know the picture is not the whole story there.
24. As a Keyball owner, I want to be told when a keymap is shared by several builds (Keyball+ and Keyball39), so that I know a change affects both.
25. As a Keyball owner, I want leaving with unsaved changes to ask first, so that I do not lose work.
26. As a Keyball owner without a write token, I want to be told what token to make and where, so that I can save on the first try.
27. As a keyboard user, I want every edit to be a command (`assign`, `transparent`, `combo add`, `layer add`, `undo`, `review`, `save`), so that the command line reaches all of it.

## Implementation decisions

### What is edited, and where it comes from

- **Source of truth while editing**: the config repository's `main` at the moment the editor opens: `keymap.c` and `rules.mk` of the build's `keymap_dir`, and `keyballer.json`, read through the GitHub contents API together with the commit they come from (the base commit).
- **Geometry**: the build's latest view file (from the firmware branch), as in the keymap view. If the view's layout and `keymap.c`'s layout macro differ, the editor does not open and says why.
- **Layers and combos for editing** come from parsing `keymap.c` in the app, not from the view file, so that edits apply to the text that will be committed even when `main` is ahead of the last build.

### The keymap source module (main seam)

A pure module that reads `keymap.c` text and applies edits to it, changing as little text as possible:

- **Parse**: the `keymaps[]` array and each `[n] = LAYOUT_x(...)` entry, with the text span of every argument; `#define` aliases; the enum of custom keycodes; `const uint16_t PROGMEM name[] = {..., COMBO_END};` arrays and `COMBO(name, output)` entries in `key_combos[]`; the scroll layers define (below). Comments are skipped but kept.
- **Change a key**: replace that argument's text. Where the line is padded for column alignment, the padding after the argument is shortened or lengthened so that the next column still starts where it did; if it cannot, only that line is re-aligned.
- **Add a layer**: append `[n] = LAYOUT_x(...)` with `_______` in the same row shape and alignment as the last layer.
- **Remove a layer**: only the last one. The editor lists keys and combos that still lead to it and asks before removing. Layers in the middle are not removed (that would renumber layers that code may refer to).
- **Combos**: change the key list or output in place; add a new `combo_<n>` array after the last one and a `COMBO()` entry at the end of `key_combos[]`; remove both parts. When the keymap has no combos yet, a combo block is added after `keymaps[]` and `COMBO_ENABLE = yes` is set in `rules.mk`, and `COMBO_ONLY_FROM_LAYER 0` is set in `config.h` so combos match by position.
- **Combos follow base keys**: combo arrays name base-layer keycodes. When a base-layer key used by a combo changes, the combo's array is updated to the new keycode. A combo whose keys are not unique on the base layer is refused with the reason.
- **Scroll layers**: the trackball's scroll layers are written as one define, `#define KEYBALLER_SCROLL_LAYERS (1 << 3)`, used by `layer_state_set_user`. am338 is moved to this form in its own change first. Keymaps without the define show the ball mode as set in code and cannot change it.
- **Unchanged text stays byte for byte**: parsing and writing back with no edits gives the same file.

### keyballer.json

Layer names, the ball's mode words and custom keycode labels live in `views[keymap_dir]` (as for the keymap view). The editor updates them and writes the file back with the same two-space indentation.

### Editor state

A pure model holding the base documents (`keymap.c`, `rules.mk`, `config.h` if touched, `keyballer.json`), the list of edits, the selection and the undo and redo stacks. It answers what is drawn (the view model applied to the edited layers), which keys and combos changed, the review (old → new legends per layer, and per-file text), and a draft commit message (for example "Put Del on Symbol, add a combo for Esc").

### Key picker

- A search field with results below, following the combobox and listbox patterns. Search matches QMK names, legends, and English and Japanese words and aliases (a keycode catalogue built from the legend tables of the keymap view, plus the keymap's own custom keycodes and defines). Categories narrow the list when the field is empty.
- A tap and a hold part: hold is none, a modifier or modifiers (mod-tap), or a layer (layer-tap). Also layer functions (`MO`, `TG`, `TO`, `TT`, `OSL`, `DF`), shortcuts with modifiers (`C(KC_W)`), one-shot modifiers, transparent and no action.
- Combinations QMK refuses are disabled with the reason: a mod-tap or layer-tap whose tap is not a basic keycode (for example a shifted symbol), a layer-tap above layer 15.
- **Press to assign** (`K`): the next physical key pressed is assigned by `KeyboardEvent.code` (its position on a US keyboard); ignored during IME composition; modifiers alone assign the modifier.
- Enter assigns and moves the selection to the next key in reading order.

### Review and save

- **Review** (`review`, ⌘S / Ctrl+S): the board with changed keys marked old → new per layer, the combo changes, a unified diff per file, and the draft commit message in an editable field.
- **Save**: one commit with every changed file, made with the Git Data API (a tree on the base commit's tree with each file's text inline, a commit whose parent is the base commit, then a fast-forward update of `refs/heads/main`). A refused update that is not about the branch having moved (a protected branch) is reported as such. If `main` is no longer the base commit, nothing is written; the editor says so and offers to reload (keeping a copy of the edits to re-apply by hand).
- **Credentials**: the token already stored for private repositories, which now needs Contents: Read and write on the config repository. A missing or read-only token is explained in the review, with a link to make a fine-grained token for that one repository and a field to paste it there. GitHub sign-in is a later change (with the trackball work) that supplies the same kind of token.
- **After saving**: the bar says what was saved, links to the commit, and follows the build it started (the app looks for the run until GitHub lists it); the firmware list offers flashing when it finishes.
- **Leaving**: closing the keymap, the browser's Back button and opening another keymap all ask first when there are unsaved changes.

### Screen and keys

- Edit mode is entered with `E` (`edit`) on the keymap screen and left with `Esc`, which asks when there are unsaved changes.
- The side panel becomes the key picker for the selected key; combos and layers have their own panels.
- Keys (DESIGN.md §8, "Keymap editor"): arrows move, `Enter` opens the picker, `K` press-to-assign, `Delete` / `Backspace` make the key transparent, `[` `]` `0`–`9` `A` `B` as in the view, ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo, ⌘S / Ctrl+S review.
- Commands: `edit`, `assign <keycode> [hold=]`, `transparent`, `none`, `combo add`, `combo remove`, `layer add`, `layer remove`, `layer rename <name>`, `ball mode cursor|scroll`, `undo`, `redo`, `review`, `save [message]`, `discard`.

### Screen states and tokens

| State | What shows | Tokens |
| --- | --- | --- |
| Opening (reading the repository) | The view, with "Reading keymap.c" | `--muted` |
| Cannot edit (layout mismatch, unreadable `keymap.c`) | The reason; the view stays read-only | `--err` on `--err-soft` |
| Editing, no changes | Board, picker, "No changes" | as in the view |
| Changed key | A `--busy` dot in the top-right corner | `--busy` |
| Unsaved count | "3 changes" next to Review | `--busy` on `--busy-soft` |
| Review | Old → new per key, file diffs, message | `--ok` / `--err` for added / removed diff lines on their soft colours |
| Saving | Button busy, nothing else changes | `--muted` |
| Saved | "Saved as <sha>", link to the build | `--ok` on `--ok-soft` |
| Main moved | What happened and how to continue | `--err` on `--err-soft` |
| No write token | What token to make, steps | `--muted`, link in `--text` |
| Refused combination in the picker | Disabled with the reason | `--muted` |

## Testing decisions

Tests check what a user would see or what would be committed, from the outside of a module. Seams:

1. **Keymap source module**: input is `keymap.c` text (the real am338 file, plus small hand-written ones: no combos, unaligned columns); output is text. Tests: no edits gives identical text; changing one key changes one argument and keeps the columns; adding and removing the last layer; adding, changing and removing combos, including a keymap with no combos (and the `rules.mk` and `config.h` lines); a base key change carries into combo arrays; the scroll layers define. Expected text is written out by hand.
2. **Editor state**: edits, undo and redo, the changed-key marks, the review lists and the draft message, on the am338 view file and keymap.
3. **Key catalogue and picker rules**: search results for English, Japanese and QMK names; refused tap and hold combinations with their reasons; `KeyboardEvent.code` to keycode.
4. **Saving to GitHub**: the module that makes the commit, with `fetch` replaced at the boundary: the request sequence, the stale-base refusal, and readable errors for 401, 403 (read-only token), 404 and 409/422.

The screen itself is checked in the browser on the owner's keymap, with screenshots in the pull request. The last check is DESIGN.md §12's: open the am338 keymap, save without changes (nothing to commit), then rebuild am338 key by key from an empty keymap in the editor and compare the firmware.

## Out of scope

- Editing C code, macros, tap dance, key overrides, `config.h` other than the combo line, and `rules.mk` other than `COMBO_ENABLE`.
- Removing or reordering layers other than the last.
- ZMK keymaps, AI-made changes, GitHub sign-in (planned next to the trackball settings).
- Branches and pull requests for saving (saving goes to `main`).
