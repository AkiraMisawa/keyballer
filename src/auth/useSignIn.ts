// Local sign-in for the page (docs/plans/github-login.md, phase 3). Null unless Keyballer runs on
// this machine with the GitHub App set up. The token lives in this hook's state only, and the
// sign-in ends with the tab or when the token expires, whichever comes first.

import { useCallback, useEffect, useState } from 'react';
import { LocalizedError } from '../i18n/core';
import type { MessageKey } from '../i18n/messages';
import { getLogin } from '../lib/github';
import {
  exchangeCode,
  getSignInSetup,
  prepareSignIn,
  revokeToken,
  SIGN_IN_TIMEOUT_MS,
  waitForCode,
  type PreparedSignIn,
  type Session,
  type SignInSetup,
} from './client';

export interface SignIn {
  setup: SignInSetup;
  /** The signed-in account, or null. */
  login: string | null;
  /** The user token while signed in, otherwise empty. */
  token: string;
  /** Waiting for the sign-in window. */
  busy: boolean;
  /** A sign-in can start now (the state and verifier are made ahead of the click). */
  ready: boolean;
  /** Why the last sign-in did not finish, or that it ended. */
  problem: MessageKey | null;
  start: () => void;
  end: () => void;
}

export function useSignIn(): SignIn | null {
  const [setup, setSetup] = useState<SignInSetup | null>(null);
  const [prepared, setPrepared] = useState<PreparedSignIn | null>(null);
  const [session, setSession] = useState<(Session & { login: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);

  useEffect(() => {
    let live = true;
    void getSignInSetup().then((s) => live && setSetup(s));
    return () => {
      live = false;
    };
  }, []);

  // The sign-in window must open in the click itself (Safari blocks it after an await), so the
  // state and the PKCE challenge are made before.
  useEffect(() => {
    if (!setup || session || busy || prepared) return;
    let live = true;
    void prepareSignIn(setup.clientId, location.origin).then((p) => live && setPrepared(p));
    return () => {
      live = false;
    };
  }, [setup, session, busy, prepared]);

  // The token stops working at its expiry; the page forgets it then and says so.
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      setSession(null);
      setProblem('auth.ended');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);

  const start = useCallback(() => {
    if (!prepared || busy || session) return;
    const once = prepared;
    setPrepared(null);
    setBusy(true);
    setProblem(null);
    // Listen before opening, so a fast answer is not missed.
    const code = waitForCode(once.state, SIGN_IN_TIMEOUT_MS);
    window.open(once.url, 'keyballer-sign-in', 'popup,noopener');
    void code
      .then((c) => exchangeCode(c, once.verifier))
      .then(async (s) => setSession({ ...s, login: await getLogin(s.token) }))
      .catch((e: unknown) => setProblem(e instanceof LocalizedError && e.key.startsWith('auth.') ? e.key : 'auth.err.failed'))
      .finally(() => setBusy(false));
  }, [prepared, busy, session]);

  const end = useCallback(() => {
    if (session) revokeToken(session.token);
    setSession(null);
    setProblem(null);
  }, [session]);

  if (!setup) return null;
  return { setup, login: session?.login ?? null, token: session?.token ?? '', busy, ready: !!prepared, problem, start, end };
}
