// Registering commands, single-key shortcuts, and opening the command line and
// the "?" list. Components declare their commands with useCommand while they
// are on screen; when two share a shortcut or words, the newest (the panel in
// front) wins. See DESIGN.md §8.

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
import { CommandLine } from './CommandLine';
import { chordOf, isLineChord, isTyping, shouldHandle } from './keys';
import { execute, type Command } from './model';
import { ShortcutHelp } from './ShortcutHelp';
import { recordUse } from './usage';

interface Registry {
  register: (command: Command) => () => void;
  openLine: () => void;
  openHelp: () => void;
}

const Ctx = createContext<Registry | null>(null);

/** The newest registration per words, in the order words were first registered. */
function current(list: readonly Command[]): Command[] {
  const out: Command[] = [];
  for (const c of list) {
    const i = out.findIndex((x) => x.words === c.words);
    if (i >= 0) out[i] = c;
    else out.push(c);
  }
  return out;
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const list = useRef<Command[]>([]);
  const [, setVersion] = useState(0);
  const [lineOpen, setLineOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const modalOpen = useRef(false);
  modalOpen.current = lineOpen || helpOpen;

  const register = useCallback((command: Command) => {
    list.current = [...list.current, command];
    setVersion((v) => v + 1);
    return () => {
      list.current = list.current.filter((c) => c !== command);
      setVersion((v) => v + 1);
    };
  }, []);

  const openLine = useCallback(() => setLineOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  useEffect(() => {
    // The command line and the ? list, or a screen's own modal dialog (dialog.modal), in front.
    const inModal = () => modalOpen.current || document.querySelector('dialog.modal[open]') !== null;
    const onKey = (e: KeyboardEvent) => {
      if (isLineChord(e)) {
        e.preventDefault();
        if (!inModal()) setLineOpen(true);
        return;
      }
      const chord = chordOf(e);
      if (chord) {
        const match = [...list.current].reverse().find((c) => c.chords?.includes(chord));
        if (!match) return;
        // The browser's own use of the chord (Save page) never happens on a screen that has it.
        e.preventDefault();
        if (inModal() || isTyping(e.target)) return;
        if (execute(match, {}) === undefined) recordUse(match.id);
        return;
      }
      if (!shouldHandle(e, isTyping(e.target), inModal())) return;
      if (e.key === '/') {
        e.preventDefault();
        setLineOpen(true);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      const match = [...list.current].reverse().find((c) => c.shortcut === e.key);
      if (!match) return;
      e.preventDefault();
      if (execute(match, {}) === undefined) recordUse(match.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ register, openLine, openHelp }), [register, openLine, openHelp]);
  const commands = current(list.current);

  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandLine open={lineOpen} commands={commands} onClose={() => setLineOpen(false)} />
      <ShortcutHelp open={helpOpen} commands={commands} onClose={() => setHelpOpen(false)} />
    </Ctx.Provider>
  );
}

function useRegistry(): Registry {
  const registry = useContext(Ctx);
  if (!registry) throw new Error('Commands need a CommandProvider above them');
  return registry;
}

export function useCommandLine(): Pick<Registry, 'openLine' | 'openHelp'> {
  const { openLine, openHelp } = useRegistry();
  return { openLine, openHelp };
}

/**
 * Offers a command while the calling component is on screen. Its functions are always the latest
 * ones passed; it is registered again only when what the line shows changes.
 */
export function useCommand(command: Command): void {
  const { register } = useRegistry();
  const latest = useRef(command);
  latest.current = command;

  const shown = JSON.stringify({
    id: command.id,
    words: command.words,
    title: command.title,
    group: command.group,
    page: command.page,
    shortcut: command.shortcut,
    unavailable: command.unavailable,
    args: command.args?.map((a) => ({ name: a.name, required: a.required, hint: a.hint })),
  });

  useEffect(() => {
    const c = latest.current;
    return register({
      ...c,
      args: c.args?.map((a, i) => ({
        ...a,
        complete: a.complete && ((given) => latest.current.args?.[i]?.complete?.(given) ?? []),
        check: a.check && ((value, given) => latest.current.args?.[i]?.check?.(value, given)),
      })),
      run: (args) => latest.current.run(args),
    });
    // `shown` stands for every field the line draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, shown]);
}
