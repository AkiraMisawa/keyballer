// Saving to the config repository: one commit on the branch with every changed
// file, made with the Git Data API, only if the branch is still at the commit
// the files were read from. See docs/plans/keymap-editor.md, "Review and save".

import { LocalizedError } from '../i18n/core';
import { GitHubError, githubFetch, statusError, type RepoRef } from './github';

export interface CommitRequest {
  repo: RepoRef;
  branch: string;
  /** The commit the files were read from; the branch must still point at it. */
  base: string;
  files: { path: string; content: string }[];
  message: string;
  token: string;
}

type Step = 'read' | 'write' | 'move';

async function call<T>(
  fetchFn: typeof fetch,
  req: CommitRequest,
  step: Step,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const { owner, repo } = req.repo;
  const res = await githubFetch(`/repos/${owner}/${repo}${path}`, { token: req.token, method, body, fetchFn });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 401 || res.status === 429 || res.headers.get('x-ratelimit-remaining') === '0') throw statusError(res);
  if (step === 'move' && (res.status === 409 || res.status === 422)) {
    // Not a fast-forward: someone else moved the branch between our check and our update. Anything
    // else is GitHub refusing the update itself, such as a protected branch.
    const reason = ((await res.json().catch(() => ({}))) as { message?: string }).message ?? '';
    if (res.status === 409 || /fast.?forward/i.test(reason)) throw new GitHubError('save.err.moved', res.status);
    throw new GitHubError('save.err.rejected', res.status, { branch: req.branch });
  }
  // A token that can read but not write gets 403 (404 when the token cannot see the repository
  // for writing at all).
  if (step !== 'read' && (res.status === 403 || res.status === 404)) throw new GitHubError('save.err.readOnly', res.status);
  throw statusError(res);
}

/** Makes the commit and moves the branch to it; returns the new commit. */
export async function commitFiles(req: CommitRequest, fetchFn: typeof fetch = fetch): Promise<{ sha: string; url: string }> {
  if (!req.token) throw new LocalizedError('save.err.noToken');
  const branch = encodeURIComponent(req.branch);

  const head = await call<{ object: { sha: string } }>(fetchFn, req, 'read', 'GET', `/git/ref/heads/${branch}`);
  if (head.object.sha !== req.base) throw new GitHubError('save.err.moved', 409);

  const base = await call<{ tree: { sha: string } }>(fetchFn, req, 'read', 'GET', `/git/commits/${req.base}`);
  const tree = await call<{ sha: string }>(fetchFn, req, 'write', 'POST', '/git/trees', {
    base_tree: base.tree.sha,
    tree: req.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const commit = await call<{ sha: string; html_url: string }>(fetchFn, req, 'write', 'POST', '/git/commits', {
    message: req.message,
    tree: tree.sha,
    parents: [req.base],
  });
  await call(fetchFn, req, 'move', 'PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  return { sha: commit.sha, url: commit.html_url };
}
