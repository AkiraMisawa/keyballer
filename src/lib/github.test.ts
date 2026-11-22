import { afterEach, describe, expect, it, vi } from 'vitest';
import { appReaches, getFirmwareText, parseRepo } from './github';

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
