import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFirmwareText, parseRepo } from './github';

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
