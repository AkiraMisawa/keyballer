// Read-only access to a config repository through the GitHub REST API.
// api.github.com allows cross-origin requests, so this runs in the browser.

import { LocalizedError } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';
import { isCommitSha, isPlainPath, parseManifest, type FirmwareManifest } from './manifest';
import type { CheckRun } from './provenance';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface WorkflowRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;
  head_sha: string;
  html_url: string;
  created_at: string;
  display_title: string;
}

export class GitHubError extends LocalizedError {
  constructor(
    key: MessageKey,
    readonly status: number,
    params?: Record<string, string | number>,
  ) {
    super(key, params);
  }
}

const NAME = /^[A-Za-z0-9_.-]+$/;

/** Accepts "owner/repo" or a github.com URL. */
export function parseRepo(input: string): RepoRef | null {
  const text = input.trim().replace(/\.git$/, '');
  const m = text.match(/^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s#?]+)/);
  if (!m || !NAME.test(m[1]) || !NAME.test(m[2])) return null;
  return { owner: m[1], repo: m[2] };
}

export const repoName = (r: RepoRef) => `${r.owner}/${r.repo}`;

interface FetchOptions {
  token: string;
  accept?: string;
  method?: string;
  body?: unknown;
  fetchFn?: typeof fetch;
}

/** A request to the GitHub REST API; the token is sent only when there is one. */
export function githubFetch(path: string, { token, accept, method = 'GET', body, fetchFn = fetch }: FetchOptions): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept ?? 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetchFn(`https://api.github.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

/** The error for a failed response, for the statuses every caller treats the same way. */
export function statusError(res: Response): GitHubError {
  if (res.status === 401) return new GitHubError('gh.err.badToken', 401);
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    return new GitHubError('gh.err.rateLimit', res.status);
  }
  if (res.status === 404) return new GitHubError('gh.err.notFound', 404);
  return new GitHubError('gh.err.status', res.status, { status: String(res.status) });
}

async function request(path: string, token: string, accept: string): Promise<Response> {
  const res = await githubFetch(path, { token, accept });
  if (res.ok) return res;
  throw statusError(res);
}

const repoPath = (r: RepoRef) => `/repos/${r.owner}/${r.repo}`;

export async function checkRepo(r: RepoRef, token: string): Promise<void> {
  try {
    await request(repoPath(r), token, 'application/vnd.github+json');
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) {
      throw new GitHubError('gh.err.repoNotFound', 404, { repo: repoName(r) });
    }
    throw e;
  }
}

/** Commit SHA at the head of the `firmware` branch, or null before the first build. */
export async function getFirmwareHead(r: RepoRef, token: string): Promise<string | null> {
  try {
    const res = await request(`${repoPath(r)}/branches/firmware`, token, 'application/vnd.github+json');
    const body = (await res.json()) as { commit: { sha: string } };
    return body.commit.sha;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

async function getRaw(r: RepoRef, path: string, ref: string, token: string): Promise<Response> {
  // Paths come from the config repository; one with `..` would reach other API paths with the token.
  if (!isPlainPath(path)) throw new LocalizedError('manifest.err.format');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return request(
    `${repoPath(r)}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
    token,
    'application/vnd.github.raw+json',
  );
}

export async function getManifest(r: RepoRef, ref: string, token: string): Promise<FirmwareManifest> {
  const res = await getRaw(r, 'manifest.json', ref, token);
  return parseManifest(await res.json());
}

export async function getFirmwareText(
  r: RepoRef,
  ref: string,
  file: string,
  token: string,
): Promise<string> {
  const res = await getRaw(r, file, ref, token);
  return res.text();
}

/** Recent runs of the config repo's build workflow (.github/workflows/build.yml). */
export async function getBuildRuns(r: RepoRef, token: string): Promise<WorkflowRun[]> {
  try {
    const res = await request(
      `${repoPath(r)}/actions/workflows/build.yml/runs?per_page=5`,
      token,
      'application/vnd.github+json',
    );
    const body = (await res.json()) as { workflow_runs: WorkflowRun[] };
    return body.workflow_runs;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return [];
    throw e;
  }
}

/** The commit a branch points at (the config repository's `main` when editing). */
export async function getBranchHead(r: RepoRef, branch: string, token: string): Promise<string> {
  const res = await request(
    `${repoPath(r)}/git/ref/heads/${encodeURIComponent(branch)}`,
    token,
    'application/vnd.github+json',
  );
  const body = (await res.json()) as { object: { sha: string } };
  return body.object.sha;
}

/** A file's exact bytes at a commit (the firmware branch), for digests. */
export async function getFirmwareBytes(r: RepoRef, ref: string, file: string, token: string): Promise<Uint8Array> {
  const res = await getRaw(r, file, ref, token);
  return new Uint8Array(await res.arrayBuffer());
}

/** The repository's default branch. */
export async function getDefaultBranch(r: RepoRef, token: string): Promise<string> {
  const res = await request(repoPath(r), token, 'application/vnd.github+json');
  const body = (await res.json()) as { default_branch: string };
  return body.default_branch;
}

/** Check runs with this name on a commit (all of them, not only the latest). */
export async function getCheckRuns(r: RepoRef, sha: string, name: string, token: string): Promise<CheckRun[]> {
  if (!isCommitSha(sha)) throw new LocalizedError('manifest.err.format');
  const res = await request(
    `${repoPath(r)}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`,
    token,
    'application/vnd.github+json',
  );
  const body = (await res.json()) as { check_runs: CheckRun[] };
  return body.check_runs;
}

/** Whether a commit is on a branch: the branch is the commit or comes after it. */
export async function isOnBranch(r: RepoRef, branch: string, sha: string, token: string): Promise<boolean> {
  if (!isCommitSha(sha)) throw new LocalizedError('manifest.err.format');
  const res = await request(
    `${repoPath(r)}/compare/${encodeURIComponent(branch)}...${sha}`,
    token,
    'application/vnd.github+json',
  );
  const body = (await res.json()) as { status: string };
  return body.status === 'identical' || body.status === 'behind';
}

/** Who made a commit, when, and what it says. */
export interface CommitInfo {
  sha: string;
  url: string;
  message: string;
  authorName: string;
  authorLogin: string | null;
  date: string;
}

export async function getCommitInfo(r: RepoRef, sha: string, token: string): Promise<CommitInfo> {
  if (!isCommitSha(sha)) throw new LocalizedError('manifest.err.format');
  const res = await request(`${repoPath(r)}/commits/${sha}`, token, 'application/vnd.github+json');
  const body = (await res.json()) as {
    sha: string;
    html_url: string;
    author: { login: string } | null;
    commit: { message: string; author: { name: string; date: string } };
  };
  return {
    sha: body.sha,
    url: body.html_url,
    message: body.commit.message,
    authorName: body.commit.author.name,
    authorLogin: body.author?.login ?? null,
    date: body.commit.author.date,
  };
}

/** A file's text at a commit, or null when the file is not there. */
export async function getTextAt(r: RepoRef, path: string, ref: string, token: string): Promise<string | null> {
  try {
    return await (await getRaw(r, path, ref, token)).text();
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}
