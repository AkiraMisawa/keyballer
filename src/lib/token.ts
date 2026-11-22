// The personal access token pasted into Keyballer. It is kept in the tab's memory only: any page
// on the same origin can read localStorage, and a token there would last for months.
//
// Only fine-grained tokens are taken. A classic token (ghp_) reaches every repository its owner
// can write to, Keyballer's own included, so a stolen one could change the build workflow itself.

import type { MessageKey } from '../i18n/messages';

export type PastedToken = { ok: true; token: string } | { ok: false; reason: MessageKey };

/** `github_pat_` and the rest, as GitHub issues them; nothing that could reach another header. */
const FINE_GRAINED = /^github_pat_[A-Za-z0-9_]{1,244}$/;

export function checkPastedToken(input: string): PastedToken {
  const token = input.trim();
  if (token === '') return { ok: true, token };
  if (token.startsWith('ghp_')) return { ok: false, reason: 'token.err.classic' };
  if (!FINE_GRAINED.test(token)) return { ok: false, reason: 'token.err.format' };
  return { ok: true, token };
}

/** The token field, shared by the repository section and the save review. */
export interface TokenField {
  /** What was typed or pasted, as the field shows it. */
  input: string;
  /** The token to send: empty unless the input was taken. */
  value: string;
  /** Why the input was refused, if it was. */
  problem: MessageKey | null;
  set: (input: string) => void;
}

export function tokenField(input: string, set: (input: string) => void): TokenField {
  const checked = checkPastedToken(input);
  return checked.ok
    ? { input, value: checked.token, problem: null, set }
    : { input, value: '', problem: checked.reason, set };
}

/** Where versions before this one saved the token. */
const LEGACY_KEY = 'keyballer.token';

export type ForgottenTokenKind = 'classic' | 'fine-grained' | null;

/**
 * Deletes the token that older versions saved in localStorage, and says what kind it was, so the
 * page can point to where it is revoked: deleting it here leaves it working on GitHub.
 */
export function forgetStoredToken(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): ForgottenTokenKind {
  try {
    const saved = storage?.getItem(LEGACY_KEY);
    if (!saved) return null;
    storage!.removeItem(LEGACY_KEY);
    return saved.trim().startsWith('ghp_') ? 'classic' : 'fine-grained';
  } catch {
    return null;
  }
}
