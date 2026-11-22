// Saving = one commit on main with every changed file. fetch is replaced at the
// boundary with a fake GitHub that records what it was asked.

import { describe, expect, it } from 'vitest';
import { LocalizedError } from '../i18n/core';
import { commitFiles, type CommitRequest } from './commit';

const BASE = 'base0000000000000000000000000000000000000';
const API = 'https://api.github.com/repos/akira/keyballer-config';

interface Call {
  method: string;
  url: string;
  body?: unknown;
  auth?: string;
}

/** A fake GitHub: each route answers with a status and JSON; every request is recorded. */
function fakeGitHub(routes: Record<string, [number, unknown]>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: headers.get('Authorization') ?? undefined,
    });
    const route = routes[`${method} ${String(url).replace(API, '')}`];
    if (!route) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(route[1]), { status: route[0] });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const request: CommitRequest = {
  repo: { owner: 'akira', repo: 'keyballer-config' },
  branch: 'main',
  base: BASE,
  files: [
    { path: 'keymaps/am338/config.h', content: '#define KEYBALL_CPI_DEFAULT 900\n' },
    { path: 'keyballer.json', content: '{}\n' },
  ],
  message: 'Set cursor speed to 900 CPI',
  token: 'github_pat_test',
};

const happy: Record<string, [number, unknown]> = {
  'GET /git/ref/heads/main': [200, { object: { sha: BASE } }],
  [`GET /git/commits/${BASE}`]: [200, { tree: { sha: 'tree-base' } }],
  'POST /git/trees': [201, { sha: 'tree-new' }],
  'POST /git/commits': [201, { sha: 'commit-new', html_url: 'https://github.com/akira/keyballer-config/commit/commit-new' }],
  'PATCH /git/refs/heads/main': [200, { object: { sha: 'commit-new' } }],
};

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof LocalizedError) return e.key;
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('saving to GitHub', () => {
  it('makes one commit with every file on the base commit and moves main to it', async () => {
    const gh = fakeGitHub(happy);
    const result = await commitFiles(request, gh.fetchFn);
    expect(result).toEqual({ sha: 'commit-new', url: 'https://github.com/akira/keyballer-config/commit/commit-new' });
    expect(gh.calls.map((c) => `${c.method} ${c.url.replace(API, '')}`)).toEqual([
      'GET /git/ref/heads/main',
      `GET /git/commits/${BASE}`,
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);
    expect(gh.calls[2].body).toEqual({
      base_tree: 'tree-base',
      tree: [
        { path: 'keymaps/am338/config.h', mode: '100644', type: 'blob', content: '#define KEYBALL_CPI_DEFAULT 900\n' },
        { path: 'keyballer.json', mode: '100644', type: 'blob', content: '{}\n' },
      ],
    });
    expect(gh.calls[3].body).toEqual({ message: 'Set cursor speed to 900 CPI', tree: 'tree-new', parents: [BASE] });
    expect(gh.calls[4].body).toEqual({ sha: 'commit-new', force: false });
    expect(gh.calls.every((c) => c.auth === 'Bearer github_pat_test')).toBe(true);
  });

  it('writes nothing when main has moved since the files were read', async () => {
    const gh = fakeGitHub({ ...happy, 'GET /git/ref/heads/main': [200, { object: { sha: 'someone-else' } }] });
    expect(await refusal(commitFiles(request, gh.fetchFn))).toBe('save.err.moved');
    expect(gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('says so when main moves while saving', async () => {
    const gh = fakeGitHub({ ...happy, 'PATCH /git/refs/heads/main': [422, { message: 'Update is not a fast forward' }] });
    expect(await refusal(commitFiles(request, gh.fetchFn))).toBe('save.err.moved');
    const conflict = fakeGitHub({ ...happy, 'PATCH /git/refs/heads/main': [409, { message: 'Conflict' }] });
    expect(await refusal(commitFiles(request, conflict.fetchFn))).toBe('save.err.moved');
  });

  it('passes on why GitHub refused to move a protected branch', async () => {
    const gh = fakeGitHub({ ...happy, 'PATCH /git/refs/heads/main': [422, { message: 'Protected branch update failed for refs/heads/main.' }] });
    expect(await refusal(commitFiles(request, gh.fetchFn))).toBe('save.err.rejected');
  });

  it('tells a token that cannot see the repository from one that cannot write to it', async () => {
    const hidden = fakeGitHub({ ...happy, 'GET /git/ref/heads/main': [404, { message: 'Not Found' }] });
    expect(await refusal(commitFiles(request, hidden.fetchFn))).toBe('gh.err.notFound');
    const readOnly = fakeGitHub({ ...happy, 'POST /git/commits': [404, { message: 'Not Found' }] });
    expect(await refusal(commitFiles(request, readOnly.fetchFn))).toBe('save.err.readOnly');
  });

  it('explains a token that cannot write', async () => {
    const gh = fakeGitHub({ ...happy, 'POST /git/trees': [403, { message: 'Resource not accessible by personal access token' }] });
    expect(await refusal(commitFiles(request, gh.fetchFn))).toBe('save.err.readOnly');
  });

  it('asks for a token when there is none', async () => {
    const gh = fakeGitHub(happy);
    expect(await refusal(commitFiles({ ...request, token: '' }, gh.fetchFn))).toBe('save.err.noToken');
    expect(gh.calls).toEqual([]);
  });

  it('explains a token GitHub rejects', async () => {
    const gh = fakeGitHub({ ...happy, 'GET /git/ref/heads/main': [401, { message: 'Bad credentials' }] });
    expect(await refusal(commitFiles(request, gh.fetchFn))).toBe('gh.err.badToken');
  });
});
