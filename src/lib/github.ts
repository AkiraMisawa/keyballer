// Read-only access to a config repository through the GitHub REST API.
// api.github.com allows cross-origin requests, so this runs in the browser.

import { LocalizedError } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';
import { isCommitSha, isPlainPath, parseManifest, type FirmwareManifest } from './manifest';
import { BRANCH, type CompareStatus, type ProvenanceRun, type RunArtifact } from './provenance';

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

/** The login of the account a token belongs to. */
export async function getLogin(token: string): Promise<string> {
  const res = await request('/user', token, 'application/vnd.github+json');
  const { login } = (await res.json()) as { login?: unknown };
  if (typeof login !== 'string' || !NAME.test(login)) throw new GitHubError('gh.err.status', res.status, { status: String(res.status) });
  return login;
}

/**
 * Whether a GitHub App user token reaches a repository: the app must be installed on it, for all of
 * the owner's repositories or for that one. (The first 100 installations and repositories.)
 */
export async function appReaches(r: RepoRef, token: string): Promise<boolean> {
  const accept = 'application/vnd.github+json';
  const res = await request('/user/installations?per_page=100', token, accept);
  const { installations = [] } = (await res.json()) as {
    installations?: { id?: unknown; account?: { login?: unknown } | null; repository_selection?: unknown }[];
  };
  for (const installation of installations) {
    const login = installation.account?.login;
    if (typeof login !== 'string' || login.toLowerCase() !== r.owner.toLowerCase()) continue;
    if (installation.repository_selection === 'all') return true;
    if (typeof installation.id !== 'number' || !Number.isSafeInteger(installation.id)) continue;
    const list = await request(`/user/installations/${installation.id}/repositories?per_page=100`, token, accept);
    const { repositories = [] } = (await list.json()) as { repositories?: { full_name?: unknown }[] };
    if (repositories.some((x) => typeof x.full_name === 'string' && x.full_name.toLowerCase() === repoName(r).toLowerCase())) return true;
  }
  return false;
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
/**
 * The config repository's latest builds of main. Only main's builds publish firmware (and only
 * they pass the provenance check), so a run on a side branch is never "the latest build".
 */
export async function getBuildRuns(r: RepoRef, token: string): Promise<WorkflowRun[]> {
  try {
    const res = await request(
      `${repoPath(r)}/actions/workflows/build.yml/runs?branch=${encodeURIComponent(BRANCH)}&per_page=5`,
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

/**
 * How `head` relates to `base` (both full SHAs): the compare API's `status` (`identical`, `behind`
 * when head is an ancestor of base, `ahead`, `diverged`) and how many commits apart. SHAs, not
 * branch names, so a tag named like the branch cannot stand in for it.
 */
export async function compareCommits(
  r: RepoRef,
  base: string,
  head: string,
  token: string,
): Promise<{ status: CompareStatus; behindBy: number; aheadBy: number; url: string }> {
  if (!isCommitSha(base) || !isCommitSha(head)) throw new LocalizedError('manifest.err.format');
  const res = await request(`${repoPath(r)}/compare/${base}...${head}`, token, 'application/vnd.github+json');
  const body = (await res.json()) as { status: CompareStatus; behind_by: number; ahead_by: number; html_url: string };
  return { status: body.status, behindBy: body.behind_by, aheadBy: body.ahead_by, url: body.html_url };
}

/** A workflow run of the connected repository, as provenance reads it. */
const assertRunId = (runId: number) => {
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new LocalizedError('manifest.err.format');
};

export async function getProvenanceRun(r: RepoRef, runId: number, token: string): Promise<ProvenanceRun> {
  assertRunId(runId);
  const res = await request(`${repoPath(r)}/actions/runs/${runId}`, token, 'application/vnd.github+json');
  return (await res.json()) as ProvenanceRun;
}

/** The run's artifacts with exactly this name. */
export async function getRunArtifacts(r: RepoRef, runId: number, name: string, token: string): Promise<RunArtifact[]> {
  assertRunId(runId);
  const res = await request(
    `${repoPath(r)}/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
    token,
    'application/vnd.github+json',
  );
  const body = (await res.json()) as { artifacts: RunArtifact[] };
  return body.artifacts;
}

/**
 * What a commit says. All of it is written by whoever made the commit (name, date, message), so it
 * helps a person recognise a change but proves nothing about who made it.
 */
export interface CommitInfo {
  sha: string;
  url: string;
  message: string;
  date: string;
}

export async function getCommitInfo(r: RepoRef, sha: string, token: string): Promise<CommitInfo> {
  if (!isCommitSha(sha)) throw new LocalizedError('manifest.err.format');
  const res = await request(`${repoPath(r)}/commits/${sha}`, token, 'application/vnd.github+json');
  const body = (await res.json()) as { sha: string; html_url: string; commit: { message: string; author: { date: string } } };
  return { sha: body.sha, url: body.html_url, message: body.commit.message, date: body.commit.author.date };
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
