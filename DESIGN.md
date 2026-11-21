# Keyballer design rules

These rules apply to every screen. If a rule gets in the way of something you need, change the rule here in the same pull request instead of working around it.

The reasoning and sources are in [docs/research/keymap-editor-design.md](docs/research/keymap-editor-design.md) (Japanese). Tokens live in [src/styles.css](src/styles.css), and [src/styles.test.ts](src/styles.test.ts) checks their contrast.

## 1. Principles

1. **The keyboard is the main thing on screen.** Draw the real board, with its column stagger, thumb cluster and trackball, and edit on that drawing. Main content never goes in a grid of cards.
2. **Choices come from the subject.** Keycaps, legends, the plate and the trackball supply the shapes, colours and words. If an element has no reason in the subject or the task, leave it out.
3. **One red.** Red is the trackball, and the trackball is how you point at things, so red also marks the selected key. Nothing else is red.
4. **State shows in form, not only in colour.** Every state has a shape, mark or word as well as a colour.
5. **Plain words in both languages.** English is the source. Japanese says the same thing in natural Japanese.
6. **Calm by default.** No motion, gradient or effect that does not carry information.
7. **Keyboard first.** People who use this app live on their keyboards. The usual path through any screen never needs the mouse.

## 2. Colour

### Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#eceef0` | `#24282c` | Page background, the "plate" |
| `--surface` | `#ffffff` | `#2d3237` | Panels |
| `--sunken` | `#f4f5f6` | `#1f2226` | Inputs, tracks, logs |
| `--cap` | `#fbfbfa` | `#3a4046` | Keycaps |
| `--line` | `#d3d8dc` | `#3d444b` | Separators and panel borders that are not needed to recognise anything |
| `--edge` | `#7f8a93` | `#848e97` | Borders of anything you click or type into, and keycaps |
| `--text` | `#1c2228` | `#e8ebee` | Text |
| `--muted` | `#56616a` | `#a9b3bb` | Secondary text |
| `--ink` / `--ink-text` | `#1c2228` / `#ffffff` | `#e8ebee` / `#24282c` | Primary buttons, progress, held keys |
| `--ball` | `#c63d2a` | `#e8705a` | The trackball, the selected key, the logo mark |
| `--focus` | `#2463c9` | `#7fa8ff` | Focus rings |
| `--ok` / `--ok-soft` | `#1a6e40` / `#dcf0e3` | `#7fd8a2` / `#1f3a2a` | Success |
| `--busy` / `--busy-soft` | `#7d5200` / `#f8ecd2` | `#f0bf6a` / `#3d3119` | In progress, unsaved |
| `--err` / `--err-soft` | `#ae2416` / `#fbe3df` | `#ff9b8c` / `#43231f` | Errors |
| `--scrim` | `#1c2228` | `#0b0d0f` | Behind modal dialogs, at 45% |

### Rules

- Neutrals are keycap greys with a slight cool tint. Dark mode is the grey of dark keycaps, not near-black.
- `--ball` is used for the trackball drawing, the selected key and the logo mark only. Buttons, links, headings, progress bars and panel borders are never red.
- The primary action uses `--ink`. Use one primary button per panel.
- `--ok`, `--busy` and `--err` are for status only, and always come with a word or symbol.
- Use `--edge` wherever the border is how you recognise a control or its state (WCAG 1.4.11). Use `--line` for everything else.
- Layers do not get colours. They are told apart by name and number.
- The contrast pairs below must hold in both themes. `npm test` fails if they do not.

| Pair | Minimum |
| --- | --- |
| `--text`, `--muted` on `--bg`, `--surface`, `--cap`, `--sunken` | 4.5:1 |
| `--ink-text` on `--ink` | 4.5:1 |
| `--ok` / `--busy` / `--err` on their soft colour; `--err` on `--bg` and `--surface` | 4.5:1 |
| `--edge`, `--ball`, `--focus` on `--bg`, `--surface` (and `--cap` for `--edge` and `--ball`) | 3:1 |

## 3. Type

- One family: the system UI stack with Japanese fallbacks (`"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif`). No web fonts and no display faces.
- Monospace is for things that are literally code or data: keycodes, file paths, commit SHAs and byte counts. Never use it for labels or decoration.
- Sizes: 0.8rem (badges, chips), 0.88rem (notes), 1rem = 15px (body), 1.05rem (panel headings), 1.6rem (page title). Weights: 400, 600, 700.
- No all-caps labels, no letter-spaced labels above headings, and no single word set in a different colour or style inside a heading.
- Japanese text uses full-width punctuation (「」（）、。：) and half-width digits and Latin letters. Sentences use です・ます. Buttons use the plain verb or noun (書き込む, 接続).
- Key names appear as they are printed on keycaps (Esc, Tab, 英数, かな), not as keycodes.

## 4. Layout

