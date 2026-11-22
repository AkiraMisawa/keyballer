// The personal access token pasted into Keyballer. It is kept in the tab's memory only: any page
// on the same origin can read localStorage, and a token there would last for months.
//
// Only fine-grained tokens are taken. A classic token (ghp_) reaches every repository its owner
// can write to, so a stolen one reaches far beyond the config repository.

import type { MessageKey } from '../i18n/messages';

export type PastedToken = { ok: true; token: string } | { ok: false; reason: MessageKey };

/** `github_pat_` and the rest, as GitHub issues them; nothing that could reach another header. */
const FINE_GRAINED = /^github_pat_[A-Za-z0-9_]{1,244}$/;

const isClassic = (token: string) => token.startsWith('ghp_');

export function checkPastedToken(input: string): PastedToken {
  const token = input.trim();
  if (token === '') return { ok: true, token };
  if (isClassic(token)) return { ok: false, reason: 'token.err.classic' };
  if (!FINE_GRAINED.test(token)) return { ok: false, reason: 'token.err.format' };
  return { ok: true, token };
}

/** Where versions before this one saved the token. */
const LEGACY_KEY = 'keyballer.token';

/** What kind of token was deleted, which decides where GitHub revokes it. */
export type ForgottenTokenKind = 'classic' | 'fine-grained';

/**
 * Deletes the token that older versions saved in localStorage, and says what kind it was, so the
 * page can point to where it is revoked: deleting it here leaves it working on GitHub. Null when
 * there was none, or when it could not be deleted.
 */
export function forgetStoredToken(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): ForgottenTokenKind | null {
  try {
    const saved = storage?.getItem(LEGACY_KEY);
    if (!saved) return null;
    storage!.removeItem(LEGACY_KEY);
    return isClassic(saved.trim()) ? 'classic' : 'fine-grained';
  } catch {
    return null;
  }
}
