// An edit session: the files read from the config repository at one commit,
// the changes made on screen (with undo and redo), and what saving would
// commit. Pure: no React, no network. See docs/plans/keymap-editor.md ("Editor
// state") and docs/plans/trackball-settings.md.

import { readDefine, setBallMm, setDefine } from '../config/source';

export interface SessionBase {
  /** The commit the files were read from. */
  commit: string;
  buildId: string;
  keymapDir: string;
  /** File texts by path in the repository. */
  files: Record<string, string>;
}

/** The settings a session can change. */
export type Setting = 'cpi' | 'divider' | 'ballMm';

export interface Edit {
  type: Setting;
  value: number;
}

export interface Session {
  base: SessionBase;
  /** Changes in the order made; undo takes the last one off. */
  edits: Edit[];
  /** Changes undone, most recent last; a new change clears them. */
  undone: Edit[];
}

export type Trackball = Record<Setting, number>;

export interface Change {
  setting: Setting;
  from: number;
  to: number;
}

export interface FileChange {
  path: string;
  /** Unified diff with three lines of context. */
  diff: string;
}

export interface Review {
  changes: Change[];
  files: FileChange[];
  /** A draft commit message; empty when there is nothing to save. */
  message: string;
}

// keyball.h's defaults, and the ball Keyball ships with.
const KEYBALL_CPI_DEFAULT = 500;
const KEYBALL_SCROLL_DIV_DEFAULT = 4;
const KEYBALL_BALL_MM = 34;

const CPI = 'KEYBALL_CPI_DEFAULT';
const DIVIDER = 'KEYBALL_SCROLL_DIV_DEFAULT';
const CONFIG_JSON = 'keyballer.json';

const configPath = (base: SessionBase) => `${base.keymapDir}/config.h`;

export function openSession(base: SessionBase): Session {
  return { base, edits: [], undone: [] };
}

/** Adds a change. Moving the same setting again right away replaces it, so one drag is one undo step. */
export function apply(session: Session, edit: Edit): Session {
  const last = session.edits.at(-1);
  const edits = last?.type === edit.type ? [...session.edits.slice(0, -1), edit] : [...session.edits, edit];
  return { ...session, edits, undone: [] };
}

export function undo(session: Session): Session {
  const last = session.edits.at(-1);
  if (!last) return session;
  return { ...session, edits: session.edits.slice(0, -1), undone: [...session.undone, last] };
}

export function redo(session: Session): Session {
  const next = session.undone.at(-1);
  if (!next) return session;
  return { ...session, edits: [...session.edits, next], undone: session.undone.slice(0, -1) };
}

export const canUndo = (session: Session) => session.edits.length > 0;
export const canRedo = (session: Session) => session.undone.length > 0;