- Flow pages (connect, build, flash) are one column, at most 880px wide, with at least 16px of side gutter. Panels stack with a 20px gap.
- In the editor, the board gets the full width. The side panel (key picker, settings) sits beside the board from 1100px up and below it under that. The drawing scales down to a minimum key size of 36px. Below that it scrolls inside its own container, and the page itself never scrolls sideways.
- Spacing steps: 4, 8, 12, 16, 20, 24, 32px.
- Radius: 10px for panels, 8px for controls, and about 0.14u for keycaps. Only status badges and segmented switches are pill-shaped.
- A panel groups one task. Panels do not nest. Nothing has a drop shadow except a keycap's skirt.

## 5. Keycaps

The keycap is the core component and is drawn the same way everywhere.

- **Geometry** comes from the board's VIA definition (KLE: stagger, rotated thumb keys, ball position) or the ZMK physical layout. Never draw from QMK `info.json`, which is often a plain grid.
- **Legends** follow [keymap-drawer](https://github.com/caksoylar/keymap-drawer): the tap action in the centre, the hold action at the bottom, the shifted character at the top, and a layer target shown by the layer's name.
- **Raw keycode strings** such as `LT(1,KC_A)` never appear on a keycap. Show "A" with "Sym" as the hold action instead.

| State | Look |
| --- | --- |
| Default | `--cap` fill, 1px `--edge` border, and a 2px skirt in `--edge` along the bottom |
| Hover | Border turns `--text`. No scaling or zoom |
| Selected | 2px `--ball` ring and a `--ball` skirt |
| Held (the key you hold to reach this layer) | `--ink` fill with `--ink-text` legend |
| Transparent | A small ▽ plus the legend it falls through to, in `--muted` |
| No action (`KC_NO`) | "—" in `--muted`, so it is never confused with transparent |
| Changed, not saved | A `--busy` dot in the top-right corner, and the key appears in the diff |
| Behaviour set in code | A `--muted` corner notch. The legend explains it and links to the source lines |
| Combo | A line joins the trigger keys, with the output as a small chip between them |

- Legend text shrinks in three steps to fit. It is never cut off silently; long names use the abbreviations from the keycode table.
- The JIS/US and Mac/Windows display switch changes legends only, and the screen says so.

## 6. Trackball

- The trackball is a flat `--ball` circle, drawn at its real position and size relative to the keys. No gradient and no glow.
- The text inside says what it does on the current layer (Cursor, Scroll). It can be selected like a key.

## 7. Controls

- Button styles: primary (`--ink` fill), secondary (`--surface` with an `--edge` border), ghost (no border; for Close or Cancel in a panel header) and link.
- Inputs: `--sunken` fill, `--edge` border, 8px radius.
- Choosing between two or three options (language, OS display) uses a segmented switch.
- Click targets are at least 24×24px (WCAG 2.5.8), and keycaps at least 36px.
- Nothing works only by dragging. Every drag has a button alternative (WCAG 2.5.7).

## 8. Keyboard

### Rules

- **Focus moves on.** When an action finishes, focus goes to the action that usually comes next, so pressing Enter carries you through the flow. When a panel closes, focus returns to the control that opened it.
- **Every action is a command.** ⌘K / Ctrl+K anywhere, or `/` outside a text field, opens the command line. A command is English words, a verb and its object, followed by its values (`connect AkiraMisawa/keyballer-config`, `language japanese`), with Tab completion for both. The line also finds a command by its title in either language.
- **One declaration.** A command is declared once with `useCommand` ([src/commands](src/commands)): the command line, its single-key shortcut and its row in the `?` list all come from it, so they cannot disagree. A screen or panel offers its commands only while it is on screen, and the panel in front lists its own first.
- **Commands that cannot run now stay listed**, last, with the reason. Asking for one says why and changes nothing. A refused line stays open with what was typed. The list puts what this browser runs most first.
- **Single-key shortcuts** cover the frequent actions. They only fire when focus is not in a text field and no IME composition is in progress, and never together with ⌘, Ctrl or Alt, which belong to the browser and the OS.
- **Modifier shortcuts** are kept to the standard editing set: undo, redo, copy, paste and save. Show ⌘ on Mac and Ctrl elsewhere.
- **Esc** closes the topmost panel or goes back one step. It never throws away work without asking.
- **?** lists every shortcut on the current screen. The list is built from the registered shortcuts ([src/shortcuts.tsx](src/shortcuts.tsx)), so it is always accurate.
- A button that has a shortcut shows it as a small keycap and sets `aria-keyshortcuts`.
- A new shortcut is one letter, chosen as an English mnemonic (R for Refresh, P for Port, O for Open), and not already taken on that screen. Digits pick the nth item in a list.

### Flow pages (now)

| Key | Action |
| --- | --- |
| `/`, ⌘K / Ctrl+K | Open the command line |
| `R` | Refresh the build status |
| `1`–`9` | Flash the nth firmware |
| `O` | Flash a hex file from your computer |
| `P` | Choose the port (while waiting for the reset) |
| `Esc` | Close the panel or go back a step |
| `?` | Show the shortcuts |

Commands on the flow pages: `connect <repo>`, `repo` (go to the repository field), `refresh`, `open repo`, `open build`, `flash <id>`, `flash file`, `start`, `port`, `close`, `language <english|japanese>`, `shortcuts`.

### Keymap editor (planned)

| Key | Action |
| --- | --- |
| `←` `↑` `→` `↓` | Move to the nearest key in that direction on the drawing, following the stagger and the thumb rotation |
| `Enter` | Edit the selected key: the key picker opens with its search field focused |
| `/`, ⌘K / Ctrl+K | Open the command line, where every editor action is a command: `assign <keycode> [hold=]`, `layer <name>`, `combo add <keys> <output>`, `diff`, `commit [message]`, `undo`, `redo` |
| `K` | Press a key to assign: the next physical key you press is assigned (by `KeyboardEvent.code`; ignored during IME composition) |
| `Delete` / `Backspace` | Make the selected key transparent (▽) |
| `[` / `]` | Previous / next layer |
| `0`–`9` | Go to layer n |
| `A` | Show all layers side by side |
| `B` | Select the trackball |
| ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y | Undo / redo |
| ⌘C ⌘V / Ctrl+C Ctrl+V | Copy / paste the selected key |
| ⌘S / Ctrl+S | Review the changes and commit |
| `Esc` | Close the picker, then clear the selection |

Inside the key picker, typing searches, `↑` `↓` move through the results, `Tab` switches between the tap and hold actions, and `Enter` assigns the result and moves on to the next key, so a whole row can be filled without leaving the keyboard.

## 9. Motion

- Motion only shows a change of state: at most 150ms, ease-out. A progress bar may animate its width. Nothing animates on page load.
- No hover zoom, parallax, entrance animations or shimmering placeholders.
- With `prefers-reduced-motion`, transitions are off.

## 10. Words

- All text is in [src/i18n/messages.ts](src/i18n/messages.ts). English is the source, and Japanese must use the same placeholders.
- Buttons say what happens ("Flash", "Choose port"). Results confirm it ("Flashed.").
- Errors say what went wrong and what to do next. No apologies and no blame.
- No exclamation marks, emoji, "Let's", "Oops", or marketing words ("seamless", "effortless", "powerful").
- Call things what the user calls them: keyboard, half, reset button. Protocol names (CDC, AVR109) appear only in the detailed log.
- No trailing "→" on buttons or links, and no "A · B · C" separators used as decoration.

## 11. Accessibility

- Target WCAG 2.2 AA.
- Everything works from the keyboard. The board follows the WAI-ARIA layout grid pattern with a roving tabindex. Layer tabs follow the tabs pattern. Key search follows the combobox and listbox patterns.
- Focus is a 2px `--focus` ring with a 2px offset, and it is always visible.
- Flashing progress and build status are announced (`role="progressbar"`, `role="alert"` for failures).
- `<html lang>` follows the chosen language. Text in the other language (the language switch) carries its own `lang`.

## 12. Before and after building a screen

**Before:** In the pull request, list every state the screen can be in (empty, loading, error, unsupported browser, long names in both languages, 1 layer and 12 layers, and so on) and which tokens each state uses. Ask a generic AI prompt for the same screen and compare. Anything that looks the same needs a reason from the subject or the task.

**After:**

- [ ] Nothing from the "Never" list below
- [ ] `npm test` passes, including the contrast check
- [ ] Every action works with the keyboard alone, and the usual path needs only Enter, Esc and the shortcuts: focus lands on the next action at each step
- [ ] `?` lists every shortcut on the screen, and each button with a shortcut shows it
- [ ] Every action on the screen is also a command in the command line, declared with `useCommand`
- [ ] Checked against the WAI-ARIA patterns named above and WCAG 2.2 AA
- [ ] At 400px width and at 200% zoom, the page does not scroll sideways
- [ ] Both languages fit without overflow or clipping
- [ ] Dark mode checked
- [ ] Real data: open the owner's `am338` keymap and save without changes; the diff is empty
- [ ] Changes to flashing are tried on a real board

## 13. Never

- Gradients, glass or blur effects, glows
- Emoji, icon-only buttons
- All-caps labels, letter-spaced labels above headings, a single coloured word in a heading
- Monospace used for decoration
- Card grids for main content, nested panels, drop shadows (except the keycap skirt)
- Hover zoom, entrance animations
- Red anywhere except the trackball, the selected key and the logo
- A different colour for each layer
- Raw keycode strings on keycaps
- Actions that only work by dragging, or only with the mouse
- Single-letter shortcuts that fire while the user is typing in a field
- Web fonts for UI text
- A near-black background with a single bright accent
- Marketing copy, exclamation marks, trailing arrows
