import { afterEach, describe, expect, it, vi } from 'vitest';
import { appReaches, getBuildRuns, getFirmwareText, getTextAt, GitHubError, parseRepo, statusError } from './github';

describe('parseRepo', () => {
  it('accepts owner/repo', () => {
    expect(parseRepo('AkiraMisawa/keyballer-config')).toEqual({
      owner: 'AkiraMisawa',
      repo: 'keyballer-config',
    });
  });

  it('accepts GitHub URLs', () => {
    expect(parseRepo('https://github.com/AkiraMisawa/keyballer-config.git')).toEqual({
      owner: 'AkiraMisawa',
      repo: 'keyballer-config',
    });
    expect(parseRepo('https://github.com/a/b/tree/main')).toEqual({ owner: 'a', repo: 'b' });
  });

  it('rejects anything else', () => {
    expect(parseRepo('keyballer-config')).toBeNull();
    expect(parseRepo('a b/c')).toBeNull();
    // Names of only dots would make URLs that leave the repository's place.
    expect(parseRepo('../evil')).toBeNull();
    expect(parseRepo('a/..')).toBeNull();
    expect(parseRepo('a/.')).toBeNull();
  });
});

describe('reading files from the firmware branch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a path that would leave the contents folder, before any request', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', fetchSpy);
    const ref = { owner: 'a', repo: 'b' };
    await expect(getFirmwareText(ref, 'abc', '../../../../user/installations', '')).rejects.toThrow();
    await expect(getFirmwareText(ref, 'abc', 'a/%2e%2e/b', '')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    await getFirmwareText(ref, 'abc', 'keyball39.hex', '');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('appReaches', () => {
  afterEach(() => vi.unstubAllGlobals());
  const REPO = { owner: 'Me', repo: 'config' };

  /** GitHub's answers for /user/installations and each installation's repositories. */
  function stub(installations: unknown[], repositories: Record<number, string[]> = {}) {
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = new URL(url);
        asked.push(u.pathname);
        if (u.pathname === '/user/installations') return Response.json({ total_count: installations.length, installations });
        const id = Number(u.pathname.match(/^\/user\/installations\/(\d+)\/repositories$/)?.[1]);
        return Response.json({ repositories: (repositories[id] ?? []).map((full_name) => ({ full_name })) });
      }),
    );
    return asked;
  }

  it('finds the repository among the ones an installation was given', async () => {
    stub([{ id: 7, account: { login: 'me' }, repository_selection: 'selected' }], { 7: ['me/other', 'me/Config'] });
    expect(await appReaches(REPO, 'ghu_x')).toBe(true);
  });

  it('counts an installation on all of the owner’s repositories without listing them', async () => {
    const asked = stub([{ id: 7, account: { login: 'ME' }, repository_selection: 'all' }]);
    expect(await appReaches(REPO, 'ghu_x')).toBe(true);
    expect(asked).toEqual(['/user/installations']);
  });

  it('is false before the app is installed, or when it is installed elsewhere', async () => {
    stub([]);
    expect(await appReaches(REPO, 'ghu_x')).toBe(false);
    stub([{ id: 8, account: { login: 'someone' }, repository_selection: 'all' }, { id: 7, account: { login: 'me' }, repository_selection: 'selected' }], { 7: ['me/other'] });
    expect(await appReaches(REPO, 'ghu_x')).toBe(false);
  });
});

describe('build runs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists runs of main only, since only they publish firmware', async () => {
    // A run dispatched on a side branch builds but never publishes, so it is not "the latest build".
    const fetchSpy = vi.fn(async (_url: string) => Response.json({ workflow_runs: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    await getBuildRuns({ owner: 'a', repo: 'b' }, '');
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.pathname).toBe('/repos/a/b/actions/workflows/build.yml/runs');
    expect(url.searchParams.get('branch')).toBe('main');
  });
});

