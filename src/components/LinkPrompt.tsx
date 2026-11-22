// Asking before opening a repository named in a link (?repo=): firmware from it would run on the
// keyboard, and anyone can make a link. The safe answer has focus; Esc gives it too.

import { useEffect, useRef } from 'react';
import { Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { msg } from '../i18n/core';
import { useI18n } from '../i18n/react';

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

  useCommand({
    id: 'repo.linkOpen',
    words: 'open link',
    title: msg('cmd.linkOpen', { repo: linked }),
    group: 'group.repo',
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
        <button type="button" onClick={onOpen}>
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
