// Single-key shortcuts and the "?" help list. See DESIGN.md §8 (Keyboard).
//
// Components register shortcuts with useShortcut while they are on screen.
// The help dialog lists exactly what is registered, so it cannot drift from
// what the keys do. When two registrations share a key, the newest one (the
// most specific screen) wins.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Localized } from './i18n/core';
import { useI18n } from './i18n/react';

interface Shortcut {
  key: string;
  label: Localized;
  run: () => void;
}

interface Registry {
  register: (s: Shortcut) => () => void;
}

const Ctx = createContext<Registry | null>(null);

/** True while the user is typing into a field, where letters must stay letters. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(
      target.type,
    );
  }
  return false;
}

/** Whether a keydown should be handled as a shortcut at all. */
export function shouldHandle(
  e: Pick<KeyboardEvent, 'key' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented'>,
  typing: boolean,
  helpOpen: boolean,
): boolean {
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return false;
  // The help dialog is modal and handles its own keys (Esc closes it).
  if (helpOpen) return false;
  return e.key === 'Escape' || !typing;
}

export const keyLabel = (key: string) => (key === 'Escape' ? 'Esc' : key.length === 1 ? key.toUpperCase() : key);

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const list = useRef<Shortcut[]>([]);
  const [, setVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);
  helpOpenRef.current = helpOpen;

  const register = useCallback((s: Shortcut) => {
    list.current = [...list.current, s];
    setVersion((v) => v + 1);
    return () => {
      list.current = list.current.filter((x) => x !== s);
      setVersion((v) => v + 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandle(e, isTyping(e.target), helpOpenRef.current)) return;
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      const match = [...list.current].reverse().find((s) => s.key === e.key);
      if (match) {
        e.preventDefault();
        match.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ register }), [register]);

  // The newest registration per key, in the order keys were first registered.
  const active: Shortcut[] = [];
  for (const s of list.current) {
    const i = active.findIndex((x) => x.key === s.key);
    if (i >= 0) active[i] = s;
    else active.push(s);
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      <ShortcutHelp open={helpOpen} shortcuts={active} onClose={() => setHelpOpen(false)} />
    </Ctx.Provider>
  );
}

export function useShortcut(key: string, label: Localized, run: () => void, enabled = true): void {
  const registry = useContext(Ctx);
  const runRef = useRef(run);
  runRef.current = run;
  const labelKey = label.key;
  const labelParams = JSON.stringify(label.params ?? {});

  useEffect(() => {
    if (!registry || !enabled) return;
    return registry.register({
      key,
      label: { key: labelKey, params: JSON.parse(labelParams) },
      run: () => runRef.current(),
    });
  }, [registry, key, enabled, labelKey, labelParams]);
}

/** A key name drawn like a small keycap. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

function ShortcutHelp({
  open,
  shortcuts,
  onClose,
}: {
  open: boolean;
  shortcuts: Shortcut[];
  onClose: () => void;
}) {
  const { t, show } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const rows: { keys: string[]; label: string }[] = [
    ...shortcuts.map((s) => ({ keys: [keyLabel(s.key)], label: show(s.label) })),
    { keys: ['Tab', 'Shift+Tab'], label: t('shortcut.tab') },
    { keys: ['Enter'], label: t('shortcut.enter') },
    { keys: ['?'], label: t('shortcut.help') },
  ];

  return (
    <dialog ref={ref} className="help" aria-labelledby="help-title" onClose={onClose}>
      <div className="panel-head">
        <h2 id="help-title">{t('shortcut.title')}</h2>
        <button type="button" className="ghost" onClick={onClose} autoFocus>
          {t('common.close')}
        </button>
      </div>
      <dl className="shortcuts">
        {rows.map((r) => (
          <div key={r.keys.join() + r.label} className="shortcut-row">
            <dt>
              {r.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dt>
            <dd>{r.label}</dd>
          </div>
        ))}
      </dl>
      <p className="note">{t('shortcut.note')}</p>
    </dialog>
  );
}

