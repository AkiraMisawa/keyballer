// Loads an edit session from the config repository's main branch and saves it
// back as one commit. The session logic itself is in session.ts. Files are read
// the first time something needs them, not every time a keymap opens.

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalizedError } from '../i18n/core';
import { commitFiles } from '../lib/commit';
import type { ViewFile } from '../keymap/view';
import { getBranchHead, getBytesAt, getTextAt, type RepoRef } from '../lib/github';
import { sha256Hex } from '../lib/provenance';
import {
  apply,
  canRedo,
  canUndo,
  currentFiles,
  openSession,
  rebase,
  redo,
  review,
  savedBase,
  undo,
  type Edit,
  type Session,
  type SessionBase,
} from './session';
import { openZmk, zmkKeymapOf } from './zmk';

/** Saving and editing go to this branch (docs/plans/keymap-editor.md). */
export const BRANCH = 'main';

export interface Loaded {
  session: Session;
  /** Names of the builds that share this keymap folder (and so its files). */
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

/**
 * A ZMK keymap's files: keyballer.json and the .keymap file the build recorded, with what the
 * file means when it is the file built (docs/plans/zmk.md, phase 4). After a save the build is
 * behind, so a file that is still the one saved keeps the meaning it was saved with.
 */
async function loadZmk(repo: RepoRef, token: string, commit: string, json: string, config: ConfigJson, buildId: string, view: ViewFile, previous?: SessionBase) {
  const build = config.builds.find((b) => b.id === buildId);
  if (!build) throw new LocalizedError('edit.err.noBuild', { id: buildId });
  const files: Record<string, string> = { 'keyballer.json': json };
  const keymap = zmkKeymapOf(view);
  let zmk: SessionBase['zmk'] = { problem: 'edit.err.zmkNoSource' };
  if (keymap) {
    // Hashed as stored: a BOM or any byte that is not UTF-8 must not pass for the file built.
    const bytes = await getBytesAt(repo, keymap.path, commit, token);
    let text: string | undefined;
    try {
      text = bytes ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) : undefined;
    } catch {
      text = undefined;
    }
    const saved = previous?.zmk && 'base' in previous.zmk && previous.zmk.base.path === keymap.path ? previous.zmk : undefined;
    if (bytes && text === undefined) zmk = { problem: 'edit.err.zmkUnreadable' };
    else if (saved && text !== undefined && text === previous!.files[keymap.path]) zmk = saved;
    else zmk = openZmk(view, text, bytes ? await sha256Hex(bytes) : '');
    if (text !== undefined && 'base' in zmk) files[keymap.path] = text;
  }
  // Builds of one keyboard need not share a .keymap file (meteorite40 and its low-profile build do
  // not), and only a split keyboard's central half uses it, so no other build is named.
  return { base: { commit, buildId, keymapDir: '', files, zmk }, sharedBy: [build.name] };
}

/** A ZMK build: its view (null until loaded), which says what its .keymap file means. */
export interface ZmkSource {
  view: ViewFile | null;
}

async function load(repo: RepoRef, token: string, buildId: string, zmk: ZmkSource | null, previous?: SessionBase): Promise<{ base: SessionBase; sharedBy: string[] }> {
  if (zmk && !zmk.view) throw new LocalizedError('why.noView');
  const commit = await getBranchHead(repo, BRANCH, token);
  const json = await getTextAt(repo, 'keyballer.json', commit, token);
  if (json === null) throw new LocalizedError('edit.err.noConfig');
  const config = JSON.parse(json) as ConfigJson;
  if (zmk?.view) return loadZmk(repo, token, commit, json, config, buildId, zmk.view, previous);
  const build = config.builds.find((b) => b.id === buildId);
  if (!build) throw new LocalizedError('edit.err.noBuild', { id: buildId });
  const dir = build.keymap_dir.replace(/\/+$/, '');
  const names = ['config.h', 'keymap.c', 'rules.mk'];
  const texts = await Promise.all(names.map((n) => getTextAt(repo, `${dir}/${n}`, commit, token)));
  const files: Record<string, string> = { 'keyballer.json': json };
  names.forEach((n, i) => {
    const text = texts[i];
    if (text !== null) files[`${dir}/${n}`] = text;
  });
  return {
    base: { commit, buildId, keymapDir: dir, files },
    sharedBy: config.builds.filter((b) => b.keymap_dir.replace(/\/+$/, '') === dir).map((b) => b.name),
  };
}

/** `zmk` is set for a ZMK build; null for QMK. */
export function useEditSession(repo: RepoRef, token: string, buildId: string, zmk: ZmkSource | null = null) {
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
      load(repo, token, buildId, zmk, keep?.base)
        .then(({ base, ...rest }) => {
          if (mine !== generation.current) return;
          let session = keep ? rebase(keep, base) : openSession(base);
          for (const e of queued.current) session = apply(session, e);
          queued.current = [];
          setState({ status: 'ready', session, ...rest });
        })
        .catch((error: unknown) => mine === generation.current && setState({ status: 'failed', error }));
    },
    [repo, token, buildId, zmk],
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
      setState((s) => (s.status === 'ready' ? { ...s, session: openSession(savedBase(started, result.sha)) } : s));
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
    dirty: !!pending && pending.files.length > 0,
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