function readNumber(text: string | undefined, fallback: number): number {
  const n = Number.parseInt(text ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function buildOf(base: SessionBase, files: Record<string, string>): { ball_mm?: number } | undefined {
  const json = JSON.parse(files[CONFIG_JSON]) as { builds: { id: string; ball_mm?: number }[] };
  return json.builds.find((b) => b.id === base.buildId);
}

/** Where each setting lives, how it is read and written, and how a commit message says it changed. */
const SETTINGS: Record<
  Setting,
  {
    read: (base: SessionBase, files: Record<string, string>) => number;
    write: (base: SessionBase, files: Record<string, string>, value: number) => void;
    clause: (to: number, buildId: string) => string;
  }
> = {
  cpi: {
    read: (b, f) => readNumber(readDefine(f[configPath(b)] ?? '', CPI), KEYBALL_CPI_DEFAULT),
    write: (b, f, v) => void (f[configPath(b)] = setDefine(f[configPath(b)] ?? '', CPI, String(v))),
    clause: (to) => `the cursor speed to ${to} CPI`,
  },
  divider: {
    read: (b, f) => readNumber(readDefine(f[configPath(b)] ?? '', DIVIDER), KEYBALL_SCROLL_DIV_DEFAULT),
    write: (b, f, v) => void (f[configPath(b)] = setDefine(f[configPath(b)] ?? '', DIVIDER, String(v))),
    clause: (to) => `the scroll divider to ${to}`,
  },
  ballMm: {
    read: (b, f) => buildOf(b, f)?.ball_mm ?? KEYBALL_BALL_MM,
    write: (b, f, v) => void (f[CONFIG_JSON] = setBallMm(f[CONFIG_JSON], b.buildId, v)),
    clause: (to, buildId) => `the ball size of ${buildId} to ${to} mm`,
  },
};

export const SETTING_ORDER = Object.keys(SETTINGS) as Setting[];

function settingsOf(base: SessionBase, files: Record<string, string>): Trackball {
  return Object.fromEntries(SETTING_ORDER.map((k) => [k, SETTINGS[k].read(base, files)])) as Trackball;
}

/** The settings as they are in the files read from the repository. */
export function savedTrackball(session: Session): Trackball {
  return settingsOf(session.base, session.base.files);
}

/** The settings as the session stands now. */
export function trackball(session: Session): Trackball {
  const now = savedTrackball(session);
  for (const e of session.edits) now[e.type] = e.value;
  return now;
}

/** The files as they would be saved: only settings that differ from the saved ones are written. */
export function currentFiles(session: Session): Record<string, string> {
  const saved = savedTrackball(session);
  const now = trackball(session);
  const files = { ...session.base.files };
  for (const k of SETTING_ORDER) if (now[k] !== saved[k]) SETTINGS[k].write(session.base, files, now[k]);
  return files;
}

/** The same changes on newer files: for when the repository moved on before saving. */
export function rebase(session: Session, base: SessionBase): Session {
  return { base, edits: session.edits, undone: [] };
}

function draftMessage(changes: Change[], buildId: string): string {
  const parts = changes.map((c) => SETTINGS[c.setting].clause(c.to, buildId));
  if (parts.length === 0) return '';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `Set ${list}`;
}

export function review(session: Session): Review {
  const saved = savedTrackball(session);
  const now = trackball(session);
  const changes = SETTING_ORDER.filter((k) => now[k] !== saved[k])
    .map((k) => ({ setting: k, from: saved[k], to: now[k] }));
  const after = currentFiles(session);
  const files = Object.keys(after)
    .filter((path) => after[path] !== session.base.files[path])
    .map((path) => ({ path, diff: unifiedDiff(session.base.files[path] ?? '', after[path]) }));
  return { changes, files, message: draftMessage(changes, session.base.buildId) };
}

// ---- line diff ------------------------------------------------------------------

/** A unified diff of two texts, three lines of context, without file headers. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = before.split('\n');
  const b = after.split('\n');
  // Longest common subsequence table, from the end.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  type Line = { op: ' ' | '-' | '+'; text: string; ai: number; bi: number };
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    // Removed lines come before the lines that replace them.
    if (i < a.length && j < b.length && a[i] === b[j]) lines.push({ op: ' ', text: a[i++], ai: i, bi: ++j });
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) lines.push({ op: '-', text: a[i++], ai: i, bi: j });
    else lines.push({ op: '+', text: b[j++], ai: i, bi: j });
  }
  // Group changed lines with their context into hunks.
  const out: string[] = [];
  let k = 0;
  while (k < lines.length) {
    if (lines[k].op === ' ') {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    while (end < lines.length) {
      if (lines[end].op !== ' ') {
        end++;
        continue;
      }
      let run = end;
      while (run < lines.length && lines[run].op === ' ') run++;
      if (run === lines.length || run - end > context * 2) {
        end = Math.min(lines.length, end + context);
        break;
      }
      end = run;
    }
    const hunk = lines.slice(start, end);
    const oldStart = hunk.find((l) => l.op !== '+')?.ai ?? 0;
    const newStart = hunk.find((l) => l.op !== '-')?.bi ?? 0;
    const oldLines = hunk.filter((l) => l.op !== '+').length;
    const newLines = hunk.filter((l) => l.op !== '-').length;
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...hunk.map((l) => `${l.op}${l.text}`));
    k = end;
  }
  return out.join('\n');
}
