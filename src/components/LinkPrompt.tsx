// Asking before opening a repository named in a link (?repo=): firmware from it would run on the
// keyboard, and anyone can make a link. The safe answer has focus; Esc gives it too.

import { useEffect, useRef, useState } from 'react';
import { Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';

const ARM_MS = 800;

interface Props {
  /** The linked repository, in canonical owner/repo form. */
  linked: string;
  /** The remembered repository, if any. */
  saved: string;
  onOpen: () => void;
  onKeep: () => void;
}

export function LinkPrompt({ linked, saved, onOpen, onKeep }: Props) {
  const { t } = useI18n();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  // Open works only after a moment, so a click meant for another window (double-click
  // hijacking) cannot land on it the instant the prompt appears.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  useCommand({
    id: 'repo.linkOpen',
    words: 'open link',
    title: msg('cmd.linkOpen', { repo: linked }),
    group: 'group.repo',
    unavailable: armed ? undefined : msg('why.linkArming'),
    run: onOpen,
  });
  useCommand({
    id: 'repo.linkKeep',
    words: 'keep repo',
    title: msg('cmd.linkKeep'),
    group: 'group.repo',
    shortcut: 'Escape',
    run: onKeep,
  });

  return (
    <div className="banner stack" role="region" aria-labelledby="link-repo-title">
      <p id="link-repo-title">{t('repo.linkAsk', { repo: linked })}</p>
      <p className="note">{t('repo.linkWhy')}</p>
      <div className="row">
        <button type="button" onClick={onOpen} disabled={!armed}>
          {t('repo.linkOpen', { repo: linked })}
        </button>
        <button type="button" ref={keep} onClick={onKeep} aria-keyshortcuts="Escape">
          {saved ? t('repo.linkKeep', { repo: saved }) : t('repo.linkIgnore')}
          <Kbd>Esc</Kbd>
        </button>
      </div>
    </div>
  );
}
