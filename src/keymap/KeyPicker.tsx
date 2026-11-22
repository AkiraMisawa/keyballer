// The key picker: choose what a key does. Search first (combobox and listbox,
// DESIGN.md §11), modifiers sent with the key, a hold action, categories when
// the field is empty, and "press a key" to take the next key pressed on the
// computer. See docs/plans/keymap-editor.md, "Key picker".

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Kbd } from '../commands/keys';
import type { MessageKey } from '../i18n/messages';
import { useI18n } from '../i18n/react';
import { compose, decompose, keyFromCode, search, type Catalogue, type Category, type Hold, type TapHold } from './catalogue';
import { modsWord, type Mod } from './keycodes';
import { legendOf, type Display, type ViewFile } from './view';

const CATEGORY_LABEL: Record<Category, MessageKey> = {
  letters: 'picker.cat.letters',
  numbers: 'picker.cat.numbers',
  symbols: 'picker.cat.symbols',
  editing: 'picker.cat.editing',
  modifiers: 'picker.cat.modifiers',
  japanese: 'picker.cat.japanese',
  function: 'picker.cat.function',
  layers: 'picker.cat.layers',
  mouse: 'picker.cat.mouse',
  media: 'picker.cat.media',
  keyball: 'picker.cat.keyball',
  lighting: 'picker.cat.lighting',
  special: 'picker.cat.special',
  own: 'picker.cat.own',
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
const MODS: Mod[] = ['ctrl', 'shift', 'alt', 'gui'];
const SHOWN = 40;

/** What every picker needs to show keys: the keymap, how to write legends, and the keys on offer. */
export interface PickerContext {
  view: ViewFile;
  display: Display;
  catalogue: Catalogue;
  layerNames: string[];
}

interface Props {
  context: PickerContext;
  /** Which key is being edited; another key starts again from what that key does. */
  keyId: string;
  /** The key as it is now. */
  keycode: string;
  title?: string;
  /** Combo outputs take no hold action. */
  tapOnly?: boolean;
  /** Why a keycode cannot go here, if it cannot (a combo would break). */
  problem?: (keycode: string) => MessageKey | undefined;
  /** Whether K starts "press a key" here. */
  pressShortcut?: boolean;
  /** Requests from outside, as counters: a new number is a new request. */
  listenRequest: number;
  focusRequest: number;
  /** Focus the search field when the picker appears (the combo panel). */
  focusOnMount?: boolean;
  onAssign: (keycode: string) => void;
}

const sameList = (a: readonly Mod[] = [], b: readonly Mod[] = []) => a.length === b.length && a.every((m) => b.includes(m));
function sameHold(a: Hold | undefined | null, b: Hold | undefined | null): boolean {
  if (!a || !b) return !a && !b;
  if ('layer' in a || 'layer' in b) return 'layer' in a && 'layer' in b && a.layer === b.layer;
  return sameList(a.mods, b.mods) && !!a.right === !!b.right;
}

/** A request counter that has changed since the picker last acted on it; a remount starts even. */
function useRequest(value: number, act: () => void) {
  const handled = useRef(value);
  useEffect(() => {
    if (value === handled.current) return;
    handled.current = value;
    act();
    // Only when a new request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

export function KeyPicker(props: Props) {
  const { context, keyId, keycode, title, tapOnly, problem, pressShortcut, listenRequest, focusRequest, focusOnMount, onAssign } = props;
  const { view, display, catalogue, layerNames } = context;
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('letters');
  const [at, setAt] = useState(0);
  const [parts, setParts] = useState<TapHold>(() => decompose(keycode));
  const [listening, setListening] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  // Another key, or this key changed from outside (undo): start again from what it does.
  useEffect(() => {
    const next = decompose(keycode);
    setParts(tapOnly ? { tap: next.tap, withMods: next.withMods } : next);
    setAt(0);
  }, [keyId, keycode, tapOnly]);
  useRequest(focusRequest, () => field.current?.focus());
  useEffect(() => {
    if (focusOnMount) field.current?.focus();
    // Only when the picker appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useRequest(listenRequest, () => setListening(true));

  const results = useMemo(
    () => (query.trim() ? search(catalogue, query) : catalogue.entries.filter((e) => e.category === category)).slice(0, SHOWN),
    [catalogue, query, category],
  );

  /** The keycode for these parts; the key's own text when nothing changed (keeps aliases such as ALT_T). */
  const resultOf = (next: TapHold) => {
    const was = decompose(keycode);
    const same = next.tap === was.tap && sameList(next.withMods, was.withMods) && sameHold(next.hold, was.hold);
    return same ? ({ keycode } as const) : compose(next);
  };
  const result = resultOf(parts);
  const refusal: MessageKey | undefined = 'refused' in result ? result.refused : problem?.(result.keycode);

  const assign = (tap = parts.tap) => {
    const next = { ...parts, tap };
    const out = resultOf(next);
    setParts(next);
    if ('keycode' in out && !problem?.(out.keycode)) {
      setQuery('');
      onAssign(out.keycode);
    }
  };

  // Press to assign: the next key pressed, by its position (KeyboardEvent.code).
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setListening(false);
      if (e.key === 'Escape') return;
      const code = keyFromCode(e.code);
      if (code) assign(code);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // assign reads the latest parts through the re-created closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, parts]);

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (results.length) setAt((at + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = results[at];
      // A search that finds nothing assigns nothing.
      if (entry) assign(entry.code);
      else if (!query.trim()) assign();
    }
  };

  const legend = (code: string) => {
    const l = legendOf(view, code, display);
    return [l.top, l.tap].filter(Boolean).join(' ');
  };
  const optionId = (i: number) => `picker-option-${i}`;
  const toggle = (list: Mod[] = [], m: Mod) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]);
  const hold = parts.hold;

  return (
    <div className="stack picker">
      {title && <h3>{title}</h3>}
      <label htmlFor="picker-search">{t('picker.search')}</label>
      <input
        id="picker-search"
        ref={field}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls="picker-results"
        aria-activedescendant={results[at] ? optionId(at) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={t('picker.placeholder')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAt(0);
        }}
        onKeyDown={onFieldKey}
      />
      <ul id="picker-results" className="picker-results" role="listbox" aria-label={t('picker.results')}>
        {results.map((e, i) => (
          <li
            key={e.code}
            id={optionId(i)}
            role="option"
            aria-selected={i === at}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => assign(e.code)}
          >
            <span className="picker-legend">{legend(e.code)}</span>
            <code className="muted">{e.code}</code>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="note">{t('picker.none')}</p>}

      <fieldset className="stack">
        <legend>{t('picker.with')}</legend>
        <div className="row" role="group" aria-label={t('picker.with')}>
          {MODS.map((m) => (
            <button key={m} type="button" aria-pressed={!!parts.withMods?.includes(m)} onClick={() => setParts({ ...parts, withMods: toggle(parts.withMods, m) })}>
              {modsWord([m], display.os)}
            </button>
          ))}
        </div>
      </fieldset>

      {!tapOnly && (
        <fieldset className="stack">
          <legend>{t('picker.hold')}</legend>
          <div className="seg" role="group" aria-label={t('picker.hold')}>
            <button type="button" aria-pressed={!hold} onClick={() => setParts({ ...parts, hold: undefined })}>
              {t('picker.holdNone')}
            </button>
            <button
              type="button"
              aria-pressed={!!hold && 'mods' in hold}
              onClick={() => setParts({ ...parts, hold: hold && 'mods' in hold ? hold : { mods: ['ctrl'] } })}
            >
              {t('picker.holdMods')}
            </button>
            <button
              type="button"
              aria-pressed={!!hold && 'layer' in hold}
              onClick={() => setParts({ ...parts, hold: hold && 'layer' in hold ? hold : { layer: 1 } })}
            >
              {t('picker.holdLayer')}
            </button>
          </div>
          {hold && 'mods' in hold && (
            <div className="row" role="group" aria-label={t('picker.holdMods')}>
              {MODS.map((m) => (
                <button key={m} type="button" aria-pressed={hold.mods.includes(m)} onClick={() => setParts({ ...parts, hold: { ...hold, mods: toggle(hold.mods, m) } })}>
                  {modsWord([m], display.os)}
                </button>
              ))}
            </div>
          )}
          {hold && 'layer' in hold && (
            <select aria-label={t('picker.holdLayer')} value={hold.layer} onChange={(e) => setParts({ ...parts, hold: { layer: Number(e.target.value) } })}>
              {layerNames.map((name, n) => (
                <option key={n} value={n}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      )}

      <p className="note">
        {t('picker.result')} <code>{'keycode' in result ? result.keycode : parts.tap}</code>
      </p>
      {refusal && <p className="note">{t(refusal)}</p>}
      <div className="row">
        <button type="button" className="primary" disabled={!!refusal} onClick={() => assign()}>
          {t('picker.assign')}
        </button>
        <button type="button" aria-pressed={listening} onClick={() => setListening(!listening)} aria-keyshortcuts={pressShortcut ? 'K' : undefined}>
          {listening ? t('picker.listening') : t('picker.press')}
          {pressShortcut && <Kbd>K</Kbd>}
        </button>
      </div>

      {!query.trim() && (
        <div className="chips-row" role="group" aria-label={t('picker.categories')}>
          {CATEGORIES.filter((c) => catalogue.entries.some((e) => e.category === c)).map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {t(CATEGORY_LABEL[c])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
