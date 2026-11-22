// The bar that appears once something is changed: how many changes, undo and
// redo, discard, and review-and-save; then what became of the save. Also the
// review dialog and the confirmation dialogs. See docs/plans/keymap-editor.md,
// "Review and save".

import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { chordLabel, isMac, isTyping, Kbd } from '../commands/keys';
import { useCommand } from '../commands/react';
import { LocalizedError, msg, type Localized } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';
import { useI18n } from '../i18n/react';
import type { WorkflowRun } from '../lib/github';
import type { Change, Setting } from './session';
import { BRANCH, type EditSession } from './useEditSession';

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

interface BarProps {
  edit: EditSession;
  repoName: string;
  token: string;
  onToken: (token: string) => void;
  /** The build run for a commit, once GitHub lists it. */
  runFor: (sha: string) => WorkflowRun | undefined;
  /** After a save: watch for the build it started. */
  onSaved: (sha: string) => void;
}

const ariaChord = (chord: string) =>
  (isMac() ? 'Meta+' : 'Control+') + (chord.startsWith('shift+') ? `Shift+${chord.slice(6).toUpperCase()}` : chord.toUpperCase());

export function EditBar({ edit, repoName, token, onToken, runFor, onSaved }: BarProps) {
  const { t } = useI18n();
  const [reviewing, setReviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const savedLink = useRef<HTMLAnchorElement>(null);
  const count = edit.pending?.changes.length ?? 0;
  const noChanges: Localized | undefined = edit.dirty ? undefined : msg('why.noChanges');

  useCommand({
    id: 'edit.undo',
    words: 'undo',
    title: msg('cmd.undo'),
    group: 'group.edit',
    page: true,
    chords: ['z'],
    unavailable: edit.canUndo ? undefined : msg('why.nothingToUndo'),
    run: edit.undo,
  });
  useCommand({
    id: 'edit.redo',
    words: 'redo',
    title: msg('cmd.redo'),
    group: 'group.edit',
    page: true,
    chords: ['shift+z', 'y'],
    unavailable: edit.canRedo ? undefined : msg('why.nothingToRedo'),
    run: edit.redo,
  });
  useCommand({
    id: 'edit.review',
    words: 'review',
    title: msg('cmd.review'),
    group: 'group.edit',
    page: true,
    chords: ['s'],
    unavailable: noChanges,
    run: () => setReviewing(true),
  });
  useCommand({
    id: 'edit.discard',
    words: 'discard',
    title: msg('cmd.discard'),
    group: 'group.edit',
    page: true,
    unavailable: noChanges,
    run: () => setDiscarding(true),
  });
  useCommand({
    id: 'edit.reload',
    words: 'reload settings',
    title: msg('cmd.reloadSettings'),
    group: 'group.edit',
    page: true,
    unavailable: edit.saving ? msg('review.saving') : undefined,
    run: () => edit.reload(edit.dirty),
  });

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!edit.dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [edit.dirty]);

  // Focus moves on to what was saved.
  useEffect(() => {
    if (edit.saved) savedLink.current?.focus();
  }, [edit.saved]);

  const run = edit.saved ? runFor(edit.saved.sha) : undefined;
  const runText: MessageKey | null = !run
    ? null
    : run.status !== 'completed'
      ? 'edit.building'
      : run.conclusion === 'success'
        ? 'edit.built'
        : 'edit.buildFailed';

  const dialogs = (
    <>
      {reviewing && (
        <ReviewDialog
          edit={edit}
          repoName={repoName}
          token={token}
          onToken={onToken}
          onClose={() => setReviewing(false)}
          onSaved={(sha) => {
            setReviewing(false);
            onSaved(sha);
          }}
        />
      )}
      {discarding && (
        <ConfirmDialog
          title={t('discard.title')}
          body={t('discard.body')}
          confirm={t('edit.discard')}
          cancel={t('leave.keep')}
          onConfirm={() => {
            setDiscarding(false);
            edit.discard();
          }}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </>
  );

  if (!edit.dirty && !edit.saved) return dialogs;

  return (
    <div className="edit-bar" role="region" aria-label={t('group.edit')}>
      {edit.dirty ? (
        <>
          <span className="badge busy" role="status">
            {count === 1 ? t('edit.changesOne') : t('edit.changesMany', { n: count })}
          </span>
          <button type="button" onClick={edit.undo} disabled={!edit.canUndo} aria-keyshortcuts={ariaChord('z')}>
            {t('edit.undo')}
            <Kbd>{chordLabel('z')}</Kbd>
          </button>
          <button type="button" onClick={edit.redo} disabled={!edit.canRedo} aria-keyshortcuts={ariaChord('shift+z')}>
            {t('edit.redo')}
            <Kbd>{chordLabel('shift+z')}</Kbd>
          </button>
          <button type="button" className="ghost" onClick={() => setDiscarding(true)}>
            {t('edit.discard')}
          </button>
          <button type="button" className="primary" onClick={() => setReviewing(true)} aria-keyshortcuts={ariaChord('s')}>
            {t('edit.review')}
            <Kbd>{chordLabel('s')}</Kbd>
          </button>
        </>
      ) : (
        edit.saved && (
          <div className="stack" role="status">
            <p className="ok">
              {t('edit.saved', { sha: edit.saved.sha.slice(0, 7) })}{' '}
              <a ref={savedLink} href={edit.saved.url} target="_blank" rel="noreferrer">
                {t('edit.openCommit')}
              </a>
            </p>
            {run && runText && (
              <p className={run.conclusion && run.conclusion !== 'success' ? 'err' : 'note'}>
                {t(runText)}{' '}
                <a href={run.html_url} target="_blank" rel="noreferrer">
                  {t('edit.openBuild')}
                </a>
              </p>
            )}
          </div>
        )
      )}
      {dialogs}
    </div>
  );
}

/** A modal dialog that keeps the screen's shortcuts out while it is open (see commands/react.tsx). */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<Element | null>(null);
  useEffect(() => {
    returnTo.current = document.activeElement;
    ref.current?.showModal();
    // showModal focuses the first control; the dialog's main action goes first instead.
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (returnTo.current instanceof HTMLElement && returnTo.current.isConnected) returnTo.current.focus();
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (!isTyping(e.target) && !['Tab', 'Enter', ' '].includes(e.key) && !e.metaKey && !e.ctrlKey) {
      // The screen behind must not take letters, digits or arrows while the dialog is open.
      e.preventDefault();
    }
  };
  return (
    <dialog ref={ref} className="modal" aria-label={label} onKeyDown={onKeyDown} onCancel={(e) => e.preventDefault()}>
      {children}
    </dialog>
  );
}

const SETTING_LABEL: Record<Setting, MessageKey> = {
  cpi: 'setting.cpi',
  divider: 'setting.divider',
  ballMm: 'setting.ballMm',
};

/** Errors that the token field in the dialog answers. */
const TOKEN_ERRORS = new Set<MessageKey>(['save.err.readOnly', 'save.err.noToken', 'gh.err.badToken']);

interface ReviewProps {
  edit: EditSession;
  repoName: string;
  token: string;
  onToken: (token: string) => void;
  onClose: () => void;
  onSaved: (sha: string) => void;
}

function ReviewDialog({ edit, repoName, token, onToken, onClose, onSaved }: ReviewProps) {
  const { t, err } = useI18n();
  const [message, setMessage] = useState(edit.pending?.message ?? '');
  const [error, setError] = useState<unknown>(null);
  const pending = edit.pending;
  // While saving, the dialog stays: closing it could hide the result.
  const close = () => !edit.saving && onClose();
  if (!pending) return null;

  const value = (c: Change, v: number) =>
    c.setting === 'cpi' ? t('unit.cpi', { n: v }) : c.setting === 'ballMm' ? t('unit.mm', { n: v }) : String(v);
  const key = error instanceof LocalizedError ? error.key : null;
  const needsToken = !token || (key !== null && TOKEN_ERRORS.has(key));

  const save = async () => {
    setError(null);
    try {
      const result = await edit.save(message.trim() || pending.message);
      if (result) onSaved(result.sha);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Modal label={t('review.title')} onClose={close}>
      <div className="stack">
        <div className="panel-head">
          <h2>{t('review.title')}</h2>
          <button type="button" className="ghost" onClick={close} disabled={edit.saving}>
            {t('common.cancel')}
          </button>
        </div>
        <p className="note">{t('review.where', { branch: BRANCH, repo: repoName })}</p>

        <h3>{t('review.changes')}</h3>
        <dl className="facts">
          {pending.changes.map((c) => (
            <Fragment key={c.setting}>
              <dt>{t(SETTING_LABEL[c.setting])}</dt>
              <dd>{t('review.change', { from: value(c, c.from), to: value(c, c.to) })}</dd>
            </Fragment>
          ))}
        </dl>

        <h3>{t('review.files')}</h3>
        {pending.files.map((f) => (
          <div key={f.path} className="stack">
            <code>{f.path}</code>
            <pre className="diff">
              {f.diff.split('\n').map((line, i) => (
                <span key={i} className={line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : ''}>
                  {line}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        ))}

        <label htmlFor="commit-message">{t('review.message')}</label>
        <textarea id="commit-message" rows={2} value={message} disabled={edit.saving} onChange={(e) => setMessage(e.target.value)} />

        {error !== null && (
          <p className={needsToken ? 'note' : 'banner err'} role="alert">
            {err(error)}
          </p>
        )}
        {needsToken && (
          <div className="stack">
            <label htmlFor="review-token">{t('edit.tokenLabel')}</label>
            <input
              id="review-token"
              type="password"
              value={token}
              autoComplete="off"
              placeholder="github_pat_…"
              onChange={(e) => onToken(e.target.value.trim())}
            />
            <a href={TOKEN_PAGE} target="_blank" rel="noreferrer">
              {t('edit.tokenLink')}
            </a>
          </div>
        )}
        <div className="row">
          {key === 'save.err.moved' ? (
            <button
              type="button"
              className="primary"
              data-autofocus
              onClick={() => {
                edit.reload(true);
                onClose();
              }}
            >
              {t('edit.reloadKeep')}
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => void save()} disabled={edit.saving} data-autofocus>
              {edit.saving ? t('review.saving') : t('review.save')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface ConfirmProps {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before something that cannot be undone. The safe choice is focused. */
export function ConfirmDialog({ title, body, confirm, cancel, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal label={title} onClose={onCancel}>
      <div className="stack">
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="row">
          <button type="button" className="primary" onClick={onCancel} data-autofocus>
            {cancel}
          </button>
          <button type="button" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Asks before leaving with unsaved changes. */
export function LeaveDialog({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      title={t('leave.title')}
      body={t('leave.body')}
      confirm={t('leave.discard')}
      cancel={t('leave.keep')}
      onConfirm={onDiscard}
      onCancel={onKeep}
    />
  );
}
