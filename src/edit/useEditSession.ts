// Loads an edit session from the config repository's main branch and saves it
// back as one commit. The session logic itself is in session.ts. Files are read
// the first time something needs them, not every time a keymap opens.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalizedError } from '../i18n/core';
import { commitFiles } from '../lib/commit';
import { getBranchHead, getTextAt, type RepoRef } from '../lib/github';
import {
  apply,
  canRedo,
  canUndo,
  currentFiles,
  openSession,
  rebase,
  redo,
  review,
  undo,
  type Edit,
  type Session,
  type SessionBase,
} from './session';

/** Saving and editing go to this branch (docs/plans/keymap-editor.md). */
export const BRANCH = 'main';

export interface Loaded {
  session: Session;
  /** keymap.c, read only for now: tells whether the firmware applies new defaults after flashing. */
  keymapC: string | null;
  /** Names of the builds that share this keymap folder (and so its config.h). */
  sharedBy: string[];
}

export type EditState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; error: unknown }
  | ({ status: 'ready' } & Loaded);

export interface Saved {
  sha: string;
  url: string;
}

interface ConfigJson {
  builds: { id: string; name: string; keymap_dir: string }[];
}

async function load(repo: RepoRef, token: string, buildId: string): Promise<{ base: SessionBase } & Omit<Loaded, 'session'>> {
  const commit = await getBranchHead(repo, BRANCH, token);
  const json = await getTextAt(repo, 'keyballer.json', commit, token);
  if (json === null) throw new LocalizedError('edit.err.noConfig');
  const config = JSON.parse(json) as ConfigJson;
  const build = config.builds.find((b) => b.id === buildId);
  if (!build) throw new LocalizedError('edit.err.noBuild', { id: buildId });
  const dir = build.keymap_dir.replace(/\/+$/, '');
  const [configH, keymapC] = await Promise.all([
    getTextAt(repo, `${dir}/config.h`, commit, token),
    getTextAt(repo, `${dir}/keymap.c`, commit, token),
  ]);
  const files: Record<string, string> = { 'keyballer.json': json };
  if (configH !== null) files[`${dir}/config.h`] = configH;
  return {
    base: { commit, buildId, keymapDir: dir, files },
    keymapC,
    sharedBy: config.builds.filter((b) => b.keymap_dir.replace(/\/+$/, '') === dir).map((b) => b.name),
  };
}

export function useEditSession(repo: RepoRef, token: string, buildId: string) {
  const [state, setState] = useState<EditState>({ status: 'idle' });
  const [saved, setSaved] = useState<Saved | null>(null);
  const [saving, setSaving] = useState(false);
  /** Changes asked for before the files were read; applied once they are. */
  const queued = useRef<Edit[]>([]);
  const generation = useRef(0);

  /** Reads the files; `keep` re-applies the current changes to them (main moved on). */
  const read = useCallback(
    (keep: Session | null) => {
      const mine = ++generation.current;
      setState({ status: 'loading' });
      load(repo, token, buildId)
        .then(({ base, ...rest }) => {
          if (mine !== generation.current) return;
          let session = keep ? rebase(keep, base) : openSession(base);
          for (const e of queued.current) session = apply(session, e);
          queued.current = [];
          setState({ status: 'ready', session, ...rest });
        })
        .catch((error: unknown) => mine === generation.current && setState({ status: 'failed', error }));
    },
    [repo, token, buildId],
  );

  // A new build or repository starts over.
  useEffect(() => () => void generation.current++, [repo, buildId]);

  /** Starts reading the files if nothing has yet. */
  const ensure = () => {
    if (state.status === 'idle') read(null);
  };

  const change = (f: (s: Session) => Session) => {
    if (saving) return;
    setSaved(null);
    setState((s) => (s.status === 'ready' ? { ...s, session: f(s.session) } : s));
  };

  const session = state.status === 'ready' ? state.session : null;
  const pending = session ? review(session) : null;

  /** Commits every changed file; afterwards the saved files are the new starting point. */
  const save = async (message: string): Promise<Saved | null> => {
    if (state.status !== 'ready' || !pending || pending.files.length === 0) return null;
    const started = state.session;
    const now = currentFiles(started);
    setSaving(true);
    try {
      const result = await commitFiles({
        repo,
        branch: BRANCH,
        base: started.base.commit,
        files: pending.files.map((f) => ({ path: f.path, content: now[f.path] })),
        message,
        token,
      });
      setState((s) =>
        s.status === 'ready' ? { ...s, session: openSession({ ...started.base, commit: result.sha, files: now }) } : s,
      );
      setSaved(result);
      return result;
    } finally {
      setSaving(false);
    }
  };

  return {
    state,
    session,
    pending,
    saved,
    saving,
    dirty: !!pending && pending.changes.length > 0,
    canUndo: !!session && canUndo(session),
    canRedo: !!session && canRedo(session),
    ensure,
    edit: (e: Edit) => {
      if (state.status === 'ready') change((s) => apply(s, e));
      else {
        queued.current.push(e);
        if (state.status !== 'loading') read(null);
      }
    },
    undo: () => change(undo),
    redo: () => change(redo),
    discard: () => change((s) => openSession(s.base)),
    save,
    /** Reads the files again; with `keepChanges`, the changes are put back on top of them. */
    reload: (keepChanges = false) => read(keepChanges ? session : null),
  };
}

export type EditSession = ReturnType<typeof useEditSession>;
