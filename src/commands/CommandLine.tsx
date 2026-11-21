// The command line: ⌘K / Ctrl+K anywhere, or / when not typing. Follows the
// WAI-ARIA combobox pattern with a listbox. Ported from qube's CommandPalette.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { translate, type Localized } from '../i18n/core';
import { useI18n } from '../i18n/react';
import { Kbd, keyLabel } from './keys';
import {
  completionsOf,
  examples,
  execute,
  finish,
  listed,
  readLine,
  signature,
  take,
  type Command,
  type Completion,
  type Describe,
} from './model';
import { recordUse, usageScore } from './usage';

const NONE = -1;
const CAP = 40;

/** A command is found by its title in either language and its group, as well as its words. */
const describe: Describe = (c) =>
  [
    translate('en', c.title.key, c.title.params),
    translate('ja', c.title.key, c.title.params),
    translate('en', c.group),
    translate('ja', c.group),
  ].join(' ');

interface Props {
  open: boolean;
  commands: readonly Command[];
  onClose: () => void;
}

export function CommandLine({ open, commands, onClose }: Props) {
  const { t, show } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The dialog's close event arrives after .close() returns, so a close the code asked for is
  // remembered and not mistaken for the user closing the line.
  const closedByCode = useRef(false);
  const [text, setText] = useState('');
  const [at, setAt] = useState(NONE);
  const [problems, setProblems] = useState<Localized[]>([]);

  // A fresh, empty line each time it is opened.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setText('');
      setAt(NONE);
      setProblems([]);
      d.showModal();
      input.current?.focus();
    }
    if (!open && d.open) {
      closedByCode.current = true;
      d.close();
    }
  }, [open]);

  const reading = useMemo(() => readLine(text, commands), [text, commands]);
  const sections = useMemo(
    () => (reading.kind === 'choosing' ? listed(text, commands, usageScore, describe) : []),
    [reading, text, commands],
  );
  const listedCommands = sections.flatMap((s) => s.commands);
  const values = reading.kind === 'arguments' ? completionsOf(reading) : [];
  const all: readonly (Command | Completion)[] = reading.kind === 'choosing' ? listedCommands : values;
  const items = all.slice(0, CAP);
  const more = all.length - items.length;
  const chosen = at === NONE ? undefined : items[at];

  // Typing a query puts the best match first in line for Enter; the empty line chooses nothing.
  useEffect(() => {
    const q = text.trim();
    setAt(reading.kind === 'choosing' && q !== '' && q !== '?' && listedCommands.length > 0 ? 0 : NONE);
    // Only when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const change = (next: string) => {
    setText(next);
    setProblems([]);
  };

  /** Closes the line, then runs the command. A refusal opens the line again with what was typed. */
  const runClosing = (command: Command, args: Readonly<Record<string, string>>) => {
    closedByCode.current = true;
    dialog.current?.close();
    const reason = execute(command, args);
    if (reason) {
      dialog.current?.showModal();
      setProblems([reason]);
      input.current?.focus();
      return;
    }
    recordUse(command.id);
    onClose();
  };

  const takeItem = (item: Command | Completion) => {
    change(take(text, reading, item));
    input.current?.focus();
  };

  const choose = (command: Command) => {
    if (command.unavailable) {
      setProblems([command.unavailable]);
      return;
    }
    if ((command.args ?? []).some((a) => a.required)) takeItem(command);
    else runClosing(command, {});
  };

  const enter = () => {
    if (reading.kind === 'choosing') {
      if (chosen && 'words' in chosen) return choose(chosen);
      const q = text.trim();
      setProblems([q === '' || q === '?' ? { key: 'line.choose' } : { key: 'line.noMatch' }]);
      return;
    }
    if (reading.command.unavailable) {
      setProblems([reading.command.unavailable]);
      return;
    }
    // A value picked with the arrows is taken, and the line runs if that completes it.
    if (chosen && !('words' in chosen)) {
      const next = take(text, reading, chosen);
      const r = readLine(next, commands);
      if (r.kind === 'arguments' && r.slot === undefined) {
        const done = finish(r);
        if ('args' in done) return runClosing(r.command, done.args);
      }
      change(next);
      return;
    }
    const done = finish(reading);
    if ('problems' in done) setProblems([...done.problems]);
    else runClosing(reading.command, done.args);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // While an IME composes, its keys are its own: the Enter that commits a word runs nothing.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const emacs = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    const key = e.key.toLowerCase();
    const step =
      e.key === 'ArrowDown' || (emacs && key === 'n') ? 1 : e.key === 'ArrowUp' || (emacs && key === 'p') ? -1 : 0;
    if (step !== 0) {
      e.preventDefault();
      if (items.length > 0) {
        setAt(at === NONE ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (chosen) takeItem(chosen);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      enter();
    }
  };

  const optionId = (i: number) => `line-option-${i}`;
  const head =
    reading.kind === 'arguments' ? reading.command : chosen && 'words' in chosen ? chosen : undefined;
  const ex = examples(listed('', commands, usageScore));
  const placeholder =
    ex.length > 0 ? t('line.placeholder', { examples: ex.join(', ') }) : t('line.placeholderEmpty');

  const option = (item: Command | Completion, i: number) => (
    <div
      key={'words' in item ? item.id : `${item.value}:${item.detail ?? ''}`}
      id={optionId(i)}
      role="option"
      aria-selected={i === at}
      aria-disabled={'words' in item && item.unavailable ? true : undefined}
      className="line-option"
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => setAt(i)}
      onClick={() => ('words' in item ? choose(item) : takeItem(item))}
    >
      {'words' in item ? (
        <>
          <span className="line-words">
            <code>{item.words}</code>
            {signature(item) && <code className="muted"> {signature(item)}</code>}
          </span>
          <span className="line-title">
            {show(item.title)}
            {item.unavailable && <span className="note">{show(item.unavailable)}</span>}
          </span>
          {item.shortcut && <Kbd>{keyLabel(item.shortcut)}</Kbd>}
        </>
      ) : (
        <>
          <span className="line-words">
            <code>{item.value}</code>
          </span>
          <span className="line-title muted">{item.detail}</span>
        </>
      )}
    </div>
  );

  let index = 0;
  return (
    <dialog
      ref={dialog}
      className="line"
      aria-label={t('line.label')}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (closedByCode.current) closedByCode.current = false;
        else onClose();
      }}
    >
      <input
        ref={input}
        id="command-line"
        type="text"
        value={text}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={t('line.label')}
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls="line-options"
        aria-autocomplete="list"
        aria-activedescendant={chosen ? optionId(at) : undefined}
        autoComplete="off"
        spellCheck={false}
      />

      {head && (
        <p className="line-head">
          <code>
            {head.words} {signature(head)}
          </code>
          <span>{show(head.title)}</span>
          {reading.kind === 'arguments' && reading.slot?.hint && (
            <span className="muted">
              {reading.slot.name}: {show(reading.slot.hint)}
            </span>
          )}
        </p>
      )}

      {problems.length > 0 && (
        <div role="alert" className="err line-problems">
          {problems.map((p) => (
            <p key={`${p.key}:${JSON.stringify(p.params ?? {})}`}>{show(p)}</p>
          ))}
        </div>
      )}

      <div
        id="line-options"
        role="listbox"
        className="line-options"
        aria-label={
          reading.kind === 'choosing'
            ? t('line.commands')
            : t('line.values', { name: reading.slot?.name ?? '' })
        }
      >
        {reading.kind === 'arguments'
          ? items.map((item, i) => option(item, i))
          : sections.map((section) => {
              const start = index;
              const shown = section.commands.filter((_, j) => start + j < CAP);
              index += section.commands.length;
              if (shown.length === 0) return null;
              const headingId = `line-group-${start}`;
              return (
                <div key={section.heading ?? 'results'} role="group" aria-labelledby={section.heading ? headingId : undefined}>
                  {section.heading && (
                    <p id={headingId} className="line-heading">
                      {t(section.heading)}
                    </p>
                  )}
                  {shown.map((c, j) => option(c, start + j))}
                </div>
              );
            })}
      </div>

      {more > 0 && <p className="note">{t('line.more', { count: more })}</p>}
      <p className="note">{t('line.keys')}</p>
    </dialog>
  );
}
