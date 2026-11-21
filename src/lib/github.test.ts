import { describe, expect, it } from 'vitest';
import { parseRepo } from './github';

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
