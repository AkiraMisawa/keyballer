// The page's side of local sign-in (docs/plans/github-login.md, phase 3): GitHub's web flow with
// PKCE, in a window of its own. The state and verifier live only in this page's memory; the local
// server (server.ts) adds the client secret and returns an 8-hour user token, which also lives only
// in memory.

import { LocalizedError } from '../i18n/core';
import { CALLBACK_PATH, CODE, REVOKE_PATH, SIGN_IN_CHANNEL, SIGN_IN_MESSAGE, STATUS_PATH, TOKEN_PATH, USER_TOKEN } from './protocol';
/** GitHub's codes last 10 minutes; so does waiting for one. */
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 32 random bytes, base64url: a PKCE verifier or a state (RFC 7636 §4.1). */
export function makeRandom(fill: (a: Uint8Array<ArrayBuffer>) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  return base64url(fill(new Uint8Array(32)));
}

/** The S256 challenge for a verifier (RFC 7636 §4.2). */
export async function challengeOf(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export function authorizeUrl({ clientId, origin, state, challenge }: { clientId: string; origin: string; state: string; challenge: string }): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', origin + CALLBACK_PATH);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** A sign-in ready to start: the address to open, and what only this page knows. */
export interface PreparedSignIn {
  url: string;
  state: string;
  verifier: string;
}

export async function prepareSignIn(clientId: string, origin: string): Promise<PreparedSignIn> {
  const state = makeRandom();
  const verifier = makeRandom();
  return { url: authorizeUrl({ clientId, origin, state, challenge: await challengeOf(verifier) }), state, verifier };
}

/**
 * Waits for the sign-in window to send back the code for this state. Messages for any other state
 * (another tab's sign-in) are ignored; the first one for this state ends the wait either way. An
 * abort (a new sign-in started) ends it too, with an AbortError.
 */
export function waitForCode(state: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    const finish = () => {
      clearTimeout(timer);
      channel.close();
      signal?.removeEventListener('abort', aborted);
    };
    const aborted = () => {
      finish();
      reject(new DOMException('A new sign-in started', 'AbortError'));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new LocalizedError('auth.err.timeout'));
    }, timeoutMs);
    if (signal?.aborted) return aborted();
    signal?.addEventListener('abort', aborted);
    channel.onmessage = (event: MessageEvent) => {
      const m: unknown = event.data;
      if (typeof m !== 'object' || m === null) return;
      const { type, state: sent, code, error } = m as Record<string, unknown>;
      if (type !== SIGN_IN_MESSAGE || sent !== state) return;
      finish();
      if (error === 'access_denied') reject(new LocalizedError('auth.err.cancelled'));
      else if (typeof code === 'string' && CODE.test(code)) resolve(code);
      else reject(new LocalizedError('auth.err.failed'));
    };
  });
}

/** A signed-in session: the user token and when it stops working. */
export interface Session {
  token: string;
  expiresAt: number;
}

export async function exchangeCode(code: string, verifier: string, now = Date.now()): Promise<Session> {
  try {
    const res = await fetch(TOKEN_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier }),
    });
    const body: unknown = await res.json();
    const { access_token: token, expires_in: lifetime } = (body ?? {}) as Record<string, unknown>;
    if (res.ok && typeof token === 'string' && USER_TOKEN.test(token) && typeof lifetime === 'number' && lifetime > 0) {
      return { token, expiresAt: now + lifetime * 1000 };
    }
  } catch {
    // Falls through to the same answer: the page says the sign-in did not finish.
  }
  throw new LocalizedError('auth.err.failed');
}

/**
 * Asks the local server to revoke the token on GitHub. Signing out does not wait for the answer,
 * and `keepalive` lets the request finish while the tab closes.
 */
export function revokeToken(token: string): void {
  void fetch(REVOKE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: token }),
    keepalive: true,
  }).catch(() => undefined);
}

/** Calls `onEnd` when the session's token expires; returns a way to stop watching. */
export function watchExpiry(session: Session, onEnd: () => void, now = Date.now()): () => void {
  const timer = setTimeout(onEnd, Math.max(0, session.expiresAt - now));
  return () => clearTimeout(timer);
}

/** The app's public settings when sign-in is set up on this machine, or null. */
export interface SignInSetup {
  clientId: string;
  appSlug: string | null;
}

/** Sign-in exists only where Keyballer runs on this machine, from `npm run dev` or `npm run preview`. */
export async function getSignInSetup(): Promise<SignInSetup | null> {
  if (location.hostname !== '127.0.0.1') return null;
  try {
    const res = await fetch(STATUS_PATH, { cache: 'no-store' });
    if (!res.ok) return null;
    const { clientId, appSlug } = (await res.json()) as Record<string, unknown>;
    if (typeof clientId !== 'string' || !clientId) return null;
    return { clientId, appSlug: typeof appSlug === 'string' && appSlug ? appSlug : null };
  } catch {
    return null;
  }
}
