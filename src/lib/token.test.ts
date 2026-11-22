// Which pasted tokens Keyballer takes, and retiring the token older versions kept in localStorage.
// Token shapes follow GitHub's documented prefixes: github_pat_ (fine-grained), ghp_ (classic),
// gho_ (OAuth app), ghu_ (GitHub App user), ghs_ (GitHub App installation). The values are built
// at run time, so no token-shaped literal sits in the source.

import { describe, expect, it } from 'vitest';
import { checkPastedToken, forgetStoredToken } from './token';

const fineGrained = `github_pat_${'A1'.repeat(11)}_${'b2'.repeat(29)}c`;
const classic = `ghp_${'Z9'.repeat(18)}`;

describe('checkPastedToken', () => {
  it('takes a fine-grained token, without the spaces around it', () => {
    expect(checkPastedToken(`  ${fineGrained}\n`)).toEqual({ ok: true, token: fineGrained });
  });

  it('takes an empty field as no token', () => {
    expect(checkPastedToken('   ')).toEqual({ ok: true, token: '' });
  });

  it('refuses a classic token, which reaches every repository', () => {
    expect(checkPastedToken(classic)).toEqual({ ok: false, reason: 'token.err.classic' });
  });

  it('refuses tokens that are not fine-grained personal access tokens', () => {
    for (const prefix of ['gho_', 'ghu_', 'ghs_', 'Bearer github_pat_', 'github_pat']) {
      expect(checkPastedToken(`${prefix}${'x'.repeat(40)}`), prefix).toEqual({ ok: false, reason: 'token.err.format' });
    }
  });

  it('refuses text that would change the Authorization header', () => {
    for (const bad of [`${fineGrained} extra`, `${fineGrained}\r\nX-Evil: 1`, `${fineGrained}é`, `github_pat_${'a'.repeat(300)}`]) {
      expect(checkPastedToken(bad).ok, JSON.stringify(bad.slice(-12))).toBe(false);
    }
  });
});

/** An in-memory Web Storage, for the parts of the interface Keyballer uses. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    has: (k: string) => map.has(k),
  };
}

describe('forgetStoredToken', () => {
  it('deletes a token saved by an older version and says what kind it was', () => {
    const storage = memoryStorage({ 'keyballer.token': fineGrained, 'keyballer.repo': 'me/config' });
    expect(forgetStoredToken(storage)).toBe('fine-grained');
    expect(storage.has('keyballer.token')).toBe(false);
    expect(storage.has('keyballer.repo')).toBe(true);
  });

  it('names a classic token, which is revoked on a different page', () => {
    expect(forgetStoredToken(memoryStorage({ 'keyballer.token': classic }))).toBe('classic');
  });

  it('reports nothing when no token was saved', () => {
    expect(forgetStoredToken(memoryStorage())).toBeNull();
  });

  it('reports nothing when storage cannot be used', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    expect(forgetStoredToken(blocked)).toBeNull();
    expect(forgetStoredToken(undefined)).toBeNull();
  });
});
