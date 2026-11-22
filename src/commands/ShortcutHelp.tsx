// The "?" list: every single-key shortcut of the commands on screen now, so it
// always matches what the keys do.

import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/react';
import { chordLabel, Kbd, keyLabel, lineChord } from './keys';
import type { Command } from './model';

interface Props {
  open: boolean;
  commands: readonly Command[];
  onClose: () => void;
}

export function ShortcutHelp({ open, commands, onClose }: Props) {
  const { t, show } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const rows = [
    { keys: ['/', lineChord()], label: t('shortcut.line'), muted: false },
    ...commands
      .filter((c) => c.shortcut || c.chords?.length)
      .map((c) => ({
        keys: [...(c.shortcut ? [keyLabel(c.shortcut)] : []), ...(c.chords ?? []).map((ch) => chordLabel(ch))],
        label: show(c.title),
        muted: !!c.unavailable,
      })),
    { keys: ['Tab', 'Shift+Tab'], label: t('shortcut.tab'), muted: false },
    { keys: ['Enter'], label: t('shortcut.enter'), muted: false },
    { keys: ['?'], label: t('shortcut.help'), muted: false },
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
          <div key={r.keys.join() + r.label} className={`shortcut-row${r.muted ? ' muted' : ''}`}>
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