describe('reading files at a commit without a token', () => {
  // raw.githubusercontent.com serves a public repository's files outside the API's 60 requests an
  // hour; what a commit names never changes, so it can be kept in the browser's cache.
  afterEach(() => vi.unstubAllGlobals());
  const repo = { owner: 'AkiraMisawa', repo: 'keyballer-config' };
  const SHA = '05a21d7c0ffee0000000000000000000000000ab';
  const CONFIG = '#pragma once\n';
  // git hash-object of "#pragma once\n".
  const CONFIG_BLOB = '6f70f09beec2219624baeca92e2cd7deaa104fb4';
  const tree = (entries: Record<string, string>) =>
    Response.json({ truncated: false, tree: Object.entries(entries).map(([path, sha]) => ({ path, type: 'blob', sha })) });

  it('reads a top-level file from raw, sending nothing else, and keeps it cached', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"schema": 1}'));
    vi.stubGlobal('fetch', spy);
    expect(await getTextAt(repo, 'manifest.json', SHA, '')).toBe('{"schema": 1}');
    expect(spy.mock.calls.map(([url]) => url)).toEqual([`https://raw.githubusercontent.com/AkiraMisawa/keyballer-config/${SHA}/manifest.json`]);
    expect(spy.mock.calls[0][1]).toEqual({ cache: 'force-cache', credentials: 'omit', redirect: 'error' });
  });

  it('asks once more past the cache before taking a top-level file as missing', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('404: Not Found', { status: 404 }));
    vi.stubGlobal('fetch', spy);
    expect(await getTextAt(repo, 'manifest.json', SHA, '')).toBeNull();
    expect(spy.mock.calls.map(([, init]) => init?.cache)).toEqual(['force-cache', 'reload']);
  });

  it('checks a file in a folder against the commit’s tree, as raw could read the folder as a branch', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return tree({ 'keymaps/am338/config.h': CONFIG_BLOB });
      return new Response(url.startsWith('https://raw.') ? CONFIG : 'from the api');
    });
    vi.stubGlobal('fetch', spy);
    expect(await getTextAt(repo, 'keymaps/am338/config.h', SHA, '')).toBe(CONFIG);
    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      `https://api.github.com/repos/AkiraMisawa/keyballer-config/git/trees/${SHA}?recursive=1`,
      `https://raw.githubusercontent.com/AkiraMisawa/keyballer-config/${SHA}/keymaps/am338/config.h`,
    ]);
    // A file the tree does not have is missing, without asking raw.
    spy.mockClear();
    expect(await getTextAt(repo, 'keymaps/am338/rules.mk', SHA, '')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reads a file from the API when raw serves other bytes than the commit has', async () => {
    const spy = vi.fn(async (url: string) => {
      if (url.includes('/git/trees/')) return tree({ 'keymaps/x/config.h': CONFIG_BLOB });
      return new Response(url.startsWith('https://raw.') ? '#define EVIL\n' : CONFIG);
    });
    vi.stubGlobal('fetch', spy);
    const other = { owner: 'someone', repo: 'config' };
    expect(await getTextAt(other, 'keymaps/x/config.h', SHA, '')).toBe(CONFIG);
    expect(String(spy.mock.calls.at(-1)?.[0])).toMatch(/^https:\/\/api\.github\.com\/repos\/someone\/config\/contents\/keymaps\/x\/config\.h\?ref=/);
  });

  it('asks the API when raw fails some other way, and with a token or a branch name', async () => {
    const spy = vi.fn(async (url: string) => (url.startsWith('https://raw.') ? new Response('', { status: 503 }) : new Response('api')));
    vi.stubGlobal('fetch', spy);
    expect(await getTextAt(repo, 'keyballer.json', SHA, '')).toBe('api');
    expect(String(spy.mock.calls.at(-1)?.[0])).toMatch(/^https:\/\/api\.github\.com\/repos\/AkiraMisawa\/keyballer-config\/contents\/keyballer\.json\?ref=/);
    spy.mockClear();
    await getTextAt(repo, 'keyballer.json', SHA, 'github_pat_x');
    await getTextAt(repo, 'keyballer.json', 'main', '');
    expect(spy.mock.calls.every(([url]) => String(url).startsWith('https://api.github.com/'))).toBe(true);
  });
});

describe('the API limit', () => {
  it('says when the limit comes back', () => {
    const reset = 1795392000; // a whole minute, as GitHub sends it
    const e = statusError(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }));
    expect(e).toBeInstanceOf(GitHubError);
    const at = new Date(reset * 1000);
    expect(e.key).toBe('gh.err.rateLimitUntil');
    expect(e.params).toEqual({ time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` });
    // Without the time, the plain message.
    expect(statusError(new Response('', { status: 429, headers: { 'x-ratelimit-remaining': '0' } })).key).toBe('gh.err.rateLimit');
  });
});

